#!/bin/sh
# Preparação ÚNICA do ambiente (serviço `taskon-init` do compose). Roda antes do
# app subir — que depende de `service_completed_successfully`.
# É IDEMPOTENTE: pode rodar em todo `docker compose up` sem duplicar nada.
set -e

cd /var/www/html

log() { echo "[init] $*"; }

# ---------------------------------------------------------------- .env / chave
if [ ! -f .env ]; then
    log ".env ausente — copiando de .env.example"
    cp .env.example .env
fi

# ------------------------------------------------------------------- composer
# vendor/ mora num VOLUME do Docker (ver docker-compose.yml), separado do
# vendor/ do Windows que a IDE e o artisan do host usam. Por isso a primeira
# subida sempre instala, mesmo com o projeto já pronto no host.
if [ ! -f vendor/autoload.php ]; then
    log "vendor/ ausente no volume — rodando composer install (demora na 1ª vez)"
    composer install --no-interaction --prefer-dist --no-progress
else
    log "vendor/ já existe — pulando composer install"
fi

if ! grep -q '^APP_KEY=base64:' .env; then
    log "APP_KEY vazia — gerando"
    php artisan key:generate --force --ansi
fi

# ---------------------------------------------------------- caches congelados
# O host é Windows: um `config:cache` feito lá congela DB_HOST=127.0.0.1 dentro
# de bootstrap/cache/, e as variáveis que o compose injeta (DB_HOST=mariadb)
# seriam IGNORADAS. bootstrap/cache é bind mount → tem que limpar aqui, sempre.
log "limpando caches de config/rota/view"
php artisan optimize:clear >/dev/null 2>&1 || true

# ------------------------------------------------------------------ migrations
log "migrando o banco (${DB_DATABASE} em ${DB_HOST})"
php artisan migrate --force --ansi

# --------------------------------------------------------------------- seeder
# DatabaseSeeder cria usuários com e-mail único — NÃO é idempotente. Só semeia
# quando não há nenhum usuário, ou seja: banco realmente novo.
USUARIOS=$(php artisan tinker --execute='echo \App\Models\User::count();' 2>/dev/null | tr -dc '0-9' || echo '')

if [ "$USUARIOS" = "0" ]; then
    log "banco vazio — rodando db:seed (cria victor@taskon.test e ana@taskon.test)"
    php artisan db:seed --force --ansi
elif [ -z "$USUARIOS" ]; then
    log "AVISO: não deu para contar os usuários — seed NÃO executado."
else
    log "já existem ${USUARIOS} usuário(s) — seed pulado"
fi

# ---------------------------------------------------------------- assets Vite
# O nginx serve public/build direto do bind mount. Se o build nunca rodou, a
# página abre sem CSS nenhum e parece erro de proxy — avisa alto.
if [ ! -f public/build/manifest.json ]; then
    log "AVISO: public/build/manifest.json não existe."
    log "       Rode 'npm run build' no HOST antes de abrir https://tasks.localhost"
fi

log "ambiente pronto."
