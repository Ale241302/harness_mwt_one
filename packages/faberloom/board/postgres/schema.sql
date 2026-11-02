-- Mesa central (Opción A) — PostgreSQL bootstrap schema, version 1.
--
-- Idempotent: every object is created only when absent, and every policy is
-- replaced. Future column or constraint changes belong in expand/contract
-- migrations; this file is the v1 bootstrap, not a migration runner.
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

-- One live item per tenant and business key. The terminal list mirrors the
-- board's TERMINAL_STATES (APROBADO, EJECUTADO, DESCARTADO, SUSTITUIDO).
-- Keep the literals in sync when the board adds a terminal state; a SQL helper
-- is deliberately not used because the index predicate must stay immutable.
CREATE UNIQUE INDEX IF NOT EXISTS mesa_items_live_business_key_uniq
  ON public.mesa_items (tenant_id, business_key)
  WHERE state NOT IN ('APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO');

CREATE INDEX IF NOT EXISTS mesa_items_tenant_state_created_idx
  ON public.mesa_items (tenant_id, state, created_at);

CREATE INDEX IF NOT EXISTS mesa_items_tenant_space_idx
  ON public.mesa_items (tenant_id, space_id);

CREATE INDEX IF NOT EXISTS mesa_items_tenant_owner_idx
  ON public.mesa_items (tenant_id, owner_id);

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
