-- Mesa central (Opción A) — PostgreSQL bootstrap schema, version 1.
--
-- This file is the single schema for both the board storage package and the
-- HTTP API in `gateway/board-api.mjs`. The API applies this exact file; it
-- keeps no DDL of its own.
--
-- Idempotent: every object is created only when absent, and every policy is
-- replaced. Future column or constraint changes belong in expand/contract
-- migrations; this file is the v1 bootstrap, not a migration runner.
--
-- Identifier contract:
--   * tenant_id, id, space_id, item_id are uuid.
--   * The API receives opaque tenant and space identifiers from the gateway
--     session. `tenant_key` and `space_key` preserve those identifiers; the
--     uuid columns are the keys RLS and the indexes use. See the API fields
--     section below for the mapping.
--
-- Ownership model:
--   * A migration role owns the tables and runs this file.
--   * `mesa_app` is a NOLOGIN group role with no BYPASSRLS. Runtime logins are
--     granted `mesa_app` and enter it with `SET LOCAL ROLE mesa_app` inside
--     `withTenant()` (src/tenant.ts).
--   * Row level security is ENABLEd and FORCEd, so even the table owner is
--     subject to the policies (superusers and BYPASSRLS roles still bypass).
--
-- Session contract, set transaction-locally by `withTenant()`:
--   app.tenant_id  uuid   required for every statement
--   app.actor_id   text   the authenticated principal (owner checks)
--   app.role       text   `client_b2b` or a console role (admin/superadmin/ceo)
--
-- Missing or empty settings fail closed: mesa_current_tenant_id() returns NULL,
-- no row matches, and INSERT/UPDATE checks evaluate to NULL (rejected).

BEGIN;

-- ---------------------------------------------------------------------------
-- Application role
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mesa_app') THEN
    CREATE ROLE mesa_app NOLOGIN;
  END IF;
END
$$;

-- Reset the attributes even when the role already exists, so a previous grant
-- of BYPASSRLS or SUPERUSER cannot survive a re-run.
ALTER ROLE mesa_app
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

-- ---------------------------------------------------------------------------
-- Session helpers
-- ---------------------------------------------------------------------------

-- The parameterized equivalent of `SET LOCAL app.tenant_id = ...`. PostgreSQL
-- does not accept bind parameters in SET, so withTenant() calls set_config().
CREATE OR REPLACE FUNCTION public.mesa_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.mesa_current_actor_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')
$$;

CREATE OR REPLACE FUNCTION public.mesa_current_app_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.role', true), '')
$$;

-- Console roles named by the board contract (A-58). Everything else, including
-- `client_b2b` and an unset role, must own the row it writes.
CREATE OR REPLACE FUNCTION public.mesa_is_privileged_app_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(public.mesa_current_app_role() IN ('admin', 'superadmin', 'ceo'), false)
$$;

-- ---------------------------------------------------------------------------
-- mesa_items: one row per Mesa work item
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mesa_items (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  space_id uuid,
  business_key text NOT NULL,
  state text NOT NULL,
  row_version bigint NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_items_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT mesa_items_owner_id_not_blank CHECK (btrim(owner_id) <> ''),
  CONSTRAINT mesa_items_business_key_not_blank CHECK (btrim(business_key) <> ''),
  CONSTRAINT mesa_items_state_not_blank CHECK (btrim(state) <> ''),
  CONSTRAINT mesa_items_row_version_positive CHECK (row_version >= 1),
  CONSTRAINT mesa_items_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

COMMENT ON TABLE public.mesa_items IS
  'Mesa central work items. Tenant is the isolation boundary and part of every key.';
COMMENT ON COLUMN public.mesa_items.business_key IS
  'Server-derived identity of the artifact. Unique per tenant among non-terminal rows.';
COMMENT ON COLUMN public.mesa_items.row_version IS
  'Optimistic concurrency token written by the application; the database never increments it.';
COMMENT ON COLUMN public.mesa_items.updated_at IS
  'Maintained by the mesa_items_touch_updated_at trigger on UPDATE.';

-- ---------------------------------------------------------------------------
-- HTTP API fields
-- ---------------------------------------------------------------------------
--
-- `gateway/board-api.mjs` persists four resource fields that the board
-- document does not keep inside `payload`: the presentation title, the evidence
-- references, the producing run, and the retry key. They are columns because
-- the partial unique index and the replay lookup need them; keeping them in
-- `payload` would make both unindexable.
--
-- `tenant_key` and `space_key` hold the opaque identifiers the gateway session
-- supplied. The API maps a value that is not already a UUID to a deterministic
-- UUIDv5 (documented in gateway/BOARD-API.md) and writes both the derived uuid
-- and the original key. A client writing the uuid directly leaves the key NULL,
-- which is why the key columns are nullable and the API falls back to the uuid.
--
-- The bootstrap is the only place these columns are declared. ADD COLUMN IF NOT
-- EXISTS makes an existing database converge; it never rewrites the uuid key
-- types of an earlier text-id database, and the guard below rejects such a
-- database instead of letting the API fail per request.

ALTER TABLE public.mesa_items
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS run_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS tenant_key text,
  ADD COLUMN IF NOT EXISTS space_key text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'mesa_items'
       AND a.attname IN ('tenant_id', 'id', 'space_id')
       AND a.atttypid <> 'uuid'::regtype
  ) THEN
    RAISE EXCEPTION
      'mesa_items has non-uuid key columns (an earlier gateway bootstrap); recreate it with this schema or migrate its keys to uuid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mesa_items_evidence_array'
       AND conrelid = 'public.mesa_items'::regclass
  ) THEN
    ALTER TABLE public.mesa_items
      ADD CONSTRAINT mesa_items_evidence_array
      CHECK (jsonb_typeof(evidence) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mesa_items_title_not_blank'
       AND conrelid = 'public.mesa_items'::regclass
  ) THEN
    ALTER TABLE public.mesa_items
      ADD CONSTRAINT mesa_items_title_not_blank
      CHECK (title IS NULL OR btrim(title) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mesa_items_idempotency_key_not_blank'
       AND conrelid = 'public.mesa_items'::regclass
  ) THEN
    ALTER TABLE public.mesa_items
      ADD CONSTRAINT mesa_items_idempotency_key_not_blank
      CHECK (idempotency_key IS NULL OR btrim(idempotency_key) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mesa_items_tenant_key_not_blank'
       AND conrelid = 'public.mesa_items'::regclass
  ) THEN
    ALTER TABLE public.mesa_items
      ADD CONSTRAINT mesa_items_tenant_key_not_blank
      CHECK (tenant_key IS NULL OR btrim(tenant_key) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mesa_items_space_key_not_blank'
       AND conrelid = 'public.mesa_items'::regclass
  ) THEN
    ALTER TABLE public.mesa_items
      ADD CONSTRAINT mesa_items_space_key_not_blank
      CHECK (space_key IS NULL OR btrim(space_key) <> '');
  END IF;
END
$$;

COMMENT ON COLUMN public.mesa_items.title IS
  'Presentation title supplied to the HTTP API. NULL for rows written before the API owned this field.';
COMMENT ON COLUMN public.mesa_items.evidence IS
  'JSON array of evidence references. The API requires at least one on create.';
COMMENT ON COLUMN public.mesa_items.run_id IS
  'Run that produced the item, as supplied by the producer.';
COMMENT ON COLUMN public.mesa_items.idempotency_key IS
  'Client retry key. Unique per tenant among rows that carry one.';
COMMENT ON COLUMN public.mesa_items.tenant_key IS
  'Opaque tenant identifier from the gateway session when tenant_id was derived from it.';
COMMENT ON COLUMN public.mesa_items.space_key IS
  'Opaque space identifier from the gateway session when space_id was derived from it.';

-- One live item per tenant and business key. The terminal list mirrors the
-- board's TERMINAL_STATES (APROBADO, EJECUTADO, DESCARTADO, SUSTITUIDO).
-- Keep the literals in sync when the board adds a terminal state; a SQL helper
-- is deliberately not used because the index predicate must stay immutable.
CREATE UNIQUE INDEX IF NOT EXISTS mesa_items_live_business_key_uniq
  ON public.mesa_items (tenant_id, business_key)
  WHERE state NOT IN ('APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO');

-- Retry keys are unique per tenant, and a row without one does not collide.
-- This is the index that turns a repeated POST into a replay instead of a
-- second item.
CREATE UNIQUE INDEX IF NOT EXISTS mesa_items_tenant_idempotency_key_uniq
  ON public.mesa_items (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS mesa_items_tenant_state_created_idx
  ON public.mesa_items (tenant_id, state, created_at);

CREATE INDEX IF NOT EXISTS mesa_items_tenant_space_idx
  ON public.mesa_items (tenant_id, space_id);

CREATE INDEX IF NOT EXISTS mesa_items_tenant_owner_idx
  ON public.mesa_items (tenant_id, owner_id);

-- The API lists a client's own items with `lower(owner_id) = $n`, so it needs a
-- matching expression index; the plain owner index above serves exact lookups.
CREATE INDEX IF NOT EXISTS mesa_items_tenant_owner_lower_idx
  ON public.mesa_items (tenant_id, lower(owner_id));

-- updated_at is server-owned. row_version stays application-owned so an
-- optimistic-concurrency retry is never masked by a silent bump.
CREATE OR REPLACE FUNCTION public.mesa_items_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mesa_items_touch_updated_at ON public.mesa_items;
CREATE TRIGGER mesa_items_touch_updated_at
  BEFORE UPDATE ON public.mesa_items
  FOR EACH ROW
  EXECUTE FUNCTION public.mesa_items_touch_updated_at();

-- ---------------------------------------------------------------------------
-- mesa_events: append-only audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mesa_events (
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL,
  seq bigint NOT NULL,
  actor text NOT NULL,
  command text NOT NULL,
  from_state text,
  to_state text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_events_pkey PRIMARY KEY (tenant_id, item_id, seq),
  CONSTRAINT mesa_events_item_fk
    FOREIGN KEY (tenant_id, item_id)
    REFERENCES public.mesa_items (tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT mesa_events_seq_positive CHECK (seq >= 1),
  CONSTRAINT mesa_events_actor_not_blank CHECK (btrim(actor) <> ''),
  CONSTRAINT mesa_events_command_not_blank CHECK (btrim(command) <> ''),
  CONSTRAINT mesa_events_to_state_not_blank CHECK (btrim(to_state) <> ''),
  CONSTRAINT mesa_events_from_state_not_blank
    CHECK (from_state IS NULL OR btrim(from_state) <> ''),
  CONSTRAINT mesa_events_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

COMMENT ON TABLE public.mesa_events IS
  'Append-only Mesa audit trail. Composite FK keeps an event inside its item tenant.';
COMMENT ON COLUMN public.mesa_events.seq IS
  'Per-item monotonic sequence supplied by the writer. The primary key rejects replay.';

CREATE INDEX IF NOT EXISTS mesa_events_tenant_at_idx
  ON public.mesa_events (tenant_id, at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.mesa_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mesa_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mesa_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mesa_events FORCE ROW LEVEL SECURITY;

-- mesa_items: tenant is necessary for every operation. Writes additionally
-- require ownership, except for the console roles. SELECT stays tenant-wide
-- because finer visibility (space membership, shares) belongs to the board API.
DROP POLICY IF EXISTS mesa_items_select ON public.mesa_items;
CREATE POLICY mesa_items_select ON public.mesa_items
  FOR SELECT TO mesa_app
  USING (tenant_id = public.mesa_current_tenant_id());

DROP POLICY IF EXISTS mesa_items_insert ON public.mesa_items;
CREATE POLICY mesa_items_insert ON public.mesa_items
  FOR INSERT TO mesa_app
  WITH CHECK (
    tenant_id = public.mesa_current_tenant_id()
    AND (
      public.mesa_is_privileged_app_role()
      OR owner_id = public.mesa_current_actor_id()
    )
  );

DROP POLICY IF EXISTS mesa_items_update ON public.mesa_items;
CREATE POLICY mesa_items_update ON public.mesa_items
  FOR UPDATE TO mesa_app
  USING (
    tenant_id = public.mesa_current_tenant_id()
    AND (
      public.mesa_is_privileged_app_role()
      OR owner_id = public.mesa_current_actor_id()
    )
  )
  WITH CHECK (
    tenant_id = public.mesa_current_tenant_id()
    AND (
      public.mesa_is_privileged_app_role()
      OR owner_id = public.mesa_current_actor_id()
    )
  );

DROP POLICY IF EXISTS mesa_items_delete ON public.mesa_items;
CREATE POLICY mesa_items_delete ON public.mesa_items
  FOR DELETE TO mesa_app
  USING (
    tenant_id = public.mesa_current_tenant_id()
    AND (
      public.mesa_is_privileged_app_role()
      OR owner_id = public.mesa_current_actor_id()
    )
  );

-- mesa_events: insert and read only. There is deliberately no UPDATE or DELETE
-- policy; the table privileges below also withhold those commands, so the
-- audit trail cannot be rewritten even by a future policy mistake.
DROP POLICY IF EXISTS mesa_events_select ON public.mesa_events;
CREATE POLICY mesa_events_select ON public.mesa_events
  FOR SELECT TO mesa_app
  USING (tenant_id = public.mesa_current_tenant_id());

DROP POLICY IF EXISTS mesa_events_insert ON public.mesa_events;
CREATE POLICY mesa_events_insert ON public.mesa_events
  FOR INSERT TO mesa_app
  WITH CHECK (tenant_id = public.mesa_current_tenant_id());

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.mesa_items FROM PUBLIC;
REVOKE ALL ON TABLE public.mesa_events FROM PUBLIC;

REVOKE ALL ON TABLE public.mesa_items FROM mesa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mesa_items TO mesa_app;

-- SELECT + INSERT only: no UPDATE, DELETE, TRUNCATE, or TRIGGER.
REVOKE ALL ON TABLE public.mesa_events FROM mesa_app;
GRANT SELECT, INSERT ON TABLE public.mesa_events TO mesa_app;

REVOKE ALL ON FUNCTION public.mesa_current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_current_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_current_app_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_is_privileged_app_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_items_touch_updated_at() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mesa_current_tenant_id() TO mesa_app;
GRANT EXECUTE ON FUNCTION public.mesa_current_actor_id() TO mesa_app;
GRANT EXECUTE ON FUNCTION public.mesa_current_app_role() TO mesa_app;
GRANT EXECUTE ON FUNCTION public.mesa_is_privileged_app_role() TO mesa_app;
GRANT EXECUTE ON FUNCTION public.mesa_items_touch_updated_at() TO mesa_app;

GRANT USAGE ON SCHEMA public TO mesa_app;
REVOKE CREATE ON SCHEMA public FROM mesa_app;

COMMIT;
