<?php
// Genera las claves VAPID para las notificaciones push. Solo se ejecuta desde la terminal.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../HTML/php/includes/webpush.php';
$k = wp_generar_vapid();
echo "\nCopia estas líneas en tu archivo .env (y no compartas la clave privada):\n\n";
echo "VAPID_PUBLIC_KEY={$k['public']}\n";
echo "VAPID_PRIVATE_KEY={$k['private']}\n";
echo "VAPID_SUBJECT=mailto:tu_correo@ejemplo.com\n\n";
