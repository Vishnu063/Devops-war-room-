#!/bin/sh
set -eu
# Entry point runs this once, on a new volume only. psql variables quote passwords.
APP_DATABASE_PASSWORD="$(cat /run/secrets/app_password)"
BACKUP_DATABASE_PASSWORD="$(cat /run/secrets/backup_password)"
MIGRATOR_DATABASE_PASSWORD="$(cat /run/secrets/migrator_password)"
: "${APP_DATABASE_PASSWORD:?Missing application password}"
: "${MIGRATOR_DATABASE_PASSWORD:?Missing migration password}"
: "${BACKUP_DATABASE_PASSWORD:?Missing backup password}"
export APP_DATABASE_PASSWORD MIGRATOR_DATABASE_PASSWORD BACKUP_DATABASE_PASSWORD
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password APP_DATABASE_PASSWORD
\getenv migrator_password MIGRATOR_DATABASE_PASSWORD
\getenv backup_password BACKUP_DATABASE_PASSWORD
CREATE ROLE novacart_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE ROLE novacart_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migrator_password';
CREATE ROLE novacart_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'backup_password';
ALTER DATABASE novacart OWNER TO novacart_migrator;
REVOKE ALL ON DATABASE novacart FROM PUBLIC;
GRANT CONNECT ON DATABASE novacart TO novacart_app,novacart_backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO novacart_app,novacart_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE novacart_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO novacart_app;
ALTER DEFAULT PRIVILEGES FOR ROLE novacart_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO novacart_app;
ALTER DEFAULT PRIVILEGES FOR ROLE novacart_migrator IN SCHEMA public GRANT SELECT ON TABLES TO novacart_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE novacart_migrator IN SCHEMA public GRANT SELECT ON SEQUENCES TO novacart_backup;
SQL
unset APP_DATABASE_PASSWORD MIGRATOR_DATABASE_PASSWORD BACKUP_DATABASE_PASSWORD

touch "$PGDATA/novacart-roles.ready"
