-- lake.opportunity_diagnoses — historical + going-forward diagnosis data lake
-- =============================================================================
-- Idempotent. Safe to re-run.
--
-- Provisions the `lake` schema, the `opportunity_diagnoses` table, indexes,
-- service-role grants, and exposes `lake` to PostgREST so the Replit-side
-- DeepAgent (which uses the Supabase service-role JWT) can read/write through
-- the REST API via .schema("lake").
--
-- Schema ownership: this migration is the only place the `lake` schema is
-- defined. Replit writes data; this repo owns DDL.
--
-- Deliberate design choices:
--   * chat_id and project_id are text (not uuid) — some historical chat ids
--     in the lake may not exist in public.chats anymore, so no FK is added.
--   * No RLS policies — lake is service-role-only for now (no end-user reads).
--   * No seeded rows — backfill is run separately on the Replit side via
--     scripts/backfill_lake.py.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS lake;

CREATE TABLE IF NOT EXISTS lake.opportunity_diagnoses (
    id                   bigserial PRIMARY KEY,
    chat_id              text        NOT NULL,
    project_id           text        NOT NULL,
    run_at               timestamptz NOT NULL,
    run_by_user_id       text,
    diagnosis_md         text,

    -- Salesforce-derived (regex extracted by lake.py Path A)
    account_id           text,
    account_name         text,
    opportunity_id       text,
    opportunity_name     text,
    stage                text,
    amount               numeric,
    close_date           date,
    forecast_category    text,
    owner                text,
    owner_name           text,
    products             jsonb,

    -- Avoma-derived
    avoma_meeting_count  integer,
    last_meeting_at      timestamptz,

    -- GPT-4o-mini narrative extraction (Path B)
    momentum_verdict     text,
    health_rating        text,
    top_risks            jsonb,
    recommendations      jsonb,

    created_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT opportunity_diagnoses_chat_run_uniq UNIQUE (chat_id, run_at)
);

CREATE INDEX IF NOT EXISTS opportunity_diagnoses_account_id_run_at_idx
    ON lake.opportunity_diagnoses (account_id, run_at DESC);

CREATE INDEX IF NOT EXISTS opportunity_diagnoses_project_id_idx
    ON lake.opportunity_diagnoses (project_id);


-- ── Grants ──────────────────────────────────────────────────────────────────
-- Standard Supabase role grants so the service-role JWT used by the Python
-- supabase client can read/write through PostgREST.

GRANT USAGE ON SCHEMA lake TO postgres, anon, authenticated, service_role;
GRANT ALL   ON ALL TABLES    IN SCHEMA lake TO postgres, anon, authenticated, service_role;
GRANT ALL   ON ALL SEQUENCES IN SCHEMA lake TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA lake
    GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA lake
    GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;


-- ── Expose `lake` to PostgREST ──────────────────────────────────────────────
-- Without this, .schema("lake") calls return PGRST106 "Invalid schema".
-- NB: on hosted Supabase, the dashboard setting (Settings → API → Exposed
-- schemas) is authoritative and must also list `lake` for the change to
-- persist across PostgREST restarts.

ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, lake';
NOTIFY pgrst, 'reload config';
