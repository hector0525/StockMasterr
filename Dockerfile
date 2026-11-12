FROM php:8.3-apache

RUN docker-php-ext-install mysqli

# Ajustes de PHP para el modo sin conexión (sesión de 8 h)
COPY docker/stockmaster.ini /usr/local/etc/php/conf.d/stockmaster.ini

# Mantiene la estructura original del repositorio y sirve index.html desde la raíz.
COPY . /var/www/html/

# Falla la compilación si el contexto no contiene los recursos requeridos por el manifest.
RUN test -s /var/www/html/icons/icon-192x192.png \
    && test -s /var/www/html/icons/icon-512x512.png \
    && test -s /var/www/html/icons/icon-maskable-512x512.png

EXPOSE 80
