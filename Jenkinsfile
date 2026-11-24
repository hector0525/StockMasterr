// Jenkinsfile — StockMasterr
// Práctica integradora: GitHub + Docker + Jenkins (Gestión de Desarrollo de Software).
//
// Qué hace este pipeline, en orden:
//   1. Checkout: descarga el código desde GitHub.
//   2. Verificar sintaxis PHP: revisa todos los .php con `php -l`.
//   3. Verificar JavaScript: revisa pwa.js, sw.js, sw-offline.js y scrip.js con `node --check`.
//   4. Construir imagen Docker: `docker build` con el Dockerfile del proyecto.
//   5. Desplegar y verificar: levanta la app con `docker compose up -d --build`
//      (web + MySQL) y comprueba con curl que responde http://localhost:8080/
//      y la página de login. Si alguna etapa falla, el pipeline se marca en rojo
//      y no llega al despliegue.
//
// Requisitos en el agente de Jenkins:
//   - Docker CLI y acceso al demonio de Docker (Docker Desktop, o Jenkins
//     en contenedor con /var/run/docker.sock montado, ver docker-compose.jenkins.yml).
//   - Docker Compose v2 (`docker compose`).
//   - Plugins: Pipeline, Git. El webhook se configura en el trabajo (job) de
//     Jenkins y en GitHub, no aquí (ver README.md, sección DevOps).

pipeline {
    agent any

    options {
        timeout(time: 20, unit: 'MINUTES')
        timestamps()
    }

    environment {
        IMAGE_NAME = 'stockmasterr'
        APP_URL = 'http://localhost:8080'
        // Nombre de proyecto propio para no chocar con un `docker compose up`
        // manual del mismo equipo; la base de datos de la prueba es desechable.
        COMPOSE_PROJECT_NAME = "stockmasterr-ci-${env.BUILD_NUMBER}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh 'ls -la'
            }
        }

        stage('Verificar sintaxis PHP') {
            steps {
                sh '''
                    docker run --rm -v "$WORKSPACE":/app -w /app php:8.3-cli \
                      sh -c "find . -name '*.php' -print0 | xargs -0 -n1 php -l"
                '''
            }
        }

        stage('Verificar JavaScript') {
            steps {
                sh '''
                    docker run --rm -v "$WORKSPACE":/app -w /app node:20-alpine \
                      sh -c "node --check pwa.js && node --check sw.js && node --check sw-offline.js && node --check scrip.js"
                '''
            }
        }

        stage('Construir imagen Docker') {
            steps {
                sh 'docker build -t ${IMAGE_NAME}:${BUILD_NUMBER} -t ${IMAGE_NAME}:latest .'
                sh 'docker images ${IMAGE_NAME}'
            }
        }

        stage('Desplegar y verificar') {
            steps {
                sh 'docker compose up -d --build'
                sh 'docker compose ps'
                // Espera a que Apache responda (MySQL tarda unos segundos en arrancar).
                sh '''
                    for i in $(seq 1 30); do
                      if curl -fsS -o /dev/null "${APP_URL}/"; then
                        echo "La app responde en ${APP_URL}"
                        break
                      fi
                      echo "Esperando a la app... intento $i/30"
                      sleep 2
                    done
                    curl -fsS -o /dev/null "${APP_URL}/" || (docker compose logs web && exit 1)
                '''
                sh 'curl -fsS -o /dev/null "${APP_URL}/HTML/login.html"'
                sh 'curl -fsS "${APP_URL}/" | head -c 300; echo'
            }
        }
    }

    post {
        always {
            // Limpieza: baja los contenedores de la prueba y borra su volumen
            // de base de datos (era solo para verificar el despliegue).
            sh 'docker compose down -v || true'
            sh 'docker rmi ${IMAGE_NAME}:${BUILD_NUMBER} || true'
        }
        success {
            echo "Pipeline OK: imagen ${IMAGE_NAME}:${BUILD_NUMBER} construida y app verificada en ${APP_URL}."
        }
        failure {
            echo 'Pipeline FALLIDO: revisar la etapa en rojo. La app no se desplegó.'
        }
    }
}
