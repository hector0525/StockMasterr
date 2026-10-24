# StockMaster con Docker

## Requisitos
- Docker Desktop (Windows/macOS) o Docker Engine + Docker Compose (Linux).
- Archivos SQL revisados para la versión del proyecto.

## Preparación
1. Copia `.env.example` como `.env`.
2. Cambia `DB_PASSWORD` y `MYSQL_ROOT_PASSWORD` por contraseñas propias. No publiques `.env`.
3. Desde esta carpeta ejecuta:

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs
```

4. Abre http://localhost:8080 .

## Detener
```bash
docker compose down
```
Esto conserva los datos del volumen. Para borrar también los datos de la base de datos (acción destructiva): `docker compose down -v`.

## Notas importantes
- La conexión PHP usa `DB_HOST=db`, el nombre del servicio MySQL dentro de la red Compose.
- `BDv2.txt` se importa automáticamente solo cuando MySQL inicializa un volumen vacío. Si ya existe el volumen, los cambios en el SQL no se importan automáticamente.
- El Dockerfile copia el repositorio completo al directorio web de Apache. Revisa que los enlaces y rutas del proyecto sean correctos antes de publicar el sistema.
- La configuración es una base de desarrollo. Antes de producción, revisar seguridad, credenciales, permisos, consultas SQL y HTTPS.

## Notificaciones push
Avisos que llegan al dispositivo aunque la app esté cerrada:
- **Gerente:** una entrada o salida queda pendiente de autorizar.
- **Gerente y administrador:** un producto queda por debajo del stock mínimo (`STOCK_MINIMO`, por defecto 10).
- **Cliente:** su pedido fue autorizado.

### Configuración
1. Genera las claves VAPID (una sola vez) y pégalas en `.env`:
   ```bash
   docker compose run --rm web php tools/generar_vapid.php
   ```
   Pega `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y pon en `VAPID_SUBJECT` un correo real (`mailto:...`). **No cambies estas claves después**: los dispositivos ya suscritos dejarían de recibir avisos. La clave privada no se comparte.
2. Reinicia: `docker compose up -d`.
3. Entra con cada usuario, abre su panel y pulsa **Activar avisos** (abajo a la izquierda). Con **Probar** puedes enviarte una notificación de ejemplo.

### Requisitos
- **HTTPS o `localhost`.** Los navegadores solo permiten notificaciones en sitios seguros; en otra PC o en el celular hace falta un dominio con HTTPS.
- El servidor necesita salir a internet (puerto 443) para llegar a los servicios de Google, Mozilla o Apple que entregan los avisos.
- iPhone y iPad: primero instala la app (Compartir → *Agregar a pantalla de inicio*) y actívalos desde ese ícono (iOS 16.4 o superior).
- Al cerrar sesión, ese dispositivo deja de recibir avisos de la cuenta. Si estaba desactivado el permiso en el navegador, se reactiva desde el candado junto a la dirección.
- La tabla `push_suscripciones` se crea sola; no hace falta recrear el volumen de MySQL.

## Funcionamiento sin conexión
La app sigue siendo útil cuando se cae la red o el servidor:
- **Consultar:** las pantallas y los datos que ya se descargaron con conexión se pueden ver sin ella. Al abrir un panel con conexión, la app descarga en segundo plano las consultas de ese rol. Se muestra "Sin conexión · datos guardados de las HH:MM". Las copias se descartan a las 24 h.
- **Registrar:** las **entradas y salidas del operario** y los **pedidos del cliente** hechos sin conexión quedan guardados en el dispositivo y se envían solos al volver la red (o con el botón "Enviar ahora"). Cada registro lleva una clave única, así que aunque el envío se repita nunca se duplica. Con "Ver" se consulta la lista; un registro que el servidor rechace (por ejemplo, sin stock suficiente) aparece con su motivo para descartarlo.
- **No se puede sin conexión:** iniciar sesión, autorizar o rechazar movimientos, crear usuarios, productos o proveedores, cancelar pedidos. La app lo indica con un mensaje.

### Cosas que conviene saber
- La primera vez hay que abrir cada panel **con conexión** (iniciar sesión y dejar que cargue). Sin eso no hay nada guardado.
- La sesión del servidor dura 8 horas sin actividad (`docker/stockmaster.ini`). Si caduca, los pendientes esperan en el dispositivo hasta que se vuelva a iniciar sesión; solo se envían con la cuenta que los creó.
- **En equipos compartidos, usar siempre "Cerrar sesión":** borra del dispositivo los datos descargados. Los registros pendientes se conservan y los envía su dueño al volver a entrar.
- Tras actualizar el proyecto: `docker compose up -d --build`. La tabla `sync_operaciones` se crea sola.
