\set ON_ERROR_STOP on

-- The bootstrap must survive a second run. Apply it twice here so the Docker
-- lane proves idempotency at initdb time, exactly like the PGlite suite does.
\i /mesa/schema.sql
\i /mesa/schema.sql

-- Runtime login for tests. It owns nothing and inherits nothing: every
-- transaction must enter mesa_app with SET LOCAL ROLE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mesa_login') THEN
    CREATE ROLE mesa_login LOGIN;
  END IF;
END
$$;

ALTER ROLE mesa_login
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS
  NOINHERIT;

ALTER ROLE mesa_login PASSWORD 'mesa_test';
GRANT mesa_app TO mesa_login;
