// Registro del Service Worker, botón de instalación y notificaciones push.
// Se incluye en todas las páginas HTML.
(() => {
  // Ruta base calculada desde la ubicación de este script (funciona en / y en /HTML/)
  const base = document.currentScript ? new URL('.', document.currentScript.src).href : '/';
  const API = base + 'HTML/php/push/';

  // ---------- Service Worker ----------
  const swListo = ('serviceWorker' in navigator)
    ? new Promise((res) => window.addEventListener('load', () => {
        navigator.serviceWorker.register(base + 'sw.js', { scope: base })
          .then(() => navigator.serviceWorker.ready).then(res)
          .catch((err) => { console.error('SW error:', err); res(null); });
      }))
    : Promise.resolve(null);

  // ---------- Botón "Instalar app" (Chrome/Edge/Android) ----------
  let deferred;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (document.getElementById('pwa-install')) return;
    const b = document.createElement('button');
    b.id = 'pwa-install';
    b.textContent = 'Instalar app';
    b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;padding:.7rem 1.2rem;border:0;border-radius:50px;background:#dc3545;color:#fff;font:700 .95rem system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35);cursor:pointer';
    b.onclick = async () => { b.remove(); deferred.prompt(); await deferred.userChoice; deferred = null; };
    document.body.appendChild(b);
  });
  window.addEventListener('appinstalled', () => document.getElementById('pwa-install')?.remove());

  // ---------- Notificaciones push ----------
  const esPanel = /panel_(admin|gerente|operario|cliente)\.html$/.test(location.pathname);
  const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const soportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const b64uAU8 = (t) => {
    const raw = atob((t + '='.repeat((4 - t.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const igualBytes = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((v, i) => v === new Uint8Array(b)[i]);

  const post = (url, cuerpo) => fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {})
  });

  async function claveServidor() {
    try {
      const r = await fetch(API + 'clave_publica.php', { cache: 'no-store' });
      const j = await r.json();
      return j.configurado ? j.clave : null;
    } catch (_) { return null; }
  }

  async function suscripcionActual() {
    const reg = await swListo;
    return reg ? reg.pushManager.getSubscription() : null;
  }

  const Push = {
    soportado,
    /** 'no-soportado' | 'ios-instalar' | 'no-configurado' | 'bloqueado' | 'inactivo' | 'activo' */
    async estado() {
      if (!soportado) return (esIOS && !instalada) ? 'ios-instalar' : 'no-soportado';
      if (!(await claveServidor())) return 'no-configurado';
      if (Notification.permission === 'denied') return 'bloqueado';
      const sub = await suscripcionActual();
      return (Notification.permission === 'granted' && sub) ? 'activo' : 'inactivo';
    },
    async activar() {
      const clave = await claveServidor();
      if (!clave) throw new Error('Las notificaciones no están configuradas en el servidor.');
      const permiso = await Notification.requestPermission();   // debe llamarse desde un clic
      if (permiso !== 'granted') throw new Error('Permiso de notificaciones no concedido.');
      const reg = await swListo;
      if (!reg) throw new Error('El service worker no está disponible.');
      const key = b64uAU8(clave);
      let sub = await reg.pushManager.getSubscription();
      if (sub && !igualBytes(sub.options.applicationServerKey, key.buffer)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const r = await post(API + 'suscribir.php', sub.toJSON());
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || 'No se pudo registrar el dispositivo.');
      return true;
    },
    async desactivar() {
      const sub = await suscripcionActual();
      if (sub) { try { await post(API + 'desuscribir.php', { endpoint: sub.endpoint }); } catch (_) {} await sub.unsubscribe(); }
    },
    /** Al cerrar sesión: el servidor deja de enviar a este dispositivo, pero el navegador conserva la suscripción
     *  (se vuelve a asociar sola cuando alguien inicia sesión y abre su panel). */
    async desvincular() {
      const sub = await suscripcionActual();
      if (sub) await post(API + 'desuscribir.php', { endpoint: sub.endpoint });
    },
    async probar() {
      const r = await post(API + 'probar.php');
      return (await r.json().catch(() => ({}))).message || 'No se pudo enviar.';
    },
    /** Reasocia en silencio la suscripción existente con la cuenta que tiene la sesión abierta. */
    async sincronizar() {
      if (!soportado || Notification.permission !== 'granted') return;
      const sub = await suscripcionActual();
      if (sub) await post(API + 'suscribir.php', sub.toJSON());
    }
  };
  window.StockPush = Push;

  // ---------- Funcionamiento sin conexión: copia de datos, cola de pendientes y aviso en pantalla ----------
  const mostrarOffline = 'serviceWorker' in navigator && !/(login|index)\.html$|\/$/.test(location.pathname);
  const PRECARGA = {   // pantallas de cada rol: se descargan con red para poder consultarlas sin ella
    operario: ['operario/proveedores', 'operario/productos', 'operario/clientes', 'operario/entradas', 'operario/salidas', 'operario/mercancia'],
    gerente: ['gerente/entradas_pendientes', 'gerente/salidas_pendientes', 'gerente/inventario'],
    administrador: ['admin/usuarios', 'admin/proveedores', 'admin/productos', 'admin/inventario', 'admin/reporte_entradas', 'admin/reporte_salidas', 'admin/reporte_inventario'],
    cliente: ['cliente/productos_disponibles']
  };

  /** Habla con el service worker y espera su respuesta (null si no responde). */
  function aSW(mensaje, ms) {
    return swListo.then((reg) => new Promise((ok) => {
      const w = reg && reg.active;
      if (!w) return ok(null);
      const canal = new MessageChannel();
      const t = setTimeout(() => ok(null), ms || 4000);
      canal.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); };
      w.postMessage(mensaje, [canal.port2]);
    }));
  }

  const Offline = {
    estado: null,          // {pendientes, rechazadas, enviadas, sesion, usuario}
    sinRed: !navigator.onLine,
    datosDesde: null,      // cuándo se descargaron los datos que se están mostrando
    async refrescar() {
      const e = await aSW({ tipo: 'estado' });
      if (e && !e.error) Offline.estado = e;
      pintarEstado();
      return Offline.estado;
    },
    async sincronizar() {
      const e = await aSW({ tipo: 'sincronizar' }, 30000);
      if (e && !e.error) {
        Offline.estado = e;
        if (e.alcanzado === true) { Offline.sinRed = false; Offline.datosDesde = null; }   // el servidor respondió
        if (e.alcanzado === false) Offline.sinRed = true;
      }
      pintarEstado();
      return e;
    },
    purgar: () => aSW({ tipo: 'purgar' })
  };
  window.StockOffline = Offline;

  const hora = (ts) => new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  let barra = null, aviso = '', avisoTimer = null, vigilando = null;

  function mostrarAviso(texto) {
    aviso = texto; clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { aviso = ''; pintarEstado(); }, 6000);
    pintarEstado();
  }

  const boton = (txt, fn, estilo) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = txt; b.onclick = fn;
    b.style.cssText = 'border:0;border-radius:50px;padding:.4rem .8rem;font:inherit;cursor:pointer;' + (estilo || 'background:#495057;color:#fff');
    return b;
  };

  function pintarEstado() {
    if (!mostrarOffline || !document.body) return;
    const e = Offline.estado || { pendientes: [], rechazadas: [], sesion: null };
    const pend = e.pendientes.length, rech = e.rechazadas.length;
    const lineas = [];
    if (aviso) lineas.push(aviso);
    if (Offline.sinRed) lineas.push('Sin conexión' + (Offline.datosDesde ? ' · datos guardados de las ' + hora(Offline.datosDesde) : ''));
    if (pend) lineas.push(pend + ' registro(s) pendiente(s) de enviar');
    if (pend && e.sesion === false && !Offline.sinRed) lineas.push('Inicia sesión para enviarlos');
    if (rech) lineas.push(rech + ' rechazado(s) por el servidor');
    if (!lineas.length) { if (barra) { barra.remove(); barra = null; } return; }

    if (!barra) {
      barra = document.createElement('div');
      barra.id = 'sm-estado';
      barra.setAttribute('role', 'status');
      barra.style.cssText = 'position:fixed;left:16px;right:16px;bottom:72px;max-width:460px;margin:0 auto;z-index:9998;padding:.6rem .8rem;border-radius:14px;background:#212529;color:#f8f9fa;font:600 .85rem system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:.45rem';
      document.body.appendChild(barra);
    }
    barra.replaceChildren();
    lineas.forEach((t) => { const d = document.createElement('div'); d.textContent = t; barra.appendChild(d); });
    const acciones = document.createElement('div');
    acciones.style.cssText = 'display:flex;gap:.4rem;flex-wrap:wrap';
    if (pend || rech) acciones.appendChild(boton('Ver', verPendientes));
    if (pend && !Offline.sinRed && e.sesion !== false) acciones.appendChild(boton('Enviar ahora', () => Offline.sincronizar(), 'background:#dc3545;color:#fff'));
    if (pend && e.sesion === false) acciones.appendChild(boton('Iniciar sesión', () => { location.href = base + 'HTML/login.html'; }, 'background:#dc3545;color:#fff'));
    if (acciones.children.length) barra.appendChild(acciones);
  }

  function verPendientes() {
    const e = Offline.estado || { pendientes: [], rechazadas: [] };
    const velo = document.createElement('div');
    velo.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    const caja = document.createElement('div');
    caja.style.cssText = 'background:#fff;color:#212529;border-radius:14px;max-width:480px;width:100%;max-height:80vh;overflow:auto;padding:1rem;font:500 .9rem system-ui,sans-serif';
    const titulo = document.createElement('h3');
    titulo.textContent = 'Registros guardados en este dispositivo';
    titulo.style.cssText = 'margin:0 0 .6rem;font-size:1.05rem';
    caja.appendChild(titulo);
    const todos = e.pendientes.concat(e.rechazadas);
    if (!todos.length) { const v = document.createElement('p'); v.textContent = 'No hay registros pendientes.'; caja.appendChild(v); }
    todos.forEach((o) => {
      const fila = document.createElement('div');
      fila.style.cssText = 'border-top:1px solid #dee2e6;padding:.55rem 0;display:flex;flex-direction:column;gap:.25rem';
      const t = document.createElement('div');
      t.textContent = o.resumen;                      // textContent: el contenido viene del usuario
      t.style.fontWeight = '700';
      const d = document.createElement('div');
      d.style.cssText = 'color:#6c757d;font-size:.8rem';
      d.textContent = (o.estado === 'rechazada' ? 'Rechazado: ' + (o.error || 'sin detalle') : 'Pendiente de enviar') + ' · capturado a las ' + hora(o.creado);
      if (o.estado === 'rechazada') d.style.color = '#b02a37';
      const q = boton(o.estado === 'rechazada' ? 'Descartar' : 'Descartar (no se enviará)', async () => {
        if (!confirm('¿Descartar este registro? No se enviará al servidor.')) return;
        await aSW({ tipo: 'descartar', id: o.id });
        velo.remove(); await Offline.refrescar(); if (((Offline.estado || {}).pendientes || []).length + ((Offline.estado || {}).rechazadas || []).length) verPendientes();
      }, 'background:#e9ecef;color:#212529;align-self:flex-start');
      fila.append(t, d, q);
      caja.appendChild(fila);
    });
    const cerrar = boton('Cerrar', () => velo.remove(), 'background:#212529;color:#fff;margin-top:.6rem');
    caja.appendChild(cerrar);
    velo.appendChild(caja);
    velo.onclick = (ev) => { if (ev.target === velo) velo.remove(); };
    document.body.appendChild(velo);
  }

  /** Mientras se sepa que no hay servidor, comprueba cada 15 s si ya volvió y entonces envía los pendientes. */
  function vigilarRed() {
    if (vigilando) return;
    vigilando = setInterval(async () => {
      try {
        await fetch(base + 'HTML/php/sesion_info.php', { credentials: 'same-origin', cache: 'no-store' });
        clearInterval(vigilando); vigilando = null;
        Offline.sinRed = false; Offline.datosDesde = null;
        await Offline.sincronizar();
      } catch (_) { /* sigue sin red */ }
    }, 15000);
  }

  async function precargar(rol, clave) {
    const lista = PRECARGA[rol];
    if (!lista) return;
    // No se repite si se hizo hace menos de 5 min para ESTA cuenta y los datos siguen guardados.
    let guardados = 0;
    try { guardados = (await (await caches.open('stockmasterr-datos')).keys()).length; } catch (_) { /* sin Cache API */ }
    try {
      const t = Number(sessionStorage.getItem('sm-precarga-' + clave) || 0);
      if (Date.now() - t < 5 * 60 * 1000 && guardados >= lista.length) return;
      sessionStorage.setItem('sm-precarga-' + clave, String(Date.now()));
    } catch (_) { /* sin sessionStorage */ }
    for (const ruta of lista) {
      try { await fetch(base + 'HTML/php/' + ruta + '.php', { credentials: 'same-origin' }); } catch (_) { return; }
    }
  }

  async function iniciarOffline() {
    let ses = null;
    try {
      const r = await fetch(base + 'HTML/php/sesion_info.php', { credentials: 'same-origin', cache: 'no-store' });
      Offline.sinRed = false;
      if (r.status === 401) await aSW({ tipo: 'sesion', valor: false });
      else if (r.ok) { ses = await r.json(); await aSW({ tipo: 'usuario', clave: ses.tipo + ':' + ses.id, rol: ses.rol }); }
    } catch (_) { Offline.sinRed = true; vigilarRed(); }
    await Offline.refrescar();
    if (ses) {
      precargar(ses.rol, ses.tipo + ':' + ses.id);
      if (Offline.estado && Offline.estado.pendientes.length) Offline.sincronizar();
    }
  }

  if (mostrarOffline) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.tipo === 'datos-offline') { Offline.sinRed = true; Offline.datosDesde = m.ts; pintarEstado(); vigilarRed(); }
      if (m.tipo === 'cola-cambio') {
        if (m.enviadas) mostrarAviso(m.enviadas + ' registro(s) enviado(s) al servidor');
        Offline.refrescar();
      }
    });
    window.addEventListener('online', () => { Offline.sinRed = false; Offline.datosDesde = null; Offline.sincronizar(); });
    window.addEventListener('offline', () => { Offline.sinRed = true; pintarEstado(); vigilarRed(); });
    setInterval(() => {   // respaldo para navegadores sin Background Sync
      const e = Offline.estado;
      if (e && e.pendientes.length && !Offline.sinRed && e.sesion !== false) Offline.sincronizar();
    }, 20000);
    document.addEventListener('DOMContentLoaded', iniciarOffline);
  }


  if (esPanel) {
    // Al cerrar sesión: se borran los datos descargados en este dispositivo y se desvincula de los avisos
    // (máx. 2.5 s); si no hay conexión, igualmente se sale y la sesión del servidor caduca sola.
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a.logout');
      if (!a) return;
      e.preventDefault();
      const pend = (Offline.estado && Offline.estado.pendientes.length) || 0;
      if (pend > 0 && !confirm('Hay ' + pend + ' registro(s) sin enviar. Se conservan en este dispositivo y se enviarán cuando esta misma cuenta inicie sesión con conexión.\n\n¿Cerrar sesión de todos modos?')) return;
      const tareas = [Offline.purgar()];
      if (soportado) tareas.push(Push.desvincular());
      Promise.race([Promise.allSettled(tareas), new Promise((r) => setTimeout(r, 2500))])
        .finally(() => { location.href = a.href; });
    });

    document.addEventListener('DOMContentLoaded', async () => {
      const estado = await Push.estado();
      if (estado === 'no-soportado' || estado === 'no-configurado') return;
      if (estado === 'activo') Push.sincronizar().catch(() => {});

      const caja = document.createElement('div');
      caja.id = 'push-ui';
      caja.setAttribute('role', 'region');
      caja.setAttribute('aria-label', 'Notificaciones');
      caja.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9999;display:flex;align-items:center;gap:.4rem;padding:.35rem;border-radius:50px;background:#212529;color:#f8f9fa;font:600 .85rem system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35)';
      const btn = (txt, fn, estilo) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = txt; b.onclick = fn;
        b.style.cssText = 'border:0;border-radius:50px;padding:.5rem .9rem;font:inherit;cursor:pointer;' + (estilo || 'background:#dc3545;color:#fff');
        return b;
      };
      const msg = document.createElement('span');
      msg.setAttribute('aria-live', 'polite');
      msg.style.cssText = 'padding:0 .5rem';

      async function pintar() {
        caja.replaceChildren();
        const e = await Push.estado();
        if (e === 'activo') {
          msg.textContent = 'Avisos activos';
          caja.append(msg,
            btn('Probar', async (ev) => { ev.target.disabled = true; const r = await Push.probar(); ev.target.disabled = false; alert(r); }, 'background:#495057;color:#fff'),
            btn('Desactivar', async () => { await Push.desactivar(); pintar(); }, 'background:transparent;color:#adb5bd'));
        } else if (e === 'bloqueado') {
          msg.textContent = 'Avisos bloqueados en el navegador';
          caja.append(msg, btn('¿Cómo activarlos?', () => alert('Haz clic en el candado junto a la dirección del sitio, abre "Configuración del sitio" y cambia Notificaciones a "Permitir". Después recarga la página.'), 'background:#495057;color:#fff'));
        } else if (e === 'ios-instalar') {
          caja.append(btn('Recibir avisos', () => alert('En iPhone y iPad, primero instala la app: toca Compartir y luego "Agregar a pantalla de inicio". Ábrela desde ese ícono para activar los avisos.')));
        } else {
          caja.append(btn('Activar avisos', async () => {
            try { await Push.activar(); } catch (err) { alert(err.message); }
            pintar();
          }));
        }
      }
      await pintar();
      document.body.appendChild(caja);
    });
  }
})();
