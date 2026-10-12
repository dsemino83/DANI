/* Service worker de Tareas de Rami.
   - Permite mostrar el aviso «¡Tiempo!» del sistema cuando la app quedó en segundo plano.
   - Guarda la página y los fondos para que abra rápido aunque la señal sea mala. */
'use strict';
var CACHE = 'tareas-de-rami-v1';
var BASE = ['./', 'index.html', 'manifest.webmanifest', 'fondos/icono-192.png', 'fondos/bano.jpg', 'fondos/hotel.jpg'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(BASE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('tareas-de-rami') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.headers.has('range')) return; // los videos van directo a internet
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
// Tocar el aviso abre (o trae al frente) la app.
self.addEventListener('notificationclick', function (ev) {
  ev.notification.close();
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ws) {
    for (var i = 0; i < ws.length; i++) if ('focus' in ws[i]) return ws[i].focus();
    return self.clients.openWindow('./');
  }));
});
