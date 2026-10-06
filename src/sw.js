/* Service worker: guarda la app en el dispositivo para que funcione sin internet.
   build.mjs completa la versión y la lista de archivos en cada compilación. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const APP_CACHE = 'cortafuego-app-' + VERSION;
const FONT_CACHE = 'cortafuego-fuentes';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('cortafuego-app-') && k !== APP_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// la página pide activar la versión nueva cuando el usuario toca "Actualizar"
self.addEventListener('message', event => { if (event.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // fuentes de Google: se guardan la primera vez y después funcionan sin conexión
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') cache.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;

  // abrir la app: siempre la versión guardada (las actualizaciones llegan por el service worker)
  if (req.mode === 'navigate') {
    event.respondWith((async () => (await caches.match(new URL('./', self.location).href, {ignoreSearch:true})) || (await caches.match(new URL('index.html', self.location).href)) || fetch(req))());
    return;
  }
  // archivos de la app: primero el guardado; si no está, la red
  event.respondWith((async () => {
    const hit = await caches.match(req, {ignoreSearch:true});
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) { const c = await caches.open(APP_CACHE); c.put(req, res.clone()); }
    return res;
  })());
});
