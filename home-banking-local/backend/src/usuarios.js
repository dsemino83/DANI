// Usuarios propios del Home Banking, guardados en la base operativa (tabla usuario). Reemplaza al SSO (Keycloak):
//  - ingreso con usuario y clave, cambio obligatorio de la clave temporal, OTP opcional (TOTP, app de autenticación)
//    y bloqueo temporal tras varios intentos fallidos;
//  - administración desde la pestaña "Usuarios y permisos": alta, perfil, roles Crear/Aprobar, habilitación,
//    desbloqueo, claves, OTP y baja. Mismas funciones (y mismos nombres) que usaba la integración con Keycloak.
// Las claves se guardan como hash scrypt; el secreto OTP, cifrado con la llave maestra (AES-256-GCM).
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import { config } from './config.js';
import { operativa, esDuplicado } from './db.js';
import { ErrorHttp, conflicto, invalido, noAutorizado } from './errores.js';
import { ROL_APROBAR, ROL_CREAR, emitirToken, sesion } from './auth.js';
import { cifrar, descifrar } from './secretos.js';
import { auditar } from './auditoria.js';
import { enviarCorreo } from './correo.js';

export const PERFILES = ['operador', 'autorizante', 'auditor', 'administrador'];
const EMISOR_OTP = 'Home Banking VALO';

// ---------------- Claves: hash scrypt ----------------
const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashClave(clave) {
  const sal = randomBytes(16);
  const h = await scryptAsync(String(clave).normalize('NFKC'), sal, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString('base64')}$${h.toString('base64')}`;
}

export async function verificarClave(clave, guardado) {
  const [alg, N, r, p, sal, h] = String(guardado ?? '').split('$');
  if (alg !== 'scrypt' || !sal || !h) return false;
  const esperado = Buffer.from(h, 'base64');
  const calculado = await scryptAsync(String(clave ?? '').normalize('NFKC'), Buffer.from(sal, 'base64'), esperado.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return timingSafeEqual(calculado, esperado);
}

// Para que un usuario inexistente tarde lo mismo que uno con clave errónea (no se puede adivinar quién existe).
const HASH_FICTICIO = await hashClave(randomBytes(16).toString('hex'));

// Clave temporal (la carga el administrador) y clave definitiva (la elige el usuario): misma política.
export function validarClaveTemporal(clave) {
  const c = String(clave ?? '');
  if (c.length < 12 || c.length > 128 || !/[A-Za-z]/.test(c) || !/\d/.test(c)) throw invalido('La clave debe tener entre 12 y 128 caracteres, con letras y números');
  return c;
}

function validarClaveNueva(clave, usuario, actual) {
  const c = validarClaveTemporal(clave);
  if (c.toLowerCase().includes(usuario.toLowerCase())) throw invalido('La clave no puede contener el nombre de usuario');
  if (actual !== undefined && c === actual) throw invalido('La clave nueva tiene que ser distinta de la anterior');
  return c;
}

// ---------------- OTP: TOTP (RFC 6238), 6 dígitos cada 30 segundos, compatible con cualquier app de autenticación ----------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, valor = 0, salida = '';
  for (const b of buf) {
    valor = ((valor << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) { salida += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += B32[(valor << (5 - bits)) & 31];
  return salida;
}

export function codigoTotp(secreto, paso) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const h = createHmac('sha1', secreto).update(contador).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// Devuelve el paso de tiempo del código si es válido (acepta ±30 s de desfasaje del reloj), o null.
// Un código ya usado (paso <= ultimoPaso) no se acepta de nuevo.
export function verificarTotp(secreto, codigo, ultimoPaso = null, ahora = Date.now()) {
  const c = String(codigo ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const actual = Math.floor(ahora / 30_000);
  for (const d of [0, -1, 1]) {
    const paso = actual + d;
    if (ultimoPaso != null && paso <= Number(ultimoPaso)) continue;
    if (timingSafeEqual(Buffer.from(codigoTotp(secreto, paso)), Buffer.from(c))) return paso;
  }
  return null;
}

const secretoOtp = (f) => Buffer.from(descifrar({ cifrado: f.otp_cifrado, iv: f.otp_iv, tag: f.otp_tag }), 'base64');

// ---------------- Lectura ----------------
async function fila(usuario, cliente = operativa) {
  const { rows } = await cliente.query('SELECT * FROM usuario WHERE usuario = $1', [String(usuario ?? '').trim().toLowerCase()]);
  return rows[0] ?? null;
}

async function existente(usuario) {
  const f = await fila(usuario);
  if (!f) throw invalido(`El usuario ${usuario} no existe`);
  return f;
}

const bloqueado = (f) => !!f.bloqueado_hasta && new Date(f.bloqueado_hasta) > new Date();

async function actualizar(usuario, sets, params = []) {
  await operativa.query(`UPDATE usuario SET ${sets}, actualizado_en = SYSDATETIMEOFFSET() WHERE usuario = $1`, [usuario, ...params]);
}

// ---------------- Ingreso ----------------
// Auditoría de accesos: la request todavía no tiene usuario autenticado.
const auditarAcceso = (req, usuario, rol, accion, detalle = '', resultado = 'OK') =>
  auditar(null, { user: { usuario: usuario || 'desconocido', rol: rol || 'sin_rol' }, ip: req.ip }, { tipo: 'Accesos', accion, api: 'Ingreso', detalle, resultado })
    .catch((e) => req.log?.error(e, 'No se pudo auditar el acceso'));

async function registrarFallo(req, f, motivo) {
  const { rows } = await operativa.query(
    `UPDATE usuario SET
       bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2 THEN DATEADD(minute, $3, SYSDATETIMEOFFSET()) ELSE bloqueado_hasta END,
       intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= $2 THEN 0 ELSE intentos_fallidos + 1 END
     OUTPUT inserted.bloqueado_hasta
     WHERE usuario = $1`, [f.usuario, config.sesion.intentosMaximos, config.sesion.bloqueoMinutos]);
  const ahoraBloqueado = rows[0]?.bloqueado_hasta && new Date(rows[0].bloqueado_hasta) > new Date();
  await auditarAcceso(req, f.usuario, f.perfil, 'Ingreso rechazado', `${motivo}${ahoraBloqueado ? ` · usuario bloqueado ${config.sesion.bloqueoMinutos} min por intentos fallidos` : ''}`, 'Error');
}

const credencialesInvalidas = () => new ErrorHttp(401, 'credenciales', 'Usuario o clave incorrectos');

// Un paso del ingreso. El navegador vuelve a mandar usuario y clave en cada paso (no hay estado intermedio en el
// servidor) y agrega lo que se le pidió: primero la clave nueva (si la actual es temporal), al final el código OTP.
// Devuelve { paso } mientras falte algo, o { token } cuando el ingreso está completo.
export async function ingresar(datos, req) {
  const usuario = String(datos?.usuario ?? '').trim().toLowerCase();
  const clave = String(datos?.clave ?? '');
  if (!usuario || !clave) throw invalido('Ingresá usuario y clave');
  const f = await fila(usuario);
  if (!f) {
    await verificarClave(clave, HASH_FICTICIO);
    await auditarAcceso(req, usuario.slice(0, 50), null, 'Ingreso rechazado', 'usuario inexistente', 'Error');
    throw credencialesInvalidas();
  }
  if (bloqueado(f)) {
    const min = Math.max(1, Math.ceil((new Date(f.bloqueado_hasta) - Date.now()) / 60_000));
    await auditarAcceso(req, f.usuario, f.perfil, 'Ingreso rechazado', 'usuario bloqueado por intentos fallidos', 'Error');
    throw new ErrorHttp(423, 'bloqueado', `Usuario bloqueado por intentos fallidos. Probá de nuevo en ${min} min o pedile al administrador que te desbloquee.`);
  }
  if (!(await verificarClave(clave, f.clave_hash))) {
    await registrarFallo(req, f, 'clave incorrecta');
    throw credencialesInvalidas();
  }
  if (!f.habilitado) {
    await auditarAcceso(req, f.usuario, f.perfil, 'Ingreso rechazado', 'usuario deshabilitado', 'Error');
    throw new ErrorHttp(403, 'deshabilitado', 'Tu usuario está deshabilitado. Consultá con el administrador de seguridad.');
  }

  // 1) Clave temporal: hay que elegir una nueva (todavía no se guarda: se aplica al final, con todo validado).
  let claveNueva = null;
  if (f.debe_cambiar_clave) {
    if (!datos.claveNueva) return { paso: 'cambiar_clave' };
    claveNueva = validarClaveNueva(datos.claveNueva, f.usuario, clave);
  }

  // 2) OTP: enrolamiento (la primera vez) o código.
  let pasoOtp = null;
  if (f.otp_requerido) {
    let secreto;
    if (!f.otp_cifrado) {
      secreto = randomBytes(20);
      const c = cifrar(secreto.toString('base64'));
      await actualizar(f.usuario, 'otp_cifrado = $2, otp_iv = $3, otp_tag = $4, otp_confirmado = 0, otp_ultimo_paso = NULL', [c.cifrado, c.iv, c.tag]);
    } else secreto = secretoOtp(f);
    if (!datos.otp) {
      if (f.otp_confirmado) return { paso: 'otp' };
      const uri = `otpauth://totp/${encodeURIComponent(`${EMISOR_OTP}:${f.usuario}`)}?secret=${base32(secreto)}&issuer=${encodeURIComponent(EMISOR_OTP)}&algorithm=SHA1&digits=6&period=30`;
      return { paso: 'otp_enrolar', secreto: base32(secreto), uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
    }
    pasoOtp = verificarTotp(secreto, datos.otp, f.otp_confirmado ? f.otp_ultimo_paso : null);
    if (pasoOtp === null) {
      await registrarFallo(req, f, 'código OTP incorrecto');
      throw new ErrorHttp(401, 'otp', 'Código OTP incorrecto o vencido');
    }
  }

  // 3) Todo en orden: se aplica la clave nueva y el OTP, y se emite la sesión.
  const hash = claveNueva ? await hashClave(claveNueva) : null;
  const { rows } = await operativa.query(
    `UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_ingreso = SYSDATETIMEOFFSET(),
            clave_hash = COALESCE($2, clave_hash), debe_cambiar_clave = CASE WHEN $2 IS NULL THEN debe_cambiar_clave ELSE 0 END,
            version_sesion = version_sesion + CASE WHEN $2 IS NULL THEN 0 ELSE 1 END,
            otp_confirmado = CASE WHEN $3 IS NULL THEN otp_confirmado ELSE 1 END, otp_ultimo_paso = COALESCE($3, otp_ultimo_paso),
            reset_hash = CASE WHEN $2 IS NULL THEN reset_hash ELSE NULL END, actualizado_en = SYSDATETIMEOFFSET()
     OUTPUT inserted.version_sesion
     WHERE usuario = $1`, [f.usuario, hash, pasoOtp]);
  const detalle = [claveNueva && 'eligió su clave nueva', pasoOtp !== null && (f.otp_confirmado ? 'con OTP' : 'configuró OTP')].filter(Boolean).join(' · ');
  await auditarAcceso(req, f.usuario, f.perfil, 'Ingresó al Home Banking', detalle);
  return { token: await emitirToken(f.usuario, rows[0].version_sesion), minutos: sesion.minutos };
}

// Token nuevo para una sesión vigente (el navegador lo pide antes de que venza). Tiene un tope desde el ingreso.
export async function renovar(req) {
  const desde = Number(req.sesion?.ini ?? 0);
  if (Date.now() / 1000 - desde > sesion.horasMaximas * 3600) throw noAutorizado('La sesión llegó a su duración máxima: volvé a ingresar');
  return { token: await emitirToken(req.user.usuario, req.sesion.ver, desde), minutos: sesion.minutos };
}

// Cierra todas las sesiones del usuario (también las de otras pestañas o equipos).
export async function salir(req) {
  await actualizar(req.user.usuario, 'version_sesion = version_sesion + 1');
  await auditar(null, req, { tipo: 'Accesos', accion: 'Cerró sesión', api: 'Ingreso' });
}

// El propio usuario cambia su clave. Cierra sus otras sesiones y devuelve un token nuevo para esta.
export async function cambiarMiClave(req, datos) {
  const f = await existente(req.user.usuario);
  if (!(await verificarClave(datos?.claveActual, f.clave_hash))) {
    await registrarFallo(req, f, 'clave actual incorrecta al cambiar la clave');
    throw invalido('La clave actual no es correcta');
  }
  const nueva = validarClaveNueva(datos?.claveNueva, f.usuario, String(datos?.claveActual ?? ''));
  const { rows } = await operativa.query(
    `UPDATE usuario SET clave_hash = $2, debe_cambiar_clave = 0, version_sesion = version_sesion + 1, reset_hash = NULL, actualizado_en = SYSDATETIMEOFFSET()
     OUTPUT inserted.version_sesion WHERE usuario = $1`, [f.usuario, await hashClave(nueva)]);
  await auditar(null, req, { tipo: 'Accesos', accion: 'Cambió su clave', api: 'Ingreso', detalle: 'otras sesiones abiertas cerradas' });
  return { token: await emitirToken(f.usuario, rows[0].version_sesion, req.sesion.ini), minutos: sesion.minutos };
}

// Link recibido por correo (válido 24 h): elige una clave nueva sin conocer la anterior. También quita el bloqueo.
export async function restablecerConToken(datos, req) {
  const f = await fila(datos?.usuario);
  const token = String(datos?.token ?? '');
  const valido = f?.reset_hash && f.reset_vence && new Date(f.reset_vence) > new Date()
    && timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(f.reset_hash));
  if (!valido) {
    await auditarAcceso(req, f?.usuario ?? String(datos?.usuario ?? '').slice(0, 50), f?.perfil, 'Link para cambiar la clave rechazado', 'link inválido o vencido', 'Error');
    throw invalido('El link no es válido o ya venció. Pedile al administrador uno nuevo.');
  }
  const nueva = validarClaveNueva(datos?.claveNueva, f.usuario);
  await actualizar(f.usuario, `clave_hash = $2, debe_cambiar_clave = 0, reset_hash = NULL, reset_vence = NULL, intentos_fallidos = 0,
    bloqueado_hasta = NULL, version_sesion = version_sesion + 1`, [await hashClave(nueva)]);
  await auditarAcceso(req, f.usuario, f.perfil, 'Eligió una clave nueva con el link del correo');
  return { usuario: f.usuario };
}

// Primer administrador: solo si no hay ningún usuario (instalación nueva).
export async function crearAdminInicial(log) {
  const { rows } = await operativa.query('SELECT COUNT(*) AS n FROM usuario');
  if (rows[0].n > 0) return false;
  const { usuario, email, clave } = config.adminInicial;
  if (!clave) { log.warn('No hay usuarios y falta la clave del administrador inicial (secreto admin_inicial_password)'); return false; }
  await operativa.query(
    `INSERT INTO usuario (usuario, nombre, apellido, email, perfil, clave_hash, debe_cambiar_clave) VALUES ($1, N'Administrador', N'de seguridad', $2, N'administrador', $3, 1)`,
    [usuario, email, await hashClave(clave)]);
  await auditar(null, { user: { usuario: 'sistema', rol: 'sistema' } }, { tipo: 'Administración', accion: 'Alta del administrador inicial', api: 'Usuarios', detalle: `${usuario} · clave temporal (se cambia en el primer ingreso)` });
  log.info({ usuario }, 'Administrador inicial creado');
  return true;
}

// ---------------- Administración (pestaña Usuarios y permisos) ----------------
export async function rolesDeTransferencias(usuario) {
  const f = await existente(usuario);
  return { crear: !!f.crear, aprobar: !!f.aprobar, administrador: f.perfil === 'administrador' };
}

export async function cambiarRol(usuario, rol, asignar) {
  const columna = { [ROL_CREAR]: 'crear', [ROL_APROBAR]: 'aprobar' }[rol];
  if (!columna) throw invalido(`Rol inválido: ${rol}`);
  const f = await existente(usuario);
  if (asignar && f.perfil === 'administrador') throw invalido('El administrador de seguridad no puede tener roles de operación');
  await actualizar(f.usuario, `${columna} = $2`, [!!asignar]);
}

export async function listarUsuarios() {
  const { rows } = await operativa.query('SELECT usuario, nombre, apellido, email, perfil, crear, aprobar, habilitado FROM usuario ORDER BY usuario');
  return rows.map((u) => ({
    usuario: u.usuario, nombre: [u.nombre, u.apellido].filter(Boolean).join(' '), nombres: u.nombre, apellido: u.apellido, email: u.email,
    habilitado: !!u.habilitado, rol: u.perfil, crear: !!u.crear, aprobar: !!u.aprobar,
    roles: [u.perfil, ...(u.crear ? [ROL_CREAR] : []), ...(u.aprobar ? [ROL_APROBAR] : [])],
  }));
}

export function validarAlta(d) {
  const usuario = String(d.usuario ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(usuario)) throw invalido('Usuario inválido: 3 a 50 caracteres, letras minúsculas, números, punto, guion o guion bajo');
  const email = String(d.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw invalido('Email inválido');
  const nombre = String(d.nombre ?? '').trim(), apellido = String(d.apellido ?? '').trim();
  if (!nombre || !apellido) throw invalido('Faltan nombre y apellido');
  if (nombre.length > 100 || apellido.length > 100) throw invalido('Nombre y apellido: hasta 100 caracteres');
  if (!PERFILES.includes(d.perfil)) throw invalido(`Perfil inválido: ${PERFILES.join(', ')}`);
  return { usuario, email, nombre, apellido, perfil: d.perfil, claveTemporal: validarClaveTemporal(d.claveTemporal) };
}

export async function crearUsuario(datos) {
  const d = validarAlta(datos);
  try {
    await operativa.query(
      `INSERT INTO usuario (usuario, nombre, apellido, email, perfil, clave_hash, debe_cambiar_clave) VALUES ($1, $2, $3, $4, $5, $6, 1)`,
      [d.usuario, d.nombre, d.apellido, d.email, d.perfil, await hashClave(d.claveTemporal)]);
  } catch (e) {
    if (esDuplicado(e)) throw conflicto('Ya existe un usuario con ese nombre o email');
    throw e;
  }
  return { usuario: d.usuario, perfil: d.perfil };
}

// Deja un único perfil. Pasar a administrador quita Crear/Aprobar (el administrador no opera).
export async function cambiarPerfil(usuario, perfil) {
  if (!PERFILES.includes(perfil)) throw invalido(`Perfil inválido: ${PERFILES.join(', ')}`);
  const f = await existente(usuario);
  const quitados = perfil === 'administrador' ? [f.crear && ROL_CREAR, f.aprobar && ROL_APROBAR].filter(Boolean) : [];
  await actualizar(f.usuario, `perfil = $2${perfil === 'administrador' ? ', crear = 0, aprobar = 0' : ''}`, [perfil]);
  return { antes: [f.perfil], despues: perfil, quitados: f.perfil !== perfil ? [f.perfil, ...quitados] : quitados };
}

export async function habilitarUsuario(usuario, habilitado) {
  const f = await existente(usuario);
  if (habilitado) await actualizar(f.usuario, 'habilitado = 1, intentos_fallidos = 0, bloqueado_hasta = NULL'); // y sin bloqueo por intentos
  else await actualizar(f.usuario, 'habilitado = 0, version_sesion = version_sesion + 1'); // corta las sesiones abiertas
  return { usuario: f.usuario, habilitado: !!habilitado };
}

export async function restablecerClave(usuario, claveTemporal) {
  const clave = validarClaveTemporal(claveTemporal);
  const f = await existente(usuario);
  await actualizar(f.usuario, 'clave_hash = $2, debe_cambiar_clave = 1, reset_hash = NULL, version_sesion = version_sesion + 1', [await hashClave(clave)]);
  return { usuario: f.usuario };
}

export async function estadoUsuario(usuario) {
  const f = await existente(usuario);
  return {
    usuario: f.usuario, email: f.email, habilitado: !!f.habilitado,
    bloqueado: bloqueado(f), intentosFallidos: f.intentos_fallidos,
    debeCambiarClave: !!f.debe_cambiar_clave,
    requiereOtp: !!f.otp_requerido, otpConfigurado: !!f.otp_requerido && !!f.otp_confirmado, otpPendiente: !!f.otp_requerido && !f.otp_confirmado,
    ultimoIngreso: f.ultimo_ingreso,
  };
}

// Activar: lo enrola en el próximo ingreso (muestra el QR para la app de autenticación). Desactivar: borra su secreto.
export async function requerirOtp(usuario, requiere) {
  const f = await existente(usuario);
  if (requiere) await actualizar(f.usuario, 'otp_requerido = 1, version_sesion = version_sesion + 1');
  else await actualizar(f.usuario, `otp_requerido = 0, otp_confirmado = 0, otp_cifrado = NULL, otp_iv = NULL, otp_tag = NULL,
    otp_ultimo_paso = NULL, version_sesion = version_sesion + 1`);
  return { usuario: f.usuario, requiereOtp: !!requiere };
}

// Obliga a elegir una clave nueva en el próximo ingreso (sin cambiar la actual) y cierra las sesiones abiertas.
export async function forzarCambioClave(usuario) {
  const f = await existente(usuario);
  await actualizar(f.usuario, 'debe_cambiar_clave = 1, version_sesion = version_sesion + 1');
  return { usuario: f.usuario };
}

// Envía al email del usuario un link (válido 24 h) para elegir una clave nueva.
export async function enviarCorreoClave(usuario) {
  const f = await existente(usuario);
  if (!f.email) throw invalido(`${f.usuario} no tiene email cargado`);
  const token = randomBytes(32).toString('base64url');
  await actualizar(f.usuario, 'reset_hash = $2, reset_vence = DATEADD(hour, 24, SYSDATETIMEOFFSET())', [createHash('sha256').update(token).digest()]);
  const link = `${config.urlPublica}/#restablecer=${encodeURIComponent(token)}&u=${encodeURIComponent(f.usuario)}`;
  try {
    await enviarCorreo({
      para: [f.email], asunto: 'Home Banking VALO · elegí tu clave',
      texto: `Hola ${f.nombre}:\n\nPara elegir una clave nueva para tu usuario ${f.usuario} entrá a este link (vale 24 horas):\n${link}\n\nSi no lo pediste, avisale al administrador de seguridad.`,
      html: `<p>Hola ${escapar(f.nombre)}:</p><p>Para elegir una clave nueva para tu usuario <b>${escapar(f.usuario)}</b> entrá a este link (vale 24 horas):</p><p><a href="${escapar(link)}">Elegir clave nueva</a></p><p>Si no lo pediste, avisale al administrador de seguridad.</p>`,
    });
  } catch {
    throw new ErrorHttp(502, 'correo', 'No se pudo enviar el correo: revisar el correo saliente (SMTP)');
  }
  return { usuario: f.usuario, email: f.email };
}

const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Quita el bloqueo temporal por intentos fallidos de ingreso.
export async function desbloquearUsuario(usuario) {
  const f = await existente(usuario);
  await actualizar(f.usuario, 'intentos_fallidos = 0, bloqueado_hasta = NULL');
  return { usuario: f.usuario };
}

// Nombre, apellido y email (el nombre de usuario no cambia: lo usan la auditoría y los permisos).
export function validarDatos(d) {
  const nombre = String(d.nombre ?? '').trim(), apellido = String(d.apellido ?? '').trim(), email = String(d.email ?? '').trim().toLowerCase();
  if (!nombre || !apellido) throw invalido('Faltan nombre y apellido');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalido('Email inválido');
  return { nombre, apellido, email };
}

export async function editarDatosUsuario(usuario, datos) {
  const d = validarDatos(datos);
  const u = await existente(usuario);
  const cambios = [
    u.nombre !== d.nombre && `nombre: ${u.nombre} → ${d.nombre}`,
    u.apellido !== d.apellido && `apellido: ${u.apellido} → ${d.apellido}`,
    u.email !== d.email && `email: ${u.email} → ${d.email}`,
  ].filter(Boolean);
  if (cambios.length) {
    try { await actualizar(u.usuario, 'nombre = $2, apellido = $3, email = $4', [d.nombre, d.apellido, d.email]); } catch (e) {
      if (esDuplicado(e)) throw conflicto('Ya existe otro usuario con ese email');
      throw e;
    }
  }
  return { usuario: u.usuario, cambios };
}

export async function eliminarUsuario(usuario) {
  const f = await existente(usuario);
  await operativa.query('DELETE FROM usuario WHERE usuario = $1', [f.usuario]);
  return { usuario: f.usuario };
}
