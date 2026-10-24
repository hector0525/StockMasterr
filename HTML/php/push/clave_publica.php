<?php
// Entrega al navegador la clave pública VAPID (es pública por diseño).
header('Content-Type: application/json');
header('Cache-Control: no-store');
$pub = getenv('VAPID_PUBLIC_KEY');
echo json_encode(['configurado' => (bool) ($pub && getenv('VAPID_PRIVATE_KEY')), 'clave' => $pub ?: null]);
