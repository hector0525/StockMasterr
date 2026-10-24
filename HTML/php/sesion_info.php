<?php
// Dice quién tiene la sesión abierta (o 401). La usa el service worker para saber a qué cuenta
// pertenecen los datos guardados en el dispositivo y los registros pendientes de enviar.
header('Content-Type: application/json');
header('Cache-Control: no-store');
session_start(['read_and_close' => true]);
if (empty($_SESSION['rol']) || empty($_SESSION['id']) || empty($_SESSION['tipo'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'sesion' => false]);
    exit;
}
echo json_encode(['success' => true, 'sesion' => true, 'tipo' => $_SESSION['tipo'], 'id' => (int) $_SESSION['id'], 'rol' => $_SESSION['rol']]);
