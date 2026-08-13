# syntax=docker/dockerfile:1
#
# Imagem PHP do Taskon — usada pelos serviços `taskon-app` (php-fpm) e
# `taskon-init` do docker-compose.yml.
#
# PHP 8.3 porque é o que composer.json exige ("php": "^8.3") e o que roda no
# host — o mesmo vendor/ serve os dois sem platform_check reclamando.
FROM php:8.3-fpm-bookworm

# Extensões e por que cada uma:
#  pdo_mysql -> MariaDB central da infra (DB_HOST=mariadb).
#  zip       -> composer install.
#  opcache   -> performance (o código vem por bind mount do Windows; ver php.ini).
#  pcntl     -> sinais de queue:work / schedule:work. O app ainda não enfileira
#               nada, mas sem isso o worker ignora SIGTERM e o `down` demora.
#
# NÃO instalamos intl nem gd: o Taskon não usa Number/idn_to_ascii nem manipula
# imagem (capas de card são cor, não arquivo). libicu-dev sozinha põe ~90 MB na
# imagem. Se um dia precisar, acrescente aqui e refaça o build.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        git \
        unzip \
        procps \
        libzip-dev; \
    docker-php-ext-install -j"$(nproc)" pdo_mysql zip opcache pcntl; \
    rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

ENV COMPOSER_ALLOW_SUPERUSER=1 \
    COMPOSER_MEMORY_LIMIT=-1 \
    COMPOSER_PROCESS_TIMEOUT=1200

COPY php.ini /usr/local/etc/php/conf.d/zz-taskon.ini
COPY entrypoint.sh init.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/init.sh

WORKDIR /var/www/html

ENTRYPOINT ["entrypoint.sh"]
CMD ["php-fpm"]
