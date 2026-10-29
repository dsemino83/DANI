// SO · controles para llamar APIs externas desde el servidor: solo HTTPS público (anti-SSRF), sin credenciales en la
// URL, límites de tamaño, y detección de la tabla dentro de la respuesta. Puro: lo usan la Edge Function y los tests.

const HOSTS_PROHIBIDOS = /^(localhost|metadata(\.google)?\.internal|metadata|instance-data)$|\.(localhost|local|internal|intranet|lan|home\.arpa|corp)$/i;

function v4(ip) {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

export function ipPrivada(ip) {
  const s = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  const a = v4(s);
  if (a) {
    const [x, y] = a;
    return x === 0 || x === 10 || x === 127 || x >= 224 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254)
      || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 192 && y === 0 && (a[2] === 0 || a[2] === 2))
      || (x === 198 && (y === 18 || y === 19)) || (x === 198 && y === 51 && a[2] === 100) || (x === 203 && y === 0 && a[2] === 113);
  }
  if (s.includes(':')) {
    const mapeada = s.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeada) return ipPrivada(mapeada[1]);
    const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) { const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16); return ipPrivada([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || /^2001:db8:/.test(s) || /^0{0,4}:/.test(s) && s !== '::';
  }
  return false;
}

export function esIpLiteral(host) {
  return !!v4(host) || /^\[?[0-9a-f:.]+\]?$/i.test(host) && host.includes(':');
}

/** @returns {{ ok: true, url: URL } | { ok: false, motivo: string }} */
export function validarUrl(texto) {
  let u;
  try { u = new URL(String(texto)); } catch { return { ok: false, motivo: 'la dirección no es válida' }; }
  if (u.protocol !== 'https:') return { ok: false, motivo: 'solo se permiten direcciones https' };
  if (u.username || u.password) return { ok: false, motivo: 'la dirección no puede incluir usuario o contraseña: la credencial va aparte' };
  if (u.port && u.port !== '443') return { ok: false, motivo: 'solo se permite el puerto estándar (443)' };
  const host = u.hostname.replace(/\.$/, '');
  if (HOSTS_PROHIBIDOS.test(host) || !host.includes('.') && !esIpLiteral(host)) return { ok: false, motivo: 'esa dirección es interna' };
  if (esIpLiteral(host) && ipPrivada(host)) return { ok: false, motivo: 'esa dirección es privada o interna' };
  return { ok: true, url: u };
}

export async function leerConLimite(resp, maxBytes) {
  const lector = resp.body?.getReader();
  if (!lector) return '';
  const partes = []; let total = 0;
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await lector.cancel(); throw new Error(`la respuesta supera ${Math.round(maxBytes / 1024)} KB`); }
    partes.push(value);
  }
  const todo = new Uint8Array(total); let o = 0;
  for (const p of partes) { todo.set(p, o); o += p.length; }
  return new TextDecoder().decode(todo);
}

// Aplana un objeto a un nivel ("a.b"), ignorando arreglos anidados.
export function aplanar(obj, pref = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = pref ? `${pref}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(out).length < 200) aplanar(v, key, out);
    else if (!Array.isArray(v)) out[key] = v;
  }
  return out;
}

// Encuentra la "tabla" dentro de un JSON: el arreglo de objetos más grande, o un mapa clave→número (p. ej. cotizaciones).
export function detectarTabla(json, ruta = null) {
  const en = (o, r) => r.split('.').filter(Boolean).reduce((x, k) => (x == null ? x : x[k]), o);
  if (ruta) { const v = en(json, ruta); if (Array.isArray(v)) return { ruta, filas: v.filter((x) => x && typeof x === 'object').map((x) => aplanar(x)) }; }
  let mejor = null;
  const visitar = (o, r, prof) => {
    if (prof > 5 || o == null || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      const objs = o.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (objs.length && (!mejor || objs.length > mejor.filas.length)) mejor = { ruta: r, filas: objs.map((x) => aplanar(x)) };
      return;
    }
    const vals = Object.entries(o);
    if (vals.length >= 2 && vals.every(([, v]) => typeof v === 'number') && (!mejor || vals.length > mejor.filas.length)) {
      mejor = { ruta: r, filas: vals.map(([clave, valor]) => ({ clave, valor })) };
    }
    for (const [k, v] of vals) visitar(v, r ? `${r}.${k}` : k, prof + 1);
  };
  visitar(json, '', 0);
  if (!mejor && json && typeof json === 'object' && !Array.isArray(json)) mejor = { ruta: '', filas: [aplanar(json)] };
  return mejor || { ruta: '', filas: [] };
}

// Filas (objetos planos) → matriz con encabezado, para reutilizar el mismo perfil/mapeo que los archivos.
export function aMatriz(filas, max = 5000) {
  const cols = [...new Set(filas.slice(0, 200).flatMap((f) => Object.keys(f)))].slice(0, 60);
  return [cols, ...filas.slice(0, max).map((f) => cols.map((c) => f[c] ?? null))];
}
