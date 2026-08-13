#!/bin/sh
# Entrypoint de TODO container PHP do Taskon (app e, se um dia existir, queue).
# Só garante o pré-requisito para o processo subir; a preparação pesada
# (composer/migrate) é do init.sh, que roda uma vez no serviço `taskon-init`.
set -e

DB_HOST="${DB_HOST:-mariadb}"
DB_PORT="${DB_PORT:-3306}"

aguardar_banco() {
    # O MariaDB é da INFRA, não deste compose — não dá para usar
    # `depends_on: service_healthy`. Ele pode estar subindo, reiniciando ou
    # simplesmente desligado, então esperamos aqui.
    #
    # O teste é feito com o PDO do próprio PHP, e não com mysqladmin: assim a
    # imagem não precisa do pacote default-mysql-client só para isso.
    tentativa=0
    while [ "$tentativa" -lt 60 ]; do
        if php -r '
            try {
                new PDO(
                    sprintf("mysql:host=%s;port=%s", getenv("DB_HOST"), getenv("DB_PORT")),
                    getenv("DB_USERNAME"),
                    getenv("DB_PASSWORD"),
                    [PDO::ATTR_TIMEOUT => 2]
                );
                exit(0);
            } catch (Throwable $e) {
                exit(1);
            }
        ' >/dev/null 2>&1; then
            return 0
        fi

        tentativa=$((tentativa + 1))
        [ "$tentativa" = 1 ] && echo "[entrypoint] aguardando o banco em ${DB_HOST}:${DB_PORT}..."
        sleep 2
    done

    echo "[entrypoint] AVISO: banco nao respondeu em 120s." >&2
    echo "[entrypoint] A infra do Traefik esta no ar? (docker ps | grep mariadb)" >&2
    return 0
}

# Opcache em tempo de execução — o custo de I/O do bind mount do Windows mora
# aqui.
#   OPCACHE_VALIDATE_TIMESTAMPS=1 (default) -> edição em PHP aparece sozinha, no
#     máximo OPCACHE_REVALIDATE_FREQ segundos depois.
#   OPCACHE_VALIDATE_TIMESTAMPS=0 -> modo turbo: zero stat, request bem mais
#     rápida, MAS toda alteração de PHP exige `docker compose restart taskon-app`.
cat > /usr/local/etc/php/conf.d/zz-opcache-runtime.ini <<INI
opcache.validate_timestamps = ${OPCACHE_VALIDATE_TIMESTAMPS:-1}
opcache.revalidate_freq = ${OPCACHE_REVALIDATE_FREQ:-2}
INI

aguardar_banco

# storage/ e bootstrap/cache precisam existir e ser graváveis. Em bind mount do
# Windows o chmod é no-op (o virtiofs já expõe tudo gravável) — daí o `|| true`.
mkdir -p \
    storage/app/public \
    storage/app/private \
    storage/framework/cache/data \
    storage/framework/sessions \
    storage/framework/views \
    storage/logs \
    bootstrap/cache 2>/dev/null || true
chmod -R ug+rwX storage bootstrap/cache 2>/dev/null || true

exec "$@"
