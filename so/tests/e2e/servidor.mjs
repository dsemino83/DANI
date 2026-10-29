// Servidor de pruebas compartido: sitio estático + config apuntando al Supabase simulado + Storage simulado con
// aislamiento por carpeta (Bearer del usuario) y URLs firmadas que expiran (token { u, p, exp }), como Supabase.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

export function crearServidor({ puerto, root, dir, tmp = null, extra = null }) {
  const objetos = new Map();
  const BASE = `http://localhost:${puerto}`;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('valo/vendor/supabase.js')) { res.setHeader('Content-Type', 'text/javascript'); return res.end(fs.readFileSync(path.join(dir, 'supabase-simulado.js'))); }
    if (p === '/so/config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(`window.SO_SUPABASE = { url: '${BASE}/fake-supa', anonKey: 'publica' };`); }
    if (p.startsWith('/fake-supa/storage/v1/object/sign/so-archivos/')) {
      const clave = p.slice('/fake-supa/storage/v1/object/sign/so-archivos/'.length);
      let t = null;
      try { t = JSON.parse(Buffer.from(u.searchParams.get('token') || '', 'base64').toString()); } catch { /* token inválido */ }
      if (!t || t.p !== clave || clave.split('/')[0] !== t.u) { res.statusCode = 400; return res.end('{"error":"InvalidSignature"}'); }
      if (Date.now() > t.exp) { res.statusCode = 400; return res.end('{"error":"ExpiredToken"}'); }
      if (!objetos.has(clave)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', 'application/octet-stream');
      if (u.searchParams.get('download')) res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(u.searchParams.get('download'))}"`);
      return res.end(objetos.get(clave));
    }
    if (p.startsWith('/fake-supa/storage/v1/object/so-archivos/')) {
      const clave = p.slice('/fake-supa/storage/v1/object/so-archivos/'.length);
      const quien = (req.headers.authorization || '').replace('Bearer ', '');
      if (!quien || clave.split('/')[0] !== quien) { res.statusCode = 403; return res.end('{"error":"forbidden"}'); }   // aislamiento por carpeta
      if (req.method === 'POST') {
        if (tmp && fs.existsSync(path.join(tmp, 'falla-storage'))) { res.statusCode = 503; return res.end('{}'); }
        if (objetos.has(clave) && req.headers['x-upsert'] === 'false') { res.statusCode = 409; return res.end('{"error":"Duplicate"}'); }
        const partes = []; req.on('data', (c) => partes.push(c)); req.on('end', () => { objetos.set(clave, Buffer.concat(partes)); res.end('{"Key":"ok"}'); }); return;
      }
      if (!objetos.has(clave)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', 'application/octet-stream'); return res.end(objetos.get(clave));
    }
    if (extra && extra(p, req, res) !== false) return;
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(root + '/404.html')); }
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream');
    res.end(fs.readFileSync(f));
  }).listen(puerto);
  return { srv, BASE, objetos };
}
