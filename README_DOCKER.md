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
