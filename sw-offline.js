// StockMasterr - funcionamiento sin conexión (se carga desde sw.js con importScripts)
//
//  1. LECTURAS: las pantallas piden sus datos a PHP; cada respuesta JSON correcta se guarda en el
//     dispositivo y, si luego no hay red, se muestra la última copia (máximo MAX_EDAD_DATOS).
//  2. REGISTROS: entradas, salidas y pedidos hechos sin red se guardan en una cola (IndexedDB) y se
//     envían solos al volver la conexión. Cada uno lleva una clave única; el servidor la usa para no
//     duplicarlo aunque el envío se repita (ver HTML/php/includes/idempotencia.php).
//  3. Las demás acciones (autorizar, rechazar, crear usuarios...) necesitan servidor: sin red se avisa.
//
// Los datos guardados pertenecen a la cuenta que los descargó: al cambiar de cuenta, o al cerrar sesión,
// se borran. La cola de pendientes se conserva y solo se envía con la cuenta que la creó.

'use strict';

const DATOS_CACHE = 'stockmasterr-datos';        // sin versión: una actualización de la app no borra los datos
const EXTERNOS_CACHE = 'stockmasterr-externos';
const MAX_EDAD_DATOS = 24 * 3600 * 1000;         // 24 h
const ESPERA_RED_LECTURA = 6000;                 // si la red tarda más, se muestra la copia guardada
const MAX_EXTERNOS = 80;

const RUTA_PHP = /\/HTML\/php\/(?:admin|gerente|operario|cliente)\/[A-Za-z_]+\.php$/;
const RUTAS_COLA = /\/HTML\/php\/(?:operario\/registrar_entrada|operario\/registrar_salida|cliente\/nuevo_pedido)\.php$/;
const EXTERNOS = new Set(['cdn.jsdelivr.net', 'images.unsplash.com', 'm.media-amazon.com', 'fonts.googleapis.com', 'fonts.gstatic.com']);

const MSG_REQUIERE_RED = 'Sin conexión. Esta acción necesita conexión con el servidor; inténtala cuando vuelva la red.';
const MSG_ENCOLADO = 'Sin conexión: el registro se guardó en este dispositivo y se enviará automáticamente cuando vuelva la red.';

// ---------------- IndexedDB ----------------
let _db = null;
function abrirDB() {
  return _db || (_db = new Promise((ok, mal) => {
    const r = indexedDB.open('stockmasterr-offline', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('cola', { keyPath: 'id' });
      r.result.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { _db = null; mal(r.error); };
  }));
}
const aPromesa = (r) => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });
async function idbGet(tienda, clave) { return aPromesa((await abrirDB()).transaction(tienda).objectStore(tienda).get(clave)); }
async function idbTodo(tienda) { return aPromesa((await abrirDB()).transaction(tienda).objectStore(tienda).getAll()); }
async function idbPut(tienda, valor) { return aPromesa((await abrirDB()).transaction(tienda, 'readwrite').objectStore(tienda).put(valor)); }
async function idbBorrar(tienda, clave) { return aPromesa((await abrirDB()).transaction(tienda, 'readwrite').objectStore(tienda).delete(clave)); }
async function metaGet(k) { const f = await idbGet('meta', k); return f ? f.v : null; }
function metaSet(k, v) { return idbPut('meta', { k, v }); }

// ---------------- utilidades ----------------
function respuestaJSON(estado, cuerpo, extra) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {})
  });
}
const esJSONok = (res) => res.ok && /json/i.test(res.headers.get('content-type') || '');

async function fetchConLimite(url, opciones, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, Object.assign({}, opciones, { signal: ctl.signal })); }
  finally { clearTimeout(t); }
}

async function avisarClientes(mensaje) {
  const lista = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  lista.forEach((c) => c.postMessage(mensaje));
}

// ---------------- 1. lecturas con copia local ----------------
async function guardarDato(cache, req, res) {
  const h = new Headers(res.headers);
  h.set('X-SM-Cached-At', String(Date.now()));
  await cache.put(req, new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: h }));
}

async function leerConCopia(event) {
  const req = event.request;
  const cache = await caches.open(DATOS_CACHE);

  const red = fetch(req).then((res) => {
    if (res.status >= 502 && res.status <= 504) throw new Error('puerta de enlace');
    if (res.ok && !/json/i.test(res.headers.get('content-type') || '')) throw new Error('respuesta no JSON (portal cautivo o proxy)');
    if (esJSONok(res)) event.waitUntil(guardarDato(cache, req, res.clone()).catch(() => {}));
    return res;
  });
  event.waitUntil(red.catch(() => {}));

  const limite = new Promise((_, mal) => setTimeout(() => mal(new Error('tiempo agotado')), ESPERA_RED_LECTURA));
  try {
    return await Promise.race([red, limite]);
  } catch (_) {
    const copia = await cache.match(req);
    const cuando = copia ? Number(copia.headers.get('X-SM-Cached-At') || 0) : 0;
    if (copia && cuando && Date.now() - cuando <= MAX_EDAD_DATOS) {
      avisarClientes({ tipo: 'datos-offline', ts: cuando });
      return copia;
    }
    return respuestaJSON(503, { success: false, offline: true, message: 'Sin conexión y sin datos guardados de esta pantalla.' });
  }
}

// ---------------- recursos de otros dominios (imágenes del catálogo, fuentes, SweetAlert) ----------------
async function recursoExterno(event) {
  const req = event.request;
  const cache = await caches.open(EXTERNOS_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    // En modo CORS la respuesta se puede guardar sin el sobrecoste de almacenamiento de las respuestas opacas.
    const res = await fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' }));
    if (res.ok && res.type === 'cors') {
      await cache.put(req.url, res.clone());
      const claves = await cache.keys();
      if (claves.length > MAX_EXTERNOS) await Promise.all(claves.slice(0, claves.length - MAX_EXTERNOS).map((k) => cache.delete(k)));
    }
    return res;
  } catch (_) {
    try { return await fetch(req); } catch (_) { return Response.error(); }
  }
}

// ---------------- 2. escrituras: directas, en cola o rechazadas ----------------
async function serializarCuerpo(req) {
  const tipo = req.headers.get('content-type') || '';
  if (/multipart\/form-data/i.test(tipo)) {
    const fd = await req.formData();
    const p = new URLSearchParams();
    for (const [k, v] of fd) if (typeof v === 'string') p.append(k, v);
    return { contentType: 'application/x-www-form-urlencoded', body: p.toString(), campos: Object.fromEntries(p) };
  }
  const txt = await req.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (_) { /* no es JSON */ }
  let campos = {};
  if (/x-www-form-urlencoded/i.test(tipo)) campos = Object.fromEntries(new URLSearchParams(txt));
  return { contentType: tipo || 'text/plain', body: txt, campos, json };
}

function resumenDe(ruta, d) {
  if (/registrar_entrada/.test(ruta)) return 'Entrada ' + (d.campos.numeroFactura || '') + ' · ' + (d.campos.cantidad || '?') + ' u.';
  if (/registrar_salida/.test(ruta)) return 'Salida ' + (d.campos.numeroPedido || '') + ' · ' + (d.campos.cantidad || '?') + ' u.';
  const n = d.json && Array.isArray(d.json.items) ? d.json.items.length : '?';
  return 'Pedido de ' + n + ' producto(s)';
}

async function manejarEscritura(req) {
  const ruta = new URL(req.url).pathname;
  if (!RUTAS_COLA.test(ruta)) {
    try { return await fetch(req); }
    catch (_) { return respuestaJSON(503, { success: false, offline: true, message: MSG_REQUIERE_RED }); }
  }

  const datos = await serializarCuerpo(req);
  const id = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2, 12);
  const cabeceras = { 'Content-Type': datos.contentType, 'X-Idempotency-Key': id };
  try {
    return await fetchConLimite(req.url, { method: 'POST', body: datos.body, headers: cabeceras, credentials: 'same-origin' }, 10000);
  } catch (_) {
    // Sin red (o red tan lenta que no responde): queda en cola con la MISMA clave. Si el primer intento sí
    // llegó al servidor, el reenvío devolverá la respuesta guardada en vez de duplicar el registro.
    await idbPut('cola', {
      id, url: req.url, tipo: datos.contentType, body: datos.body, resumen: resumenDe(ruta, datos),
      user: await metaGet('usuario'), creado: Date.now(), estado: 'pendiente', intentos: 0, error: null
    });
    pedirSincronizacion();
    avisarClientes({ tipo: 'cola-cambio' });
    return respuestaJSON(200, { success: true, queued: true, message: MSG_ENCOLADO });
  }
}

// ---------------- sincronización de la cola ----------------
function pedirSincronizacion() {
  try { if (self.registration && self.registration.sync) self.registration.sync.register('sm-cola').catch(() => {}); }
  catch (_) { /* el navegador no tiene Background Sync: la página lo pide al detectar la red */ }
}

let _sincronizando = null;
function sincronizar() {
  if (!_sincronizando) _sincronizando = _sincronizar().finally(() => { _sincronizando = null; });
  return _sincronizando;
}

async function _sincronizar() {
  const salida = { enviadas: 0, reintentar: false, alcanzado: null };   // alcanzado: ¿respondió el servidor? (null = no se intentó)
  const pendientes = (await idbTodo('cola')).filter((o) => o.estado === 'pendiente').sort((a, b) => a.creado - b.creado);
  if (!pendientes.length) return salida;

  let ses;
  try { ses = await fetchConLimite(new URL('HTML/php/sesion_info.php', self.registration.scope).href, { credentials: 'same-origin', cache: 'no-store' }, 8000); }
  catch (_) { salida.reintentar = true; salida.alcanzado = false; return salida; }
  salida.alcanzado = true;
  if (ses.status === 401) { await metaSet('sesion', false); await avisarClientes({ tipo: 'cola-cambio' }); return salida; }
  if (!esJSONok(ses)) { salida.reintentar = true; return salida; }
  const s = await ses.json();
  const actual = s.tipo + ':' + s.id;
  await metaSet('sesion', true);

  for (const op of pendientes) {
    if (op.user && op.user !== actual) continue;       // pertenece a otra cuenta: espera a que ella inicie sesión
    let res;
    try {
      res = await fetchConLimite(op.url, { method: 'POST', body: op.body, headers: { 'Content-Type': op.tipo, 'X-Idempotency-Key': op.id }, credentials: 'same-origin' }, 15000);
    } catch (_) { salida.reintentar = true; break; }

    if (res.status === 401) { await metaSet('sesion', false); break; }
    if (res.status >= 500 || res.status === 409 || !/json/i.test(res.headers.get('content-type') || '')) {
      op.intentos = (op.intentos || 0) + 1;
      await idbPut('cola', op);
      salida.reintentar = true;
      break;
    }
    const r = await res.json().catch(() => null);
    if (r && r.success) {
      await idbBorrar('cola', op.id);
      const hist = ((await metaGet('enviadas')) || []).concat([{ resumen: op.resumen, ts: Date.now() }]).slice(-10);
      await metaSet('enviadas', hist);
      salida.enviadas++;
    } else {
      op.estado = 'rechazada';
      op.error = (r && r.message) || ('El servidor respondió ' + res.status);
      await idbPut('cola', op);
    }
  }
  await avisarClientes({ tipo: 'cola-cambio', enviadas: salida.enviadas });
  return salida;
}

async function estadoCola() {
  const todas = (await idbTodo('cola')).sort((a, b) => a.creado - b.creado);
  const ver = (o) => ({ id: o.id, resumen: o.resumen, creado: o.creado, estado: o.estado, error: o.error });
  return {
    pendientes: todas.filter((o) => o.estado === 'pendiente').map(ver),
    rechazadas: todas.filter((o) => o.estado === 'rechazada').map(ver),
    enviadas: (await metaGet('enviadas')) || [],
    sesion: await metaGet('sesion'),
    usuario: await metaGet('usuario')
  };
}

// ---------------- mensajes de las páginas ----------------
async function atenderMensaje(m) {
  switch (m && m.tipo) {
    case 'estado': return estadoCola();
    case 'sincronizar': { const r = await sincronizar(); return Object.assign(await estadoCola(), { alcanzado: r.alcanzado }); }
    case 'usuario': {
      const previo = await metaGet('usuario');
      if (previo && previo !== m.clave) await caches.delete(DATOS_CACHE);   // otra cuenta: no se le muestran datos ajenos
      await metaSet('usuario', m.clave);
      await metaSet('sesion', true);
      return estadoCola();
    }
    case 'sesion': await metaSet('sesion', !!m.valor); return estadoCola();
    case 'purgar':                                   // cierre de sesión: se borran los datos descargados
      await caches.delete(DATOS_CACHE);
      await metaSet('usuario', null);
      await metaSet('sesion', false);
      return estadoCola();
    case 'descartar': await idbBorrar('cola', m.id); await avisarClientes({ tipo: 'cola-cambio' }); return estadoCola();
    default: return null;
  }
}
