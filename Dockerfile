FROM php:8.3-apache

RUN docker-php-ext-install mysqli

# Mantiene la estructura original del repositorio y sirve index.html desde la raíz.
COPY . /var/www/html/

EXPOSE 80
