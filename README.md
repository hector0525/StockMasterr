# StockMaster
Nombre y descripción del proyecto
StockMaster
El objetivo general del proyecto es desarrollar e implementar un sistema de
información web integral, denominado "STOCKMASTER", diseñado para
modernizar y automatizar la gestión de inventarios de un almacén. 
Integrantes:
BERMUDEZ TAPIA HECTOR ANTONIO
NAVARRO DE LA CRUZ JONATHAN
PATRICIO
SANCHEZ ROMERO CHRISTIAN
VILCHIS EZPINOZA ALFREDO
GONZALEZ HERNANDEZ JORGE URIEL 
Tecnologías utilizadas:
HTML, CSS, PHP, SQL, JAVA SCRIPT
Arquitectura y microservicios
INICIO (login.php)
│
├── [Administrador] panel_admin.php
│   ├── usuarios.php
│   │   ├── nuevo_usuario.php
│   │   └── editar_usuario.php
│   ├── proveedores.php
│   │   └── nuevo_proveedor.php
│   ├── productos.php
│   │   └── nuevo_producto.php
│   ├── inventario.php
│   │   └── detalle_inventario.php
│   ├── reportes.php
│   │   ├── reporte_entradas.php
│   │   ├── reporte_salidas.php
│   │   └── reporte_inventario.php
│   └── configuración (cambiar_contraseña.php, logout.php)
│
├── [Operario de almacén] panel_operario.php
│   ├── entrada_mercancia.php
│   ├── salida_mercancia.php
│   ├── verificar_mercancia.php
│   └── detalle_entrada.php / detalle_salida.php
│
├── [Gerente de almacén] panel_gerente.php
│   ├── autorizar_entrada.php
│   ├── autorizar_salida.php
│   ├── supervisar_inventario.php
│   └── reportes.php
│
└── [Cliente] panel_cliente.php
    ├── perfil_cliente.php
    ├── pedidos.php
    │   ├── nuevo_pedido.php
    │   └── detalle_pedido.php
    └── logout.php

---

# Práctica integradora DevOps: GitHub, Docker y Jenkins

Asignatura: Gestión de Desarrollo de Software. La aplicación de esta
práctica es StockMasterr (este repositorio, ya concluida en el primer y
segundo parcial).

## Flujo DevOps

```
GitHub (código fuente) ──push / webhook──> Jenkins (Pipeline)
                                              │
                                              ├─ Verifica sintaxis PHP y JavaScript
                                              ├─ Construye la imagen Docker
                                              └─ Despliega con Docker Compose y verifica
                                                        │
                                                        ▼
                                              App en http://localhost:8080
                                              (web PHP/Apache + MySQL)
```

## Fase 1. GitHub

- Repositorio público: **Practica-DevOps-GitHub-Docker-Jenkins**.
- El código de este proyecto es la aplicación desarrollada en los
  parciales anteriores. Se sube el contenido de esta carpeta.
- Hacer al menos tres commits que evidencien los avances (por ejemplo:
  1) código base de la app, 2) Dockerfile y Docker Compose,
  3) Jenkinsfile y documentación DevOps).
- Evidencia: enlace al repositorio y capturas de los commits.

## Fase 2. Docker

- `Dockerfile`: imagen base `php:8.3-apache`, instala la extensión
  `mysqli`, copia `docker/stockmaster.ini` (sesión de 8 h) y copia el
  proyecto a `/var/www/html/`. Expone el puerto 80.
- `compose.yaml`: dos servicios, `web` (puerto 8080:80) y `db`
  (MySQL 8.0, base `sistema_almacen`, con healthcheck; `BDv2.txt` se
  importa al inicializar el volumen vacío).
- Construir y ejecutar (ver `README_DOCKER.md`):
  `docker compose up -d --build` y abrir http://localhost:8080.
- Evidencia: Dockerfile, captura de la construcción de la imagen,
  captura del contenedor en ejecución y captura de la app funcionando.

## Fase 3. Jenkins

1. Levantar Jenkins en local con el archivo de este repositorio:
   ```bash
   docker compose -f docker-compose.jenkins.yml up -d
   docker compose -f docker-compose.jenkins.yml logs -f jenkins
   ```
2. Abrir http://localhost:8081 y desbloquear Jenkins con la contraseña
   inicial que muestran los logs (o
   `/var/jenkins_home/secrets/initialAdminPassword`).
3. Instalar el cliente de Docker dentro del contenedor de Jenkins (la
   imagen oficial no lo trae y el Jenkinsfile lo necesita). Una sola
   vez:
   ```bash
   docker exec -u root stockmaster_jenkins bash -c "apt-get update && apt-get install -y docker.io"
   docker exec stockmaster_jenkins docker --version
   docker exec stockmaster_jenkins docker compose version
   ```
   Si `docker compose` no aparece, instalar `docker-compose-plugin`
   desde el repositorio oficial de Docker. Si Jenkins corre instalado
   en la PC (no en contenedor) con Docker Desktop, este paso no hace
   falta: `docker` ya está en el PATH.
4. Instalar los complementos sugeridos y verificar: **Pipeline**,
   **Git** y **GitHub** (en *Manage Jenkins → Plugins*).
5. El archivo `Jenkinsfile` en la raíz del repositorio define el
   pipeline: es el guion de etapas que Jenkins ejecuta. Sin él, el
   trabajo Pipeline no sabría qué hacer.
6. Evidencia: capturas de Jenkins funcionando, del proyecto Pipeline
   y de la configuración de conexión con GitHub.

## Fase 4. Integración: el Pipeline

`Jenkinsfile` (en la raíz del repositorio):

| Etapa | Qué hace |
|---|---|
| Checkout | Descarga el código desde GitHub (`checkout scm`). |
| Verificar sintaxis PHP | `php -l` a todos los `.php` (imagen `php:8.3-cli`). |
| Verificar JavaScript | `node --check` a `pwa.js`, `sw.js`, `sw-offline.js` y `scrip.js` (imagen `node:20-alpine`). |
| Construir imagen Docker | `docker build -t stockmasterr:<número de build> -t stockmasterr:latest .` |
| Desplegar y verificar | `docker compose up -d --build`, espera a que responda http://localhost:8080/ y comprueba `/` y `/HTML/login.html` con `curl`. |

Al final, siempre limpia: `docker compose down -v` y borra la imagen
de prueba. Si alguna etapa falla, el pipeline se marca en rojo y no
llega al despliegue.

### Crear el trabajo Pipeline en Jenkins

1. *New Item → Pipeline*, nombre: `StockMasterr-Pipeline`.
2. En *Pipeline → Definition*: **Pipeline script from SCM**,
   SCM: **Git**, URL del repositorio
   `https://github.com/<usuario>/Practica-DevOps-GitHub-Docker-Jenkins.git`,
   Branch: `*/main`, Script Path: `Jenkinsfile`.
3. Guardar y pulsar **Build Now**. Comprobar que las 5 etapas se
   completan en verde.

### Webhook de GitHub (dispara el pipeline con cada push)

1. En Jenkins, en el trabajo, activar **GitHub hook trigger for
   GITScm polling** (sección *Build Triggers*).
2. En GitHub, en el repositorio: *Settings → Webhooks → Add webhook*,
   Payload URL: `http://<IP-o-dominio-de-Jenkins>:8081/github-webhook/`,
   Content type: `application/json`, eventos: *Just the push event*.
3. Hacer un push y comprobar que Jenkins inicia el build solo.
   Nota: si Jenkins corre en local sin dominio público, GitHub no
   puede llegar a él; en ese caso el webhook se documenta como
   configurado y el build se dispara manual o por sondeo (*Poll SCM*).

### Evidencia de la Fase 4

- Capturas de las etapas del pipeline en verde.
- Captura de la app funcionando tras el despliegue del pipeline.
- Captura del webhook en GitHub (o nota de la limitación local).

## Conclusiones por integrante

_Cada integrante escribe aquí su conclusión: qué aprendió a lo largo
del curso, qué le gustó, qué no le gustó, qué le faltó aprender._

### Bermúdez Tapia Héctor Antonio
_(pendiente de escribir)_

### Navarro de la Cruz Jonathan Patricio
_(pendiente de escribir)_

### Sánchez Romero Christian
_(pendiente de escribir)_

### Vilchis Ezpinoza Alfredo
_(pendiente de escribir)_

### González Hernández Jorge Uriel
_(pendiente de escribir)_
