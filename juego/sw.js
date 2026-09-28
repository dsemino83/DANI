/* Service worker de Misión: Dientes Limpios.
   - La página (index.html) se busca primero en internet, así siempre llega la última versión.
   - Audios, videos e imágenes se sirven desde el celular si ya se bajaron, y se actualizan
     en segundo plano. Así la app abre rápido y funciona aunque la señal sea mala. */
'use strict';
var CACHE = 'dientes-limpios-v1';
var BASE = ['./', 'index.html', 'manifest.webmanifest', 'recursos/app/icono-192.png', 'recursos/app/icono-512.png'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(BASE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.headers.has('range')) return; // los videos piden pedazos: van directo a internet
  if (req.mode === 'navigate' || req.url.endsWith('.html')) {
    ev.respondWith(fetch(req).then(function (r) {
      var copia = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); });
      return r;
    }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); }));
    return;
  }
  ev.respondWith(caches.match(req).then(function (guardada) {
    var red = fetch(req).then(function (r) {
      if (r.ok && r.status === 200) { var copia = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
      return r;
    }).catch(function () { return guardada; });
    return guardada || red;
  }));
});
