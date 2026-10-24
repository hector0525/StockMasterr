<?php
/**
 * Notificaciones push de StockMaster: suscripciones en MySQL y avisos por evento.
 * Toda función "notificar*" es segura: nunca lanza excepciones ni rompe la operación que la llama.
 */
require_once __DIR__ . '/webpush.php';

/** Claves VAPID desde variables de entorno (ver .env.example y tools/generar_vapid.php). */
function push_config(): ?array {
    $pub  = getenv('VAPID_PUBLIC_KEY');
    $priv = getenv('VAPID_PRIVATE_KEY');
    if (!$pub || !$priv) return null;
    return ['public' => $pub, 'private' => $priv, 'subject' => getenv('VAPID_SUBJECT') ?: 'mailto:admin@localhost'];
}

/** Crea la tabla si no existe (así funciona aunque la BD se haya creado con la versión anterior). */
function push_asegurar_tabla(mysqli $conn): void {
    static $hecho = false;
    if ($hecho) return;
    $conn->query("CREATE TABLE IF NOT EXISTS push_suscripciones (
        id INT PRIMARY KEY AUTO_INCREMENT,
        tipo ENUM('usuario','cliente') NOT NULL,
        idPersona INT NOT NULL,
        rol VARCHAR(20) NOT NULL,
        endpoint TEXT NOT NULL,
        endpoint_hash CHAR(64) NOT NULL,
        p256dh VARCHAR(255) NOT NULL,
        auth VARCHAR(100) NOT NULL,
        user_agent VARCHAR(255),
        creado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_endpoint (endpoint_hash),
        INDEX idx_persona (tipo, idPersona),
        INDEX idx_rol (rol)
    ) ENGINE=InnoDB");
    $hecho = true;
}

/** Datos de la sesión actual; null si no hay sesión válida. */
function push_sesion(): ?array {
    if (session_status() === PHP_SESSION_NONE) session_start();
    if (empty($_SESSION['rol']) || empty($_SESSION['id']) || empty($_SESSION['tipo'])) return null;
    return ['tipo' => $_SESSION['tipo'], 'id' => (int) $_SESSION['id'], 'rol' => $_SESSION['rol']];
}

/** Nombre del usuario en sesión, sin bloquear el archivo de sesión. */
function push_nombre_sesion(string $porDefecto = 'Un operario'): string {
    if (session_status() === PHP_SESSION_NONE) session_start(['read_and_close' => true]);
    return $_SESSION['usuario'] ?? $porDefecto;
}

function push_guardar(mysqli $conn, array $ses, string $endpoint, string $p256dh, string $auth, string $ua): bool {
    push_asegurar_tabla($conn);
    $hash = hash('sha256', $endpoint);
    $ua   = mb_substr($ua, 0, 255);
    // Si el mismo navegador se suscribe con otra cuenta, la suscripción pasa a la cuenta actual.
    $st = $conn->prepare("INSERT INTO push_suscripciones (tipo,idPersona,rol,endpoint,endpoint_hash,p256dh,auth,user_agent)
                          VALUES (?,?,?,?,?,?,?,?)
                          ON DUPLICATE KEY UPDATE tipo=VALUES(tipo), idPersona=VALUES(idPersona), rol=VALUES(rol),
                              p256dh=VALUES(p256dh), auth=VALUES(auth), user_agent=VALUES(user_agent)");
    $st->bind_param('sissssss', $ses['tipo'], $ses['id'], $ses['rol'], $endpoint, $hash, $p256dh, $auth, $ua);
    $ok = $st->execute();
    $st->close();
    return $ok;
}

function push_borrar(mysqli $conn, string $endpoint, ?array $ses = null): void {
    push_asegurar_tabla($conn);
    $hash = hash('sha256', $endpoint);
    if ($ses) { // solo puede borrar suscripciones propias
        $st = $conn->prepare("DELETE FROM push_suscripciones WHERE endpoint_hash=? AND tipo=? AND idPersona=?");
        $st->bind_param('ssi', $hash, $ses['tipo'], $ses['id']);
    } else {
        $st = $conn->prepare("DELETE FROM push_suscripciones WHERE endpoint_hash=?");
        $st->bind_param('s', $hash);
    }
    $st->execute();
    $st->close();
}

/**
 * Envía $payload a todas las suscripciones que cumplan el filtro.
 * $filtro: ['roles'=>['gerente',...]] o ['tipo'=>'cliente','id'=>5]
 * @return int cantidad de envíos exitosos
 */
function push_enviar(mysqli $conn, array $filtro, array $payload, ?array &$detalle = null): int {
    // $detalle (opcional) recibe el resultado por suscripción; lo usa probar.php para explicar los fallos.
    $detalle = ['configurado' => true, 'suscripciones' => 0, 'errores' => []];
    try {
        $cfg = push_config();
        if (!$cfg) { $detalle['configurado'] = false; return 0; }
        push_asegurar_tabla($conn);

        if (!empty($filtro['roles'])) {
            $in = implode(',', array_fill(0, count($filtro['roles']), '?'));
            $st = $conn->prepare("SELECT id,endpoint,p256dh,auth FROM push_suscripciones WHERE tipo='usuario' AND rol IN ($in)");
            $st->bind_param(str_repeat('s', count($filtro['roles'])), ...$filtro['roles']);
        } else {
            $st = $conn->prepare("SELECT id,endpoint,p256dh,auth FROM push_suscripciones WHERE tipo=? AND idPersona=?");
            $st->bind_param('si', $filtro['tipo'], $filtro['id']);
        }
        $st->execute();
        $subs = $st->get_result()->fetch_all(MYSQLI_ASSOC);
        $st->close();
        $detalle['suscripciones'] = count($subs);

        $payload += ['icon' => 'icons/icon-192x192.png', 'badge' => 'icons/badge-72x72.png'];
        $ok = 0;
        foreach ($subs as $s) {
            $r = wp_enviar($s, $payload, $cfg);
            if ($r['ok']) $ok++;
            elseif ($r['expirada']) { // el navegador ya no acepta esta suscripción
                $detalle['errores'][] = 'expirada';
                $d = $conn->prepare("DELETE FROM push_suscripciones WHERE id=?");
                $d->bind_param('i', $s['id']); $d->execute(); $d->close();
            } else {
                $detalle['errores'][] = $r['error'];
                error_log('push: fallo al enviar (' . $r['error'] . ')');
            }
        }
        return $ok;
    } catch (Throwable $e) {
        error_log('push: ' . $e->getMessage());
        $detalle['errores'][] = $e->getMessage();
        return 0;
    }
}

// ---------------- Avisos por evento ----------------

/** Operario registró una entrada/salida: avisa a los gerentes. */
function notificar_pendiente(mysqli $conn, string $tipo, string $detalle): void {
    $esEntrada = $tipo === 'entrada';
    push_enviar($conn, ['roles' => ['gerente']], [
        'title' => $esEntrada ? 'Entrada pendiente de autorizar' : 'Salida pendiente de autorizar',
        'body'  => $detalle,
        'url'   => 'HTML/panel_gerente.html',
        'tag'   => 'pendiente-' . $tipo,
    ]);
}

/** El gerente autorizó la salida de un pedido: avisa al cliente. */
function notificar_cliente_salida(mysqli $conn, int $idSalida): void {
    try {
        $st = $conn->prepare("SELECT idCliente, numeroPedido FROM salida_mercancia WHERE idSalida=?");
        $st->bind_param('i', $idSalida); $st->execute();
        $row = $st->get_result()->fetch_assoc(); $st->close();
        if (!$row || !$row['idCliente']) return;
        push_enviar($conn, ['tipo' => 'cliente', 'id' => (int) $row['idCliente']], [
            'title' => 'Tu pedido fue autorizado',
            'body'  => 'El pedido ' . ($row['numeroPedido'] ?: '#' . $idSalida) . ' fue autorizado y está listo para salir del almacén.',
            'url'   => 'HTML/panel_cliente.html',
            'tag'   => 'pedido-' . $idSalida,
        ]);
    } catch (Throwable $e) { error_log('push: ' . $e->getMessage()); }
}

/**
 * Avisa a administradores y gerentes si algún producto de la salida quedó por debajo del stock mínimo
 * (mismo criterio que el contador de alertas de panel_admin.php: cantidadActiva < 10).
 * Usa la existencia (cantidadActiva) del inventario más reciente; umbral en STOCK_MINIMO (por defecto 10).
 */
function notificar_stock_bajo_salida(mysqli $conn, int $idSalida): void {
    try {
        $min = (int) (getenv('STOCK_MINIMO') ?: 10);
        $st = $conn->prepare(
            "SELECT DISTINCT p.nombre, ip.cantidadActiva
               FROM salida_mercancia_detalle d
               JOIN mercancia m ON m.idMercancia = d.idMercancia
               JOIN productos p ON p.idProducto = m.idProducto
               JOIN inventario_producto ip ON ip.idProducto = p.idProducto
              WHERE d.idSalida = ?
                AND ip.idInventario = (SELECT idInventario FROM inventario ORDER BY fechaActualizacion DESC, idInventario DESC LIMIT 1)
                AND ip.cantidadActiva < ?");
        $st->bind_param('ii', $idSalida, $min); $st->execute();
        $bajos = $st->get_result()->fetch_all(MYSQLI_ASSOC); $st->close();
        foreach ($bajos as $b) {
            push_enviar($conn, ['roles' => ['gerente', 'administrador']], [
                'title' => 'Stock bajo: ' . $b['nombre'],
                'body'  => 'Quedan ' . (int) $b['cantidadActiva'] . ' unidades (por debajo del mínimo de ' . $min . ').',
                'url'   => 'HTML/panel_gerente.html',
                'tag'   => 'stock-' . $b['nombre'],
            ]);
        }
    } catch (Throwable $e) { error_log('push: ' . $e->getMessage()); }
}
