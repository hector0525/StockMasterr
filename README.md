# StockMasterr

StockMasterr es un sistema web para administrar el inventario de un almacén. Permite trabajar con productos, proveedores, usuarios, movimientos de mercancía y pedidos desde cuatro roles: administrador, operario, gerente y cliente. El proyecto integra la aplicación desarrollada en los parciales anteriores con Docker, GitHub Actions y un pipeline preparado para Jenkins.

## Tecnologías

- Interfaz: HTML, CSS y JavaScript.
- Servidor: PHP 8.3 con Apache.
- Base de datos: MySQL 8.0.
- Aplicación web progresiva: manifiesto, service workers, caché de pantallas y sincronización de operaciones pendientes.
- Entrega: Docker Compose, GitHub Actions y Jenkins.

La aplicación permite consultar datos que ya se cargaron cuando se pierde la conexión y poner algunas operaciones en cola para sincronizarlas al volver la red. El inicio de sesión requiere conexión con el servidor. Las notificaciones push se pueden configurar con claves VAPID; los pasos están en [README_DOCKER.md](README_DOCKER.md).

## Estructura del proyecto

```text
.
├── HTML/                  Páginas, estilos y módulos PHP por rol
│   └── php/               Login, sesiones, conexión, administración,
│                          operación, gerencia, cliente y notificaciones
├── CSS/                   Estilos compartidos
├── docker/                Configuración de PHP para Docker
├── tools/                 Herramientas auxiliares
├── .github/workflows/     Integración continua con GitHub Actions
├── Dockerfile             Imagen PHP y Apache
├── compose.yaml           Aplicación web y MySQL
├── Jenkinsfile            Pipeline de Jenkins
└── docker-compose.jenkins.yml
                           Jenkins local
```

## Ejecutar la aplicación

Requisitos: Docker Desktop o Docker Engine con Docker Compose.

1. Copia `.env.example` a `.env` y cambia `DB_PASSWORD` y `MYSQL_ROOT_PASSWORD` por contraseñas propias. No subas `.env` al repositorio.
2. Desde la raíz del proyecto, construye e inicia los servicios:

   ```bash
   docker compose up -d --build
   docker compose ps
   ```

3. Abre [http://localhost:8080](http://localhost:8080). La pantalla de acceso está en [http://localhost:8080/HTML/login.html](http://localhost:8080/HTML/login.html).

Para detener la aplicación y conservar la base de datos:

```bash
docker compose down
```

`compose.yaml` ejecuta dos servicios. `web` construye la imagen desde el `Dockerfile` y publica el puerto 8080 del equipo como el puerto 80 de Apache. `db` usa MySQL 8.0, no publica un puerto al equipo y se conecta a `web` por el nombre de servicio `db`. La base `sistema_almacen` se inicializa desde `BDv2.txt` cuando se crea por primera vez el volumen. Cambiar ese SQL no modifica una base que ya tenga datos.

La aplicación se conecta usando las variables `DB_HOST`, `DB_NAME`, `DB_USER` y `DB_PASSWORD`. Para Compose, `DB_HOST` es `db`. Los datos de MySQL se conservan en el volumen `stockmaster_db_data`; `docker compose down -v` también borra ese volumen y sus datos.

## GitHub y Docker Hub

- Repositorio público actual: [hector0525/StockMasterr](https://github.com/hector0525/StockMasterr).
- La práctica solicita que el repositorio se llame `Practica-DevOps-GitHub-Docker-Jenkins`. El nombre actual aún no coincide con ese requisito.
- El historial actual contiene 16 commits. Se puede consultar en [GitHub](https://github.com/hector0525/StockMasterr/commits/main).
- Imagen publicada: [hec2504/stockmaster en Docker Hub](https://hub.docker.com/r/hec2504/stockmaster).

La imagen de Docker Hub contiene la aplicación web; para usarla con la base de datos y su configuración, la opción documentada es construir y ejecutar el proyecto con `compose.yaml`.

## Integración continua con GitHub Actions

El flujo [.github/workflows/ci.yml](.github/workflows/ci.yml) se ejecuta en cada `push` y `pull request` a `main`. El trabajo de validación revisa la sintaxis PHP y construye la imagen. En los `push` a `main`, un segundo trabajo publica la imagen en Docker Hub con las etiquetas `latest` y el SHA del commit, siempre que el trabajo anterior termine correctamente.

Para habilitar la publicación, configura en los secretos de GitHub `DOCKERHUB_USERNAME` y `DOCKERHUB_TOKEN`. El token debe tener permiso para publicar imágenes; no guardes credenciales en el archivo de workflow.

## Pipeline de Jenkins

El archivo [Jenkinsfile](Jenkinsfile) define estas etapas:

| Etapa | Acción |
|---|---|
| Checkout | Obtiene el código del repositorio. |
| Verificar sintaxis PHP | Ejecuta `php -l` sobre los archivos PHP. |
| Verificar JavaScript | Revisa los service workers y scripts con `node --check`. |
| Construir imagen Docker | Construye y etiqueta la imagen de la aplicación. |
| Desplegar y verificar | Inicia la aplicación con Compose y comprueba la página principal y el login. |

Para iniciar Jenkins localmente:

```bash
docker compose -f docker-compose.jenkins.yml up -d
docker compose -f docker-compose.jenkins.yml logs -f jenkins
```

Abre [http://localhost:8081](http://localhost:8081). Jenkins necesita el cliente Docker, Compose v2 y los complementos Pipeline, Git y GitHub. La guía de configuración inicial y creación del trabajo está en [README_DOCKER.md](README_DOCKER.md) y en el propio `Jenkinsfile`.

El pipeline está definido en el repositorio. Según el estado registrado en el entregable, falta dejar evidenciada la ejecución del trabajo Jenkins, su conexión configurada con GitHub y el webhook. El webhook requiere que GitHub pueda alcanzar Jenkins; si Jenkins solo está disponible en la red local, usa una ejecución manual o sondeo. Para un Jenkins ejecutado en contenedor, el pipeline comprueba la app a través de `host.docker.internal:8080`; desde el navegador del equipo se usa `localhost:8080`.

## Estado de la práctica y evidencias

| Parte | Estado documentado |
|---|---|
| Código y commits en GitHub | Completado; el repositorio actual tiene 16 commits. |
| Docker y ejecución de la app | Completado; Compose inicia `web` y `db`, y la aplicación responde en el puerto 8080. |
| Publicación e integración continua | Configuradas con Docker Hub y GitHub Actions. |
| Nombre requerido del repositorio | Pendiente; el repositorio aún se llama `StockMasterr`. |
| Jenkins | Archivos preparados; pendiente registrar la configuración y ejecución del pipeline, instalar/verificar el cliente Docker y documentar el webhook. |
| Evidencias de Jenkins | Pendientes de incorporar al entregable. |

Las capturas del historial, Docker, la aplicación, Docker Hub y GitHub Actions forman parte de la evidencia del proyecto. El informe incluye las conclusiones de cuatro integrantes; queda pendiente la conclusión de Jorge Uriel González Hernández. Las conclusiones individuales y la evidencia de Jenkins corresponden al informe de entrega; no se sustituyen por texto genérico en este README.

## Documentación relacionada

- [README_DOCKER.md](README_DOCKER.md): ejecución, notificaciones push y funcionamiento sin conexión.
- [mapa.txt](mapa.txt): mapa de pantallas y módulos.
- [BDv2.txt](BDv2.txt): esquema e inicialización de la base de datos.
