<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../config/conexion.php';
require_once __DIR__ . '/../includes/push.php';

function salir(int $http, string $msg, bool $ok = false): void {
    http_response_code($http);
    echo json_encode(['success' => $ok, 'message' => $msg]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') salir(405, 'Método no permitido');
$ses = push_sesion();
if (!$ses) salir(401, 'Inicia sesión para activar los avisos');
if (!push_config()) salir(503, 'Las notificaciones no están configuradas en el servidor');

$in  = json_decode(file_get_contents('php://input'), true);
$end = $in['endpoint'] ?? '';
$p   = $in['keys']['p256dh'] ?? '';
$a   = $in['keys']['auth'] ?? '';

if (!is_string($end) || !is_string($p) || !is_string($a) || $end === '' || $p === '' || $a === '') salir(400, 'Suscripción incompleta');
if (strlen($end) > 2048 || !wp_endpoint_permitido($end)) salir(400, 'Servicio de notificaciones no permitido');
if (strlen(wp_b64u_decode($p)) !== 65 || strlen(wp_b64u_decode($a)) < 16) salir(400, 'Claves de suscripción inválidas');

push_guardar($conn, $ses, $end, $p, $a, $_SERVER['HTTP_USER_AGENT'] ?? '')
    ? salir(200, 'Avisos activados', true)
    : salir(500, 'No se pudo guardar la suscripción');
