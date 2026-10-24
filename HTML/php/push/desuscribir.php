<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../config/conexion.php';
require_once __DIR__ . '/../includes/push.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['success' => false]); exit; }
$ses = push_sesion();
if (!$ses) { http_response_code(401); echo json_encode(['success' => false, 'message' => 'Sin sesión']); exit; }

$in  = json_decode(file_get_contents('php://input'), true);
$end = $in['endpoint'] ?? '';
if (is_string($end) && $end !== '') push_borrar($conn, $end, $ses);
echo json_encode(['success' => true]);
