-- ABM Run Attribution (Path C — Hybrid)
-- =============================================================================
-- Context: multi-account-per-chat is the intended design in the ABM project
-- prompts (`Salesforce Account ID(s)` plural; `Target accounts: 10` default;
-- `Yield between accounts only`). But the rest of the app assumes 1 chat = 1
-- ABM run, which hides 1–11 ABM runs-per-chat behind a single `chat_usage`
-- row, a single `chats.project_id`, and a single Omnivision chat count.
--
-- This migration introduces a thin attribution layer that keeps the existing
-- chat-level code untouched while giving us account-level visibility:
--
--   1. A new `abm_runs` table indexed by (chat_id, seq, account_id).
--   2. A trigger on `chat_messages` that auto-ingests two HTML-comment markers
--      the agent will be instructed to emit:
--        <!-- abm_run_started  account_id="<SF_ID>" seq="<N>" -->
--        <!-- abm_run_completed account_id="<SF_ID>" campaign_id="<cam_...>" pushed="<count>" -->
--   3. Historical backfill from existing `Run an ABM for <SF_ID>` user turns
--      (marked `source='heuristic'` since we can't know pushed counts
--      retrospectively).
--   4. Append of the marker contract to every ABM project's system_prompt
--      (idempotent via `NOT LIKE '%abm_run_started%'` guard).
--
-- Two helper RPCs (`get_abm_runs_for_chat`, `get_abm_run_counts_by_user`)
-- expose the data to the app layer for future Omnivision surfacing.
-- =============================================================================

-- ── 1. Schema ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.abm_runs (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id                uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    account_id             text NOT NULL,
    seq                    int  NOT NULL CHECK (seq >= 1),
    campaign_id            text,
    pushed_count           int,
    started_at             timestamptz NOT NULL,
    completed_at           timestamptz,
    started_message_id     uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
    completed_message_id   uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
    source                 text NOT NULL DEFAULT 'marker'
                                CHECK (source IN ('marker','heuristic','manual')),
    created_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chat_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_abm_runs_chat_id    ON public.abm_runs(chat_id);
CREATE INDEX IF NOT EXISTS idx_abm_runs_account_id ON public.abm_runs(account_id);
CREATE INDEX IF NOT EXISTS idx_abm_runs_started_at ON public.abm_runs(started_at);

COMMENT ON TABLE public.abm_runs IS
  'One row per ABM run, attributing per-account work inside a chat. Populated '
  'by `ingest_abm_run_markers` trigger when the agent emits the structured '
  'markers, or by heuristic backfill from "Run an ABM for <SF_ID>" user turns.';


-- ── 2. Trigger: auto-ingest markers from assistant messages ──────────────────

CREATE OR REPLACE FUNCTION public.ingest_abm_run_markers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    start_m text[];
    end_m   text[];
    body    text;
BEGIN
    -- Markers live in agent output, not user turns.
    IF NEW.role <> 'assistant' THEN
        RETURN NEW;
    END IF;

    body := COALESCE(NEW.content, '');

    -- Run-started marker
    start_m := regexp_match(
        body,
        '<!-- abm_run_started account_id="([^"]+)" seq="([0-9]+)" -->'
    );
    IF start_m IS NOT NULL THEN
        INSERT INTO public.abm_runs
            (chat_id, account_id, seq, started_at, started_message_id, source)
        VALUES
            (NEW.chat_id, start_m[1], start_m[2]::int, NEW.created_at, NEW.id, 'marker')
        ON CONFLICT (chat_id, seq) DO UPDATE
            SET account_id         = EXCLUDED.account_id,
                started_at         = EXCLUDED.started_at,
                started_message_id = EXCLUDED.started_message_id,
                source             = 'marker';
    END IF;

    -- Run-completed marker; pairs with the newest uncompleted run for
    -- the same (chat, account) pair.
    end_m := regexp_match(
        body,
        '<!-- abm_run_completed account_id="([^"]+)" campaign_id="([^"]*)" pushed="([0-9]+)" -->'
    );
    IF end_m IS NOT NULL THEN
        UPDATE public.abm_runs
           SET campaign_id          = end_m[2],
               completed_at         = NEW.created_at,
               pushed_count         = end_m[3]::int,
               completed_message_id = NEW.id
         WHERE id = (
              SELECT id FROM public.abm_runs
               WHERE chat_id    = NEW.chat_id
                 AND account_id = end_m[1]
                 AND completed_at IS NULL
               ORDER BY seq DESC
               LIMIT 1
         );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ingest_abm_run_markers ON public.chat_messages;
CREATE TRIGGER trg_ingest_abm_run_markers
    AFTER INSERT ON public.chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.ingest_abm_run_markers();


-- ── 3. Backfill historical data (source = 'heuristic') ──────────────────────

-- Each user message of form "Run an ABM for <SF_ID>" is treated as a run start.
-- Sequence is assigned chronologically within each chat. campaign_id is
-- populated when the same user message also contains a `cam_...` id (common
-- pattern we observed). pushed_count stays NULL — we have no reliable way to
-- recover it retroactively.
INSERT INTO public.abm_runs
    (chat_id, account_id, seq, started_at, started_message_id, campaign_id, source)
SELECT
    sub.chat_id,
    sub.sf_id,
    sub.seq,
    sub.created_at,
    sub.message_id,
    sub.cam_id,
    'heuristic'
FROM (
    SELECT
        m.chat_id,
        m.id AS message_id,
        m.created_at,
        (regexp_match(m.content, '001[A-Za-z0-9]{12,15}'))[1] AS sf_id,
        (regexp_match(m.content, 'cam_[A-Za-z0-9]+'))[1]           AS cam_id,
        ROW_NUMBER() OVER (PARTITION BY m.chat_id ORDER BY m.created_at, m.id) AS seq
    FROM public.chat_messages m
    WHERE m.role = 'user'
      AND (m.content ~* 'run[[:space:]]{0,10}(an |full )?abm[[:space:]]{0,20}for'
           OR m.content ~* '^run an abm')
      AND regexp_match(m.content, '001[A-Za-z0-9]{12,15}') IS NOT NULL
) sub
WHERE sub.sf_id IS NOT NULL
ON CONFLICT (chat_id, seq) DO NOTHING;


-- ── 4. Append marker contract to every ABM project's system_prompt ──────────

UPDATE public.projects
SET system_prompt = rtrim(system_prompt, E'\n ')
                 || E'\n\n---\n\n'
                 || $marker$## Workflow Markers — Per-Account Attribution (MANDATORY)

The platform tracks per-account cost, lead count, and run sequencing via
structured HTML-comment markers you emit inline. Users do not see these
markers rendered. Emit them verbatim with exact spelling, double quotes, and
attribute order.

### Marker 1 — Run Started

At the **very start of Phase 1** for every account (before any tool calls for
that account), emit on its own line:

    <!-- abm_run_started account_id="<SF_ACCOUNT_ID>" seq="<N>" -->

- `<SF_ACCOUNT_ID>` = the Salesforce Account ID being processed (15- or 18-char,
  e.g. `0012000000mbD3z`, `001P700000SreVp`, `0010O00001jmNCl`).
- `<N>` = 1 for the first ABM in this chat, 2 for the second, 3 for the third,
  and so on. Restart numbering from 1 in every new chat.
- If the user provided an account name rather than an ID, resolve via
  Salesforce first and emit the resolved ID.

Example:

    <!-- abm_run_started account_id="0012000000mbD3z" seq="1" -->

### Marker 2 — Run Completed

Immediately after a successful Phase 6 push, emit on its own line as the last
line of the push report:

    <!-- abm_run_completed account_id="<SF_ACCOUNT_ID>" campaign_id="<cam_...>" pushed="<COUNT>" -->

- `<SF_ACCOUNT_ID>` = the same ID as the matching Run Started marker.
- `<cam_...>` = the Lemlist campaign ID the leads were pushed to.
- `<COUNT>` = integer count of leads actually pushed in this run.

Example:

    <!-- abm_run_completed account_id="0012000000mbD3z" campaign_id="cam_QCYYBeGjf5zGggLKe" pushed="5" -->

### Rules

- Emit each marker exactly once per account.
- Emit Run Started BEFORE any Phase 1 tool calls for that account.
- Emit Run Completed only after a successful Lemlist push. Do NOT emit it on
  push failure or user cancellation.
- Markers are case-sensitive and quote-sensitive. Use straight double quotes
  (`"`), not curly quotes (`"` `"`) or single quotes.
- These markers are orthogonal to the existing `<!-- workflow_output -->`
  block used by the workflow engine — both may coexist in the same response.
$marker$
WHERE name ILIKE '%ABM%'
  AND system_prompt IS NOT NULL
  AND length(system_prompt) > 100
  AND system_prompt NOT LIKE '%abm_run_started%';


-- ── 5. Helper RPCs for the app layer ─────────────────────────────────────────

-- Per-chat drill-down: what ABMs happened inside this chat?
CREATE OR REPLACE FUNCTION public.get_abm_runs_for_chat(p_chat_id uuid)
RETURNS TABLE (
    seq              int,
    account_id       text,
    campaign_id      text,
    pushed_count     int,
    started_at       timestamptz,
    completed_at     timestamptz,
    source           text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT seq, account_id, campaign_id, pushed_count, started_at, completed_at, source
    FROM public.abm_runs
    WHERE chat_id = p_chat_id
    ORDER BY seq;
$$;

-- Per-user summary: run counts + distinct accounts touched, optionally scoped
-- to a date window. Filters by activity (started_at) — same semantics as the
-- Omnivision aggregate fix.
CREATE OR REPLACE FUNCTION public.get_abm_run_counts_by_user(
    from_date DATE DEFAULT NULL,
    to_date   DATE DEFAULT NULL
)
RETURNS TABLE (
    user_id              uuid,
    run_count            bigint,
    distinct_accounts    bigint,
    chats_with_reuse     bigint,
    max_runs_in_one_chat bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    biz_tz CONSTANT text := 'Asia/Kolkata';
    from_ts timestamptz;
    to_ts   timestamptz;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('admin','super_admin')
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    from_ts := CASE WHEN from_date IS NULL THEN NULL
                    ELSE (from_date::timestamp AT TIME ZONE biz_tz) END;
    to_ts   := CASE WHEN to_date IS NULL THEN NULL
                    ELSE ((to_date + 1)::timestamp AT TIME ZONE biz_tz) END;

    RETURN QUERY
    WITH filtered_runs AS (
        SELECT r.*, c.user_id AS chat_user_id
        FROM public.abm_runs r
        JOIN public.chats c ON c.id = r.chat_id
        WHERE (from_ts IS NULL OR r.started_at >= from_ts)
          AND (to_ts   IS NULL OR r.started_at <  to_ts)
    ),
    per_chat AS (
        SELECT chat_user_id, chat_id, COUNT(*) AS run_count
        FROM filtered_runs
        GROUP BY chat_user_id, chat_id
    )
    SELECT
        fr.chat_user_id                                    AS user_id,
        COUNT(*)::bigint                                   AS run_count,
        COUNT(DISTINCT fr.account_id)::bigint              AS distinct_accounts,
        (SELECT COUNT(*) FROM per_chat p
         WHERE p.chat_user_id = fr.chat_user_id
           AND p.run_count > 1)::bigint                    AS chats_with_reuse,
        COALESCE(
          (SELECT MAX(run_count) FROM per_chat p
           WHERE p.chat_user_id = fr.chat_user_id), 0
        )::bigint                                          AS max_runs_in_one_chat
    FROM filtered_runs fr
    GROUP BY fr.chat_user_id;
END;
$$;
