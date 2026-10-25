// Cliente de las APIs del Banco de Valores (Documentación Técnica v1.22.0).
// - Una sola credencial (VALO) y una sola sesión compartida por todos los usuarios.
// - login: clave cifrada con la llave pública RSA del banco (PKCS#1 v1.5, como JSEncrypt).
// - La cookie vive solo en memoria del backend; nunca viaja al navegador ni a los logs.
import { constants, publicEncrypt } from 'node:crypto';
import { config } from '../config.js';
import { urlDelAmbiente } from './ambientes.js';
import { leerCredencial, versionCredencial } from '../secretos.js';

export class ErrorBanco extends Error {
  // sinRespuesta = el pedido salió y no hubo respuesta (timeout/corte): el resultado es incierto.
  constructor(mensaje, { codigo = null, http = null, respuesta = null, sinRespuesta = false } = {}) {
    super(mensaje);
    this.codigo = codigo;
    this.http = http;
    this.respuesta = respuesta;
    this.sinRespuesta = sinRespuesta;
  }
}

export function pemDesdeBase64(llave) {
  const limpia = llave.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return `-----BEGIN PUBLIC KEY-----\n${limpia.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
}

export function cifrarClave(clave, llavePublica) {
  return publicEncrypt({ key: pemDesdeBase64(llavePublica), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(clave, 'utf8'))
    .toString('base64');
}

// Un cliente por credencial: 'principal' para el Home Banking y 'envios' para los envíos programados de
// correo (cada uno con su propia sesión en el banco). Si la de envíos no está cargada, usa la principal.
export class ClienteBdv {
  constructor(uso = 'principal') {
    this.uso = uso;
    this.version = null;   // credencial con la que se abrió la sesión (uso@actualizado_en)
    this.revisada = 0;
    this.cookie = null;
    this.vence = 0;
    this.renovando = null; // promesa compartida: una sola renovación a la vez
    this.base = null;
    this.circuito = { estado: 'cerrado', fallos: 0, abiertoHasta: 0, probando: false };
  }

  estadoCircuito() {
    const c = this.circuito;
    return {
      estado: c.estado,
      fallosConsecutivos: c.fallos,
      reintentoEn: c.estado === 'abierto' && c.abiertoHasta ? new Date(c.abiertoHasta).toISOString() : null,
    };
  }

  permitirPorCircuito({ envio = false } = {}) {
    const conf = config.bdv.circuitBreaker;
    if (!conf.habilitado || this.circuito.estado === 'cerrado') return { prueba: false };
    const ahora = Date.now();
    if (this.circuito.estado === 'abierto' && ahora >= this.circuito.abiertoHasta) {
      // Una transferencia jamás es la sonda de recuperación: primero debe prosperar una consulta.
      if (envio) throw new ErrorBanco('Banco temporalmente no disponible; la transferencia no fue enviada');
      if (this.circuito.probando) throw new ErrorBanco('Banco temporalmente no disponible; recuperación en curso');
      this.circuito.estado = 'semiabierto';
      this.circuito.probando = true;
      return { prueba: true };
    }
    if (this.circuito.estado === 'semiabierto') {
      if (envio || this.circuito.probando) throw new ErrorBanco('Banco temporalmente no disponible; recuperación en curso');
    }
    throw new ErrorBanco('Banco temporalmente no disponible; circuito de protección abierto');
  }

  registrarExitoCircuito() {
    this.circuito.estado = 'cerrado';
    this.circuito.fallos = 0;
    this.circuito.abiertoHasta = 0;
    this.circuito.probando = false;
  }

  registrarFalloCircuito(error, { prueba = false } = {}) {
    const conf = config.bdv.circuitBreaker;
    this.circuito.probando = false;
    if (!conf.habilitado) return;
    // Solo fallas de disponibilidad: red/timeout o HTTP 5xx. No abre por 4xx, auth ni errores funcionales.
    const disponibilidad = error instanceof ErrorBanco && (error.sinRespuesta || error.http >= 500 || error.http == null);
    if (!disponibilidad) {
      if (prueba) this.registrarExitoCircuito();
      return;
    }
    this.circuito.fallos += 1;
    if (prueba || this.circuito.fallos >= conf.umbralFallos) {
      this.circuito.estado = 'abierto';
      this.circuito.abiertoHasta = Date.now() + conf.esperaMs;
    }
  }

  invalidar() {
    if (this.cookie) this.cookieAnterior = this.cookie;
    this.cookie = null;
    this.vence = 0;
  }

  // Cambió la credencial: no se reusa la sesión anterior (era de otro usuario o de la clave vieja)
  olvidar() {
    this.invalidar();
    this.cookieAnterior = null;
  }

  // Estado de la sesión, sin forzar un login (para el panel de estado del sistema).
  estado() {
    return {
      uso: this.uso,
      ambiente: config.ambiente,
      conectado: Boolean(this.cookie && Date.now() < this.vence),
      venceEn: this.vence ? new Date(this.vence).toISOString() : null,
      circuito: this.estadoCircuito(),
    };
  }

  // Otro proceso (backend o jobs) pudo cambiar la credencial: se revisa como mucho una vez por minuto
  // y, si cambió (o se cargó la de envíos), la próxima llamada hace login con la nueva.
  async revisarCredencial() {
    if (!this.cookie || Date.now() - this.revisada < 60_000) return;
    this.revisada = Date.now();
    if ((await versionCredencial(config.ambiente, this.uso)) !== this.version) this.olvidar();
  }

  async sesion() {
    await this.revisarCredencial();
    if (this.cookie && Date.now() < this.vence) return;
    if (this.cookie) this.cookieAnterior = this.cookie; // renovación preventiva: se guarda por si el banco no da otra
    if (!this.renovando) this.renovando = this.login().finally(() => { this.renovando = null; });
    await this.renovando;
  }

  async login(cred = null) {
    const c = cred ?? (await leerCredencial(config.ambiente, this.uso))
      ?? (this.uso !== 'principal' ? await leerCredencial(config.ambiente, 'principal') : null);
    if (!c) throw new ErrorBanco('No hay credencial API cargada para este ambiente');
    const amb = c.ambiente ?? config.ambiente;
    const base = c.url.replace(/\/+$/, '');
    if (!urlDelAmbiente(amb, base)) throw new ErrorBanco(`La URL ${base} no corresponde al ambiente ${amb}`);
    // A veces el banco responde success sin Set-Cookie (p. ej. al renovar la sesión enseguida de otra):
    // se reintenta el login hasta 3 veces con espera creciente antes de dar error.
    let json, cookie = '';
    for (let intento = 1; intento <= 3 && !cookie; intento++) {
      if (intento > 1) await new Promise((ok) => setTimeout(ok, 1500 * (intento - 1)));
      const res = await this.fetch(`${base}/security/login`, {
        login: c.usuario,
        password: c.claveYaCifrada ? c.clave : cifrarClave(c.clave, c.rsaPublicKey), // el banco puede entregarla ya cifrada
        terminal: c.terminal,
        channel: c.channel,
        identification: c.identification,
      });
      json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new ErrorBanco('El banco rechazó el login', { http: res.status, codigo: json?.message?.code, respuesta: json?.message });
      }
      cookie = (res.headers.getSetCookie?.() ?? []).map((v) => v.split(';')[0]).join('; ');
      // Diagnóstico sin datos sensibles: solo nombres de encabezados y de campos de la respuesta
      if (!cookie) console.warn(`[banco] login sin Set-Cookie (intento ${intento}/3) · encabezados: ${[...res.headers.keys()].join(', ')} · campos: ${Object.keys(json ?? {}).join(', ')}`);
      // Sin Set-Cookie, la sesión puede venir en el campo sessionId de la respuesta, o seguir vigente la
      // anterior. Se prueba cada forma con getUserEntityInformation y se usa la primera que el banco acepta.
      if (!cookie) {
        const sid = json?.sessionId != null ? String(json.sessionId) : '';
        const candidatas = [
          ...(sid ? [['sessionId como cookie JSESSIONID', { cookie: `JSESSIONID=${sid}` }], ['sessionId como encabezado', { sessionId: sid }],
            ['sessionId como cookie sessionId', { cookie: `sessionId=${sid}` }]] : []),
          ...(!cred && this.cookieAnterior ? [['sesión anterior', this.cookieAnterior]] : []),
        ];
        for (const [nombre, credencialSesion] of candidatas) {
          const r = await this.fetch(`${base}/enrollment/getUserEntityInformation`, {}, credencialSesion).catch(() => null);
          const j = r?.ok ? await r.json().catch(() => null) : null;
          console.warn(`[banco] prueba de sesión "${nombre}": ${j?.success ? 'aceptada' : `rechazada (HTTP ${r?.status ?? '—'})`}`);
          if (j?.success) { cookie = credencialSesion; break; }
        }
      }
    }
    if (!cookie) throw new ErrorBanco('El banco no entregó una sesión utilizable (3 intentos). Probá de nuevo en un minuto.');
    // getUserEntityInformation carga datos del lado servidor necesarios para las demás APIs
    const r2 = await this.fetch(`${base}/enrollment/getUserEntityInformation`, {}, cookie);
    const j2 = await r2.json().catch(() => null);
    if (!r2.ok || !j2?.success) throw new ErrorBanco('Falló getUserEntityInformation', { http: r2.status, respuesta: j2?.message });
    if (cred) return { entidad: j2, login: json }; // prueba de conexión: no reemplaza la sesión vigente
    this.base = base;
    this.version = c.version;
    this.revisada = Date.now();
    this.cookie = cookie;
    this.vence = Date.now() + config.bdv.sesionMinutos * 60_000;
    return { entidad: j2, login: json };
  }

  // cookie: el texto de la cookie de sesión, o un objeto con los encabezados de sesión que acepta el banco
  async fetch(url, body, cookie = this.cookie, { sinRespuesta = false } = {}) {
    const sesion = !cookie ? {} : typeof cookie === 'object' ? cookie : { cookie };
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...sesion },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.bdv.timeoutMs),
      });
    } catch (e) {
      const conecto = !['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(e.cause?.code);
      throw new ErrorBanco(conecto && sinRespuesta ? `Sin respuesta del banco (${e.name})` : 'No se pudo conectar con el Banco de Valores',
        { sinRespuesta: conecto && sinRespuesta });
    }
  }

  // POST a una API privada. En consultas, si la sesión venció, renueva una vez y reintenta.
  // En envíos de dinero (envio: true) NUNCA se reintenta, y todo lo que no sea un rechazo
  // claro del banco (HTTP 5xx, respuesta ilegible) se marca sinRespuesta: resultado incierto.
  async llamar(ruta, body, { reintentar = true, envio = false } = {}) {
    const { prueba } = this.permitirPorCircuito({ envio });
    try {
      await this.sesion();
      const res = await this.fetch(`${this.base}/${ruta.replace(/^\//, '')}`, body, this.cookie, { sinRespuesta: true });
      if ((res.status === 401 || res.status === 403) && reintentar && !envio) {
        this.invalidar();
        // El reintento por sesión expirada pertenece a la misma llamada lógica y no vuelve a pasar por el breaker.
        await this.sesion();
        const segundo = await this.fetch(`${this.base}/${ruta.replace(/^\//, '')}`, body, this.cookie, { sinRespuesta: true });
        if (segundo.status === 401 || segundo.status === 403) this.invalidar();
        else if (segundo.ok && this.cookie) this.vence = Date.now() + config.bdv.sesionMinutos * 60_000;
        const json2 = await segundo.json().catch(() => null);
        if (!segundo.ok || json2 === null) {
          throw new ErrorBanco(`El banco respondió HTTP ${segundo.status} en ${ruta}`, { http: segundo.status });
        }
        this.registrarExitoCircuito();
        return json2;
      }
      if (res.status === 401 || res.status === 403) this.invalidar();
      // Vencimiento por inactividad: cada llamada que el banco atiende extiende la sesión.
      else if (res.ok && this.cookie) this.vence = Date.now() + config.bdv.sesionMinutos * 60_000;
      const json = await res.json().catch(() => null);
      if (!res.ok || json === null) {
        const incierto = envio && (res.status >= 500 || res.ok); // 4xx = rechazado antes de procesar
        throw new ErrorBanco(`El banco respondió HTTP ${res.status} en ${ruta}${incierto ? ' (resultado incierto)' : ''}`, { http: res.status, sinRespuesta: incierto });
      }
      this.registrarExitoCircuito();
      return json;
    } catch (error) {
      this.registrarFalloCircuito(error, { prueba });
      throw error;
    }
  }
}

export const bdv = new ClienteBdv();
export const bdvEnvios = new ClienteBdv('envios');

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
const exigirExito = (json, ruta) => {
  if (!json.success) throw new ErrorBanco(json.message?.message ?? `Error en ${ruta}`, { codigo: json.message?.code, respuesta: json.message });
  return json;
};

export async function cuentasPropias(cliente = bdv) {
  return exigirExito(await cliente.llamar('accounts/getOwnAccounts', {}), 'getOwnAccounts').accountsArray ?? [];
}

export async function detalleSaldos(cuenta) {
  return exigirExito(await bdv.llamar('accounts/getBalancesDetail', {
    productId: cuenta.productId, currencyId: cuenta.currencyId, productNumber: cuenta.productNumber, productAlias: cuenta.productAlias,
  }), 'getBalancesDetail');
}

export async function consultarCbu({ cbu = '', alias = '' }) {
  return exigirExito(await bdv.llamar('cbuInformation/getCustomerInformationCbu', { cbu, alias }), 'getCustomerInformationCbu');
}

// dd/mm/aaaa -> el PDF usa MM/DD/AAAA en getMovementsDetail
export const fechaMDY = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
export const fechaDMY = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// getMovementsDetail paginado de a 900: mode "0" la primera página, "1" con el
// sequential/uniqueSequential del último registro; corta cuando llegan menos de 900.
export async function movimientos(cuenta, desde, hasta, cliente = bdv) {
  const N = config.bdv.paginaMovimientos;
  const todos = [];
  let seq = '0', useq = '0';
  for (let pagina = 0; pagina < config.bdv.maxPaginasMovimientos; pagina++) {
    const json = exigirExito(await cliente.llamar('accounts/getMovementsDetail', {
      productId: cuenta.productId, currencyId: cuenta.currencyId, productNumber: cuenta.productNumber,
      numberOfMovements: N, sequential: seq, uniqueSequential: useq,
      initialDate: fechaMDY(desde), finalDate: fechaMDY(hasta),
      mode: pagina === 0 ? '0' : '1', serviceId: '3',
    }), 'getMovementsDetail');
    const filas = json.accountStatementArray ?? [];
    todos.push(...filas);
    if (filas.length < N) return { movimientos: todos, completo: true };
    const ultimo = filas.at(-1);
    seq = String(ultimo.sequential);
    useq = String(ultimo.uniqueSequential ?? ultimo.sequential);
  }
  return { movimientos: todos, completo: false }; // se alcanzó el tope de páginas configurado
}

// getTransfersStatus (ruta según PDF: echeq/getTransfersStatus), fechas dd/mm/aaaa
export async function estadoTransferencias(desde, hasta, tipo = 'T') {
  const json = exigirExito(await bdv.llamar('echeq/getTransfersStatus', {
    tipo, fechaInicial: fechaDMY(desde), fechaFinal: fechaDMY(hasta), beneficiario: '', importe: 0, secuencial: 0,
  }), 'getTransfersStatus');
  return json.transferStatusResponseArray ?? [];
}
