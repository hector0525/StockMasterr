// StockMasterr - Service Worker
// Sube VERSION cada vez que cambies archivos estáticos para renovar la caché.
// (Los datos descargados y la cola de pendientes NO dependen de VERSION: se conservan al actualizar.)
const VERSION = 'v6';
const STATIC_CACHE = `stockmasterr-static-${VERSION}`;
const OFFLINE_URL = 'offline.html';

importScripts('sw-offline.js');   // datos sin conexión, cola de registros y sincronización

const PRECACHE = [
  './',
  'index.html',
  OFFLINE_URL,
  'manifest.json',
  'scrip.js',
  'pwa.js',
  'CSS/styles.css',
  // pantallas: todas, para poder abrirlas sin conexión aunque no se hayan visitado antes
  'HTML/login.html',
  'HTML/panel_admin.html',
  'HTML/panel_gerente.html',
  'HTML/panel_operario.html',
  'HTML/panel_cliente.html',
  'HTML/inventario.html',
  'HTML/pedidos.html',
  'HTML/productos.html',
  'HTML/css/login.css',
  'HTML/css/panel_admin.css',
  'HTML/css/inventario.css',
  'HTML/css/pedidos.css',
  'HTML/css/productos.css',
  'HTML/img/f1.jpg',
  'HTML/img/f2.jpeg',
  'HTML/img/f3.jpg',
  'HTML/img/f4.avif',
  'HTML/img/icons/admin.svg',
  'HTML/img/icons/home.png',
  'icons/icon-192x192.png',
  'icons/icon-512x512.png',
  'icons/icon-maskable-512x512.png',
  'icons/apple-touch-icon.png',
  'icons/badge-72x72.png',
  'icons/favicon-32x32.png',
  'icons/favicon-48x48.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // allSettled: un archivo faltante no debe tumbar toda la instalación
      Promise.allSettled(PRECACHE.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('stockmasterr-static-') && k !== STATIC_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Otros dominios: solo imágenes, fuentes y scripts conocidos (catálogo, Google Fonts, SweetAlert)
  if (url.origin !== location.origin) {
    if (req.method === 'GET' && EXTERNOS.has(url.hostname) && ['image', 'script', 'style', 'font'].includes(req.destination)) {
      event.respondWith(recursoExterno(event));
    }
    return;
  }

  // Escrituras desde las pantallas (fetch): directas, en cola si no hay red, o aviso claro
  if (req.method === 'POST' && req.mode !== 'navigate' && RUTA_PHP.test(url.pathname)) {
    event.respondWith(manejarEscritura(req));
    return;
  }

  if (req.method !== 'GET') return;                 // POST (login, formularios) siempre a red

  // Cerrar sesión sin conexión: se vuelve al inicio de sesión (la sesión del servidor caduca sola)
  if (req.mode === 'navigate' && url.pathname.endsWith('/php/logout.php')) {
    event.respondWith(fetch(req).catch(() => Response.redirect(new URL('HTML/login.html', self.registration.scope).href, 302)));
    return;
  }

  // Datos de las pantallas: red primero y, si no hay, la última copia guardada
  if (RUTA_PHP.test(url.pathname)) {
    event.respondWith(leerConCopia(event));
    return;
  }

  if (url.pathname.endsWith('.php')) return;        // sesión, login, push: NUNCA cachear

  // Navegación (páginas HTML): red primero, caché y luego pantalla offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match(OFFLINE_URL))
    );
    return;
  }

  // Estáticos (css, js, imágenes): sirve caché y actualiza en segundo plano
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// Background Sync: el navegador nos despierta cuando vuelve la red, aunque la app esté cerrada
self.addEventListener('sync', (event) => {
  if (event.tag !== 'sm-cola') return;
  event.waitUntil(sincronizar().then((r) => { if (r.reintentar) throw new Error('reintentar'); }));
});

// Mensajes de las páginas (estado de la cola, sincronizar, usuario, purgar...)
self.addEventListener('message', (event) => {
  const puerto = event.ports && event.ports[0];
  event.waitUntil(
    atenderMensaje(event.data)
      .then((r) => { if (puerto) puerto.postMessage(r); })
      .catch((e) => { if (puerto) puerto.postMessage({ error: String(e && e.message || e) }); })
  );
});

// ---------------- Notificaciones push ----------------
function b64uAUint8(txt) {
  const b64 = (txt + '='.repeat((4 - txt.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Llega un mensaje del servidor: se muestra aunque la app esté cerrada.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (_) { d = { body: event.data ? event.data.text() : '' }; }

  const opciones = {
    body: d.body || '',
    icon: d.icon || 'icons/icon-192x192.png',
    badge: d.badge || 'icons/badge-72x72.png',
    lang: 'es',
    data: { url: d.url || './' }
  };
  if (d.tag) { opciones.tag = d.tag; opciones.renotify = true; } // misma etiqueta = reemplaza la anterior

  event.waitUntil(self.registration.showNotification(d.title || 'StockMaster', opciones));
});

// Al tocar la notificación: enfocar la app si ya está abierta o abrirla en la pantalla indicada.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (lista) => {
      const igual = lista.find((c) => c.url === destino);
      if (igual) return igual.focus();
      const alguna = lista[0];
      if (alguna && 'navigate' in alguna) {
        const c = await alguna.focus();
        return c.navigate(destino);
      }
      return self.clients.openWindow(destino);
    })
  );
});

// El navegador renovó o invalidó la suscripción: se vuelve a suscribir y se avisa al servidor.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const k = await (await fetch('HTML/php/push/clave_publica.php', { cache: 'no-store' })).json();
      if (!k.configurado) return;
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: b64uAUint8(k.clave)
      });
      await fetch('HTML/php/push/suscribir.php', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON())
      });
    } catch (_) { /* se reintentará al abrir el panel */ }
  })());
});
