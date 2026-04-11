#!/bin/bash
# Cria múltiplos bancos no mesmo PostgreSQL.
# A variável POSTGRES_MULTIPLE_DATABASES deve conter nomes separados por vírgula.
# O banco padrão (POSTGRES_DB) já é criado automaticamente pelo entrypoint do postgres.

set -e
set -u

function create_database() {
    local database=$1
    echo "Creating database '$database' if it does not exist..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
        SELECT 'CREATE DATABASE $database'
        WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$database')\gexec
EOSQL
}

if [ -n "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
    echo "Multiple databases requested: $POSTGRES_MULTIPLE_DATABASES"
    for db in $(echo "$POSTGRES_MULTIPLE_DATABASES" | tr ',' ' '); do
        create_database "$db"
    done
    echo "Multiple databases created."
fi
