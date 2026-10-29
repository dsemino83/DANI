// SO · FranciscoIntent: interpreta pedidos en lenguaje natural de forma determinista (sin LLM).
// Devuelve una acción estructurada que la página ejecuta contra Supabase (con RLS), o { tipo: 'chat' } para que
// Francisco responda conversando. Módulo puro: sin DOM ni red (se prueba con node --test).

export const PALABRAS_PERSISTENCIA = ['guardar', 'guarda', 'registrar', 'registra', 'historico', 'historial', 'evolucion',
  'seguimiento', 'comparar periodos', 'comparar meses', 'consultar despues', 'acumular', 'acumula', 'cargar datos',
  'mantener informacion', 'estadisticas historicas', 'mes a mes', 'por mes'];

const TIPOS = [
  { re: /\b(dashboard|tablero|panel)\b/, tipo: 'dashboard' },
  { re: /\b(herramienta|calculadora|app|aplicacion)\b/, tipo: 'tool' },
  { re: /\b(formulario|planilla de carga)\b/, tipo: 'form' },
  { re: /\b(reporte|informe)\b/, tipo: 'report' },
];

// Campos por tema cuando el usuario no los dice (ajustables después con "agregale …").
const CAMPOS_TEMA = [
  { re: /venta|factura|ingreso/, campos: [['monto', 'Monto', 'number'], ['unidades', 'Unidades', 'number'], ['canal', 'Canal', 'text']] },
  { re: /gasto|costo|egreso/, campos: [['monto', 'Monto', 'number'], ['categoria', 'Categoría', 'text']] },
  { re: /stock|inventario|deposito/, campos: [['cantidad', 'Cantidad', 'number'], ['producto', 'Producto', 'text']] },
  { re: /cliente|lead|prospect/, campos: [['cantidad', 'Cantidad', 'number'], ['origen', 'Origen', 'text']] },
  { re: /hora|tiempo|productividad/, campos: [['horas', 'Horas', 'number'], ['tarea', 'Tarea', 'text']] },
];

export function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

export function clave(texto) {
  return normalizar(texto).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'campo';
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function requierePersistencia(texto) {
  const n = normalizar(texto);
  return PALABRAS_PERSISTENCIA.some((p) => n.includes(p));
}

function tipoDe(n) {
  for (const t of TIPOS) if (t.re.test(n)) return t.tipo;
  return null;
}

// "dashboard de ventas con histórico" → "ventas"
function tema(textoOriginal) {
  const m = textoOriginal.match(/(?:dashboard|tablero|panel|herramienta|reporte|informe|formulario|calculadora)\s+(?:de|para|del|sobre)\s+(?:la |las |los |el )?(.+?)(?=\s+(?:con|que|y|para|donde|mes a mes|por mes)\b|[.,;!?]|$)/i);
  return m ? m[1].trim() : '';
}

// "con campos monto, canal y vendedor" / "con columnas …"
export function camposExplicitos(textoOriginal) {
  const m = textoOriginal.match(/(?:campos?|columnas?|datos de)\s*:?\s+(.+?)(?=[.;!?]|$)/i);
  if (!m) return [];
  return m[1].split(/\s*,\s*|\s+y\s+/i).map((s) => s.trim()).filter(Boolean).slice(0, 20).map((s) => {
    const n = normalizar(s);
    const num = /monto|importe|cantidad|total|precio|unidades|horas|valor|numero|porcentaje|kpi/.test(n);
    const fecha = /fecha|dia/.test(n);
    return { key: clave(s), label: capital(s), type: num ? 'number' : fecha ? 'date' : 'text' };
  });
}

export function camposPorTema(t) {
  const n = normalizar(t);
  const hit = CAMPOS_TEMA.find((c) => c.re.test(n));
  const base = hit ? hit.campos : [['valor', 'Valor', 'number'], ['detalle', 'Detalle', 'text']];
  return base.map(([key, label, type]) => ({ key, label, type }));
}

// Resuelve "este dashboard", "el de ventas", "agregale…" contra los artefactos del registro.
export function resolverArtefacto(texto, artefactos, activoId) {
  const lista = (artefactos || []).filter((a) => !a.deleted_at);
  const n = normalizar(texto);
  const de = n.match(/\b(?:el|la|al|del) (?:dashboard |tablero |panel |herramienta |reporte )?de ([a-z0-9 ]+?)(?=\s+(?:con|a|al|y|que|como)\b|[.,;!?]|$)/);
  if (de) {
    const buscado = de[1].trim();
    const hit = lista.find((a) => normalizar(a.name).includes(buscado));
    if (hit) return hit;
  }
  for (const a of lista) if (n.includes(normalizar(a.name))) return a;
  const activo = lista.find((a) => a.id === activoId);
  if (activo) return activo;
  return lista.length === 1 ? lista[0] : null;
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

function permisoDe(n) {
  if (/\b(solo (ver|lectura|mirar)|ver nomas|lectura)\b/.test(n)) return 'VIEW';
  if (/\b(edit|editar|modificar|cambiar)/.test(n)) return 'EDIT';
  return 'USE';
}

// "1.500" y "1.500,25" (formato argentino) → 1500 y 1500.25; "12,5" → 12.5; ignora fechas.
function numeros(texto) {
  const sinFechas = String(texto).replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, ' ');
  return (sinFechas.match(/-?\d[\d.,]*/g) || []).map((s) => {
    s = s.replace(/[.,]$/, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    return Number(s);
  }).filter(Number.isFinite);
}

function fechaDe(n, hoy) {
  const iso = n.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const dmy = n.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  if (/\bayer\b/.test(n)) { const d = new Date(hoy); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
  return null;
}

/**
 * @param {string} texto pedido del usuario
 * @param {{ modo?: 'work'|'personal', artefactos?: any[], activoId?: string|null, hoy?: string }} ctx
 */
export function interpretar(texto, ctx = {}) {
  const original = String(texto || '').trim();
  const n = normalizar(original);
  const modo = ctx.modo || 'work';
  if (!n) return { tipo: 'vacio' };

  const quiereCrear = /\b(crea|crear|armar|arma|arme|hace|hacer|haceme|armame|creame|genera|generar|necesito|quiero|nuevo|nueva)/.test(n);
  const tipo = tipoDe(n);

  // Modo Personal: solo chat (nunca publica artefactos).
  if (modo === 'personal') {
    if (tipo && quiereCrear) return { tipo: 'bloqueado', motivo: 'personal' };
    return { tipo: 'chat' };
  }

  if (/\b(que|cuales) (dashboards|tableros|herramientas|artefactos)\b|\b(lista|listame|mostrame) (mis )?(dashboards|tableros|herramientas)/.test(n)) {
    return { tipo: 'listar' };
  }

  if (tipo && quiereCrear && !/\b(agrega|sumale|anadi)/.test(n)) {
    const t = tema(original) || capital(tipo === 'dashboard' ? 'general' : tipo);
    const explicitos = camposExplicitos(original);
    const persistente = requierePersistencia(original);
    const graf = /\b(torta|pie)\b/.test(n) ? 'pie' : /\bbarras?\b/.test(n) ? 'bar' : 'line';
    return {
      tipo: 'crear',
      artefacto: {
        type: tipo,
        name: `${tipo === 'dashboard' ? 'Dashboard' : capital(tipo === 'tool' ? 'herramienta' : tipo === 'form' ? 'formulario' : 'reporte')} de ${t}`.slice(0, 120),
        tema: t,
        persistentStorage: persistente,
        // Un dashboard o herramienta siempre necesita una fuente de datos para mostrar algo.
        campos: explicitos.length ? explicitos : camposPorTema(t),
        grafico: graf,
      },
    };
  }

  const art = resolverArtefacto(original, ctx.artefactos, ctx.activoId);

  const email = original.match(EMAIL);
  if (/\b(dejar? de compartir|deja de compartir|revoca|revocar|quitale el acceso|sacale el acceso)\b/.test(n)) {
    return art ? { tipo: 'revocar', artefactoId: art.id, email: email ? email[0].toLowerCase() : null } : { tipo: 'falta_artefacto' };
  }
  if (/\b(compart|pasale|dale acceso)/.test(n)) {
    if (!email) return { tipo: 'falta_email' };
    return art ? { tipo: 'compartir', artefactoId: art.id, email: email[0].toLowerCase(), permiso: permisoDe(n) } : { tipo: 'falta_artefacto' };
  }

  if (/\b(borra|borrar|elimina|eliminar|saca|sacar)\b/.test(n)) {
    if (/\b(datos|registros|historico|historial)\b/.test(n)) {
      return art ? { tipo: 'borrar_datos', artefactoId: art.id, requiereConfirmacion: true } : { tipo: 'falta_artefacto' };
    }
    if (/\b(dashboard|tablero|panel|herramienta|reporte|formulario|este|esta)\b/.test(n)) {
      return art ? { tipo: 'borrar_visualizacion', artefactoId: art.id } : { tipo: 'falta_artefacto' };
    }
  }

  const renom = original.match(/(?:cambiale el nombre|renombralo|renombrala|llamalo|llamala)\s*(?:a|como)?\s*["“]?([^"”]+?)["”]?\s*$/i);
  if (renom) return art ? { tipo: 'renombrar', artefactoId: art.id, nombre: renom[1].trim().slice(0, 120) } : { tipo: 'falta_artefacto' };

  if (/\b(agregale|agrega|agregar|sumale|anadile|anadi|incorpora)\b/.test(n)) {
    if (!art) return { tipo: 'falta_artefacto' };
    const g = n.match(/\bgrafico de (barras?|lineas?|torta)\b/);
    if (g) return { tipo: 'grafico', artefactoId: art.id, grafico: g[1].startsWith('barra') ? 'bar' : g[1].startsWith('torta') ? 'pie' : 'line' };
    const m = original.match(/(?:agregale|agregá|agrega|agregar|sumale|añadile|añadí|incorporá)\s+(?:un |una |el |la )?(?:campo|columna|metrica|métrica|dato|indicador|kpi)?\s*(?:de |del |para )?(.+?)(?=\s+(?:al|a este|a esta|en el|en este|en la)\b|[.;!?]|$)/i);
    const nombres = m ? m[1].split(/\s*,\s*|\s+y\s+/i).map((s) => s.trim()).filter(Boolean) : [];
    if (!nombres.length) return { tipo: 'chat' };
    return { tipo: 'agregar_campos', artefactoId: art.id, campos: camposExplicitos(`campos ${nombres.join(', ')}`) };
  }

  if (/\b(registra|registrar|carga|cargar|guarda|guardar|anota|anotar)\b/.test(n) && numeros(original).length) {
    if (!art) return { tipo: 'falta_artefacto' };
    return { tipo: 'registrar', artefactoId: art.id, numeros: numeros(original), texto: original, fecha: fechaDe(n, ctx.hoy || new Date().toISOString().slice(0, 10)) };
  }

  if (/\b(decidimos|de ahora en mas|a partir de ahora|siempre usa|prefiero|nunca uses?)\b/.test(n)) {
    return { tipo: 'decision', texto: original.slice(0, 2000), preferencia: /\b(prefiero|siempre|nunca)\b/.test(n) };
  }

  return { tipo: 'chat' };
}

// Arma un registro a partir de números y texto libre, respetando los campos del datasource.
export function armarRegistro(campos, accion) {
  const data = {};
  const nums = [...(accion.numeros || [])];
  const n = normalizar(accion.texto || '');
  for (const c of campos) {
    if (c.type === 'number' && nums.length) data[c.key] = nums.shift();
  }
  for (const c of campos) {
    if (c.type !== 'text') continue;
    const m = n.match(new RegExp(`\\b${normalizar(c.label || c.key).replace(/[^a-z0-9 ]/g, '')}\\s*:?\\s*([a-z0-9]+)`));
    if (m) data[c.key] = m[1];
  }
  return data;
}
