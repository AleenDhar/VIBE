-- ABM Runs — account_name (Phase 2A, data-mining only)
-- =============================================================================
-- Adds an `account_name` column to `abm_runs` and:
--   1. Backfills from existing chat_messages content via Account-shaped JSON
--      regex (handles both plain and single-escaped forms).
--   2. Adds an AFTER INSERT trigger on `chat_messages` that scans any new
--      assistant content for `"Id":"<account_id>"..."Name":"<value>"` pairs and
--      populates `account_name` on matching `abm_runs` rows in the same chat.
--
-- Deliberately does NOT touch system prompts. Resolution is purely data-driven:
-- if a chat never produced an Account-shaped SOQL response, `account_name`
-- stays NULL and the UI falls back to the raw account_id.
-- =============================================================================

ALTER TABLE public.abm_runs
    ADD COLUMN IF NOT EXISTS account_name TEXT;

CREATE INDEX IF NOT EXISTS idx_abm_runs_account_name
    ON public.abm_runs(account_name)
    WHERE account_name IS NOT NULL;

COMMENT ON COLUMN public.abm_runs.account_name IS
  'Salesforce Account.Name extracted from chat_messages SOQL responses. NULL '
  'when the chat did not contain a resolvable Account JSON shape. Populated '
  'by trigger populate_abm_run_account_name on chat_messages insert.';


-- ── 1. One-shot backfill from existing chat_messages ─────────────────────────
-- For each abm_run with NULL account_name, take the most recent assistant
-- message in the same chat that mentions the account_id, then pull Name from
-- the Account JSON shape (lazy `.*?` between Id and Name to allow intermediate
-- fields like IsDeleted, MasterRecordId, etc.).

WITH resolved AS (
    SELECT DISTINCT ON (r.id)
        r.id,
        COALESCE(
          (regexp_match(m.content,
            '"Id"\s*:\s*"' || r.account_id || '[A-Za-z0-9]*".*?"Name"\s*:\s*"([^"]+)"'
          ))[1],
          (regexp_match(m.content,
            '\\"Id\\"\s*:\s*\\"' || r.account_id || '[A-Za-z0-9]*\\".*?\\"Name\\"\s*:\s*\\"([^"\\]+)\\"'
          ))[1]
        ) AS name_val
    FROM public.abm_runs r
    JOIN public.chat_messages m
      ON m.chat_id = r.chat_id
     AND m.role = 'assistant'
     AND m.content LIKE '%' || r.account_id || '%'
    WHERE r.account_name IS NULL
    ORDER BY r.id, m.created_at DESC
)
UPDATE public.abm_runs r
SET account_name = resolved.name_val
FROM resolved
WHERE r.id = resolved.id
  AND resolved.name_val IS NOT NULL;


-- ── 2. Live capture: AFTER INSERT trigger on chat_messages ───────────────────
-- For every new assistant message, pull every (account_id, name) pair the
-- regex finds and fill in any matching abm_runs row in the same chat that's
-- still missing a name. Bidirectional prefix match handles 15-char heuristic
-- IDs vs 18-char SOQL IDs.

CREATE OR REPLACE FUNCTION public.populate_abm_run_account_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    pair RECORD;
BEGIN
    IF NEW.role <> 'assistant' OR NEW.content IS NULL OR NEW.content = '' THEN
        RETURN NEW;
    END IF;

    -- Cheap early exit: bail if no plausible "Id":"001..." anywhere.
    IF  NEW.content !~ '"Id"\s*:\s*"001[A-Za-z0-9]{12,15}"'
    AND NEW.content !~ '\\"Id\\"\s*:\s*\\"001[A-Za-z0-9]{12,15}\\"' THEN
        RETURN NEW;
    END IF;

    FOR pair IN
        SELECT m[1] AS id_val, m[2] AS name_val
        FROM (
            SELECT regexp_matches(
                NEW.content,
                '"Id"\s*:\s*"(001[A-Za-z0-9]{12,15})".*?"Name"\s*:\s*"([^"]+)"',
                'g'
            ) AS m
            UNION ALL
            SELECT regexp_matches(
                NEW.content,
                '\\"Id\\"\s*:\s*\\"(001[A-Za-z0-9]{12,15})\\".*?\\"Name\\"\s*:\s*\\"([^"\\]+)\\"',
                'g'
            ) AS m
        ) pairs
    LOOP
        UPDATE public.abm_runs
        SET account_name = pair.name_val
        WHERE chat_id = NEW.chat_id
          AND account_name IS NULL
          AND (
              pair.id_val LIKE account_id || '%'
           OR account_id LIKE pair.id_val || '%'
          );
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_abm_run_account_name ON public.chat_messages;
CREATE TRIGGER trg_populate_abm_run_account_name
    AFTER INSERT ON public.chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.populate_abm_run_account_name();
