<?php
/**
 * Idempotencia para los registros que envía el service worker (modo sin conexión).
 *
 * Solo actúa si la petición trae la cabecera X-Idempotency-Key; sin ella, el endpoint se
 * comporta exactamente igual que siempre. Con ella:
 *   - exige sesión iniciada (si expiró, responde 401 y el registro sigue en cola en el dispositivo);
 *   - si la misma clave ya se procesó, devuelve la respuesta guardada sin volver a insertar nada,
 *     así que un reintento (red inestable, doble envío, dos pestañas) nunca duplica un registro.
 *
 * Uso en un endpoint, justo después de incluir conexion.php:
 *     require_once '../includes/idempotencia.php';
 *     idem_iniciar($conn);
 *     ...
 *     idem_cerrar($conn, $response);   // antes del echo final
 */

$GLOBALS['__idem'] = null;

function idem_responder(int $http, array $cuerpo): void {
    http_response_code($http);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE);
    exit;
}

function idem_iniciar($conn): void {
    $clave = $_SERVER['HTTP_X_IDEMPOTENCY_KEY'] ?? '';
    if ($clave === '') return;                       // petición normal: sin cambios
    if (!preg_match('/^[A-Za-z0-9-]{16,64}$/', $clave)) {
        idem_responder(400, ['success' => false, 'message' => 'Clave de operación inválida']);
    }

    if (session_status() === PHP_SESSION_NONE) session_start(['read_and_close' => true]);
    if (empty($_SESSION['rol']) || empty($_SESSION['id'])) {
        idem_responder(401, ['success' => false, 'sesion' => false,
            'message' => 'Tu sesión expiró. Inicia sesión de nuevo; el registro pendiente se enviará automáticamente.']);
    }
    $usuario = ($_SESSION['tipo'] ?? '') . ':' . (int) $_SESSION['id'];

    $conn->query("CREATE TABLE IF NOT EXISTS sync_operaciones (
        clave VARCHAR(64) PRIMARY KEY,
        usuario VARCHAR(40) NOT NULL,
        endpoint VARCHAR(120) NOT NULL,
        respuesta MEDIUMTEXT NULL,
        creado INT NOT NULL
    ) ENGINE=InnoDB");

    $ahora = time();
    if (random_int(1, 50) === 1) {                   // limpieza ocasional de registros de más de 30 días
        $viejo = $ahora - 30 * 86400;
        $d = $conn->prepare("DELETE FROM sync_operaciones WHERE creado < ?");
        $d->bind_param('i', $viejo); $d->execute(); $d->close();
    }

    $ruta = basename($_SERVER['SCRIPT_NAME'] ?? '');
    $st = $conn->prepare("INSERT IGNORE INTO sync_operaciones (clave, usuario, endpoint, respuesta, creado) VALUES (?, ?, ?, NULL, ?)");
    $st->bind_param('sssi', $clave, $usuario, $ruta, $ahora);
    $st->execute();
    $nuevo = $st->affected_rows === 1;
    $st->close();

    if (!$nuevo) {                                   // esta clave ya existe
        $st = $conn->prepare("SELECT usuario, respuesta, creado FROM sync_operaciones WHERE clave = ?");
        $st->bind_param('s', $clave);
        $st->execute();
        $fila = $st->get_result()->fetch_assoc();
        $st->close();

        if (!$fila || $fila['usuario'] !== $usuario) {
            idem_responder(403, ['success' => false, 'message' => 'Operación no autorizada para esta cuenta']);
        }
        if ($fila['respuesta'] !== null) {           // ya procesada: se devuelve lo mismo, sin repetir
            $r = json_decode($fila['respuesta'], true);
            if (!is_array($r)) $r = ['success' => false, 'message' => 'Respuesta guardada ilegible'];
            $r['duplicado'] = true;
            idem_responder(200, $r);
        }
        if ($ahora - (int) $fila['creado'] < 60) {   // otro envío idéntico sigue en curso
            idem_responder(409, ['success' => false, 'enCurso' => true, 'message' => 'La operación se está procesando.']);
        }
        // reservada hace más de 60 s y sin terminar (el proceso anterior murió): se retoma
        $u = $conn->prepare("UPDATE sync_operaciones SET creado = ? WHERE clave = ? AND respuesta IS NULL");
        $u->bind_param('is', $ahora, $clave); $u->execute(); $u->close();
    }

    $GLOBALS['__idem'] = ['conn' => $conn, 'clave' => $clave, 'cerrada' => false];
    register_shutdown_function(function () {         // salida temprana o error: se libera la reserva para poder reintentar
        $i = $GLOBALS['__idem'] ?? null;
        if (!$i || $i['cerrada']) return;
        try {
            $d = $i['conn']->prepare("DELETE FROM sync_operaciones WHERE clave = ? AND respuesta IS NULL");
            $d->bind_param('s', $i['clave']); $d->execute(); $d->close();
        } catch (Throwable $e) { /* conexión ya cerrada */ }
    });
}

/** Guarda la respuesta final de la operación (llamar antes del echo final y de $conn->close()). */
function idem_cerrar($conn, array $response): void {
    $i = $GLOBALS['__idem'] ?? null;
    if (!$i) return;
    try {
        $json = json_encode($response, JSON_UNESCAPED_UNICODE);
        $u = $conn->prepare("UPDATE sync_operaciones SET respuesta = ? WHERE clave = ?");
        $u->bind_param('ss', $json, $i['clave']); $u->execute(); $u->close();
        $GLOBALS['__idem']['cerrada'] = true;
    } catch (Throwable $e) { error_log('idempotencia: ' . $e->getMessage()); }
}
