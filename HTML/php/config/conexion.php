<?php
// La configuración se obtiene del entorno para funcionar localmente o en Docker.
$servidor = getenv('DB_HOST') ?: 'localhost';
$usuario = getenv('DB_USER') ?: 'stockmaster';
$contraseña = getenv('DB_PASSWORD') ?: '';
$base_datos = getenv('DB_NAME') ?: 'sistema_almacen';

$conn = new mysqli($servidor, $usuario, $contraseña, $base_datos);
$conn->set_charset('utf8mb4');

if ($conn->connect_error) {
    error_log('Error de conexión a la base de datos: ' . $conn->connect_error);
    http_response_code(500);
    die('No se pudo conectar con la base de datos. Verifica la configuración del servidor.');
}
?>
