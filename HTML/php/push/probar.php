<?php
// Envía una notificación de prueba a los dispositivos del usuario que tiene la sesión abierta
// y, si falla, explica el motivo.
header('Content-Type: application/json');
require_once __DIR__ . '/../config/conexion.php';
require_once __DIR__ . '/../includes/push.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['success' => false]); exit; }
$ses = push_sesion();
if (!$ses) { http_response_code(401); echo json_encode(['success' => false, 'message' => 'Sin sesión']); exit; }
if (!push_config()) { http_response_code(503); echo json_encode(['success' => false, 'message' => 'Notificaciones no configuradas']); exit; }

$det = null;
$n = push_enviar($conn, ['tipo' => $ses['tipo'], 'id' => $ses['id']], [
    'title' => 'StockMaster',
    'body'  => 'Las notificaciones funcionan correctamente.',
    'url'   => './',
    'tag'   => 'prueba',
], $det);

/** Traduce el error técnico a una indicación que el usuario pueda aplicar. */
function probar_explicar(string $e): string {
    if ($e === 'expirada') return 'La suscripción de este dispositivo caducó. Pulsa Desactivar y luego Activar avisos.';
    if (preg_match('/HTTP (401|403)/', $e)) return 'El servicio de notificaciones rechazó las claves (HTTP ' . substr($e, 5) . '). Las claves VAPID del servidor no son las que se usaron al activar los avisos: pulsa Desactivar, luego Activar avisos.';
    if (stripos($e, 'resolve') !== false || stripos($e, 'timed out') !== false || stripos($e, 'connect') !== false)
        return 'El servidor no tiene salida a internet hacia el servicio de notificaciones de Google/Mozilla/Apple (' . $e . ').';
    if (stripos($e, 'permitido') !== false) return 'El navegador usa un servicio de notificaciones no admitido por el servidor.';
    return $e;
}

if ($n > 0) {
    $msg = 'Notificación enviada. Si no la ves en pantalla, revisa que el sistema no tenga silenciadas las notificaciones del navegador (Modo No molestar / Asistente de concentración).';
} elseif (($det['suscripciones'] ?? 0) === 0) {
    $msg = 'Este dispositivo no está registrado en el servidor. Pulsa Desactivar y luego Activar avisos.';
} else {
    $msg = 'No se pudo entregar: ' . implode(' | ', array_unique(array_map('probar_explicar', $det['errores'])));
}
echo json_encode(['success' => $n > 0, 'enviados' => $n, 'message' => $msg]);
