<?php
$servidor = "localhost";
$usuario = "root";
$contraseña = "mysql123";
$base_datos = "sistema_almacen";

$conn = new mysqli($servidor, $usuario, $contraseña, $base_datos);

if ($conn->connect_error) {
    die("Error de conexión: " . $conn->connect_error);
}
?>
