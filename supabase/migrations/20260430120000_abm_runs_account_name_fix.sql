-- ABM Runs — account_name resolution fixes
-- =============================================================================
-- Patches three bugs in 20260430000000_abm_runs_account_name.sql:
--
--   1. Original backfill used DISTINCT ON (r.id) ORDER BY m.created_at DESC,
--      which scanned only the most-recent matching message per run. Most
--      SOQL Account responses live in MID-chat tool_result rows, not the
--      final assistant prose, so ~96% of recoverable rows were missed.
--      Fix: aggregate across ALL matching messages, take the first non-null.
--
--   2. The chat_messages-side trigger only fires on new messages — but if the
--      Account JSON arrives BEFORE the marker creates the abm_runs row, the
--      message-side trigger has nothing to update. Adding a BEFORE INSERT
--      trigger on abm_runs scans existing chat_messages and resolves the
--      name at insert time.
--
--   3. The lax regex `"Id":"<id>".*?"Name":"..."` was greedy enough to pick
--      up a nested `Contact.Name` when it appeared between the Account's Id
--      and Name (e.g., "Henri Huynh" surfaced instead of "Renault Group").
--      Tighten by requiring `"type":"Account"` to appear before the Id
--      anchor and forbidding `{` / `}` between Id and Name (must stay in
--      the same flat object literal).
--
-- Recomputes account_name for ALL rows under the tight regex — both
-- backfills genuinely-resolvable NULLs and clears prior false positives.
-- Rows where the tight regex returns nothing fall back to NULL, which the
-- UI renders as the raw account_id (no regression vs Phase 1 baseline).
--
-- NB: Postgres POSIX regex caps `{m,n}` at 255. Bounded ranges use {0,200};
-- Id-to-Name span uses unbounded `[^{}]*` (constrained char class — safe
-- against catastrophic backtracking).
-- =============================================================================

-- ── 1. Replace the chat_messages trigger function with the tight regex ──────

DROP TRIGGER IF EXISTS trg_populate_abm_run_account_name ON public.chat_messages;

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

    -- Cheap early exit: bail if no Account-shaped JSON marker anywhere.
    IF  NEW.content !~ '"type"\s*:\s*"Account"'
    AND NEW.content !~ '\\"type\\"\s*:\s*\\"Account\\"' THEN
        RETURN NEW;
    END IF;

    FOR pair IN
        SELECT m[1] AS id_val, m[2] AS name_val
        FROM (
            -- Plain JSON: "type":"Account" must precede Id; no {} allowed
            -- between Id and Name (keeps us inside the flat Account object).
            SELECT regexp_matches(
                NEW.content,
                '"type"\s*:\s*"Account".{0,200}"Id"\s*:\s*"(001[A-Za-z0-9]{12,15})"[^{}]*"Name"\s*:\s*"([^"]+)"',
                'gs'
            ) AS m
            UNION ALL
            -- Single-escaped (Python list-of-dict serialization in tool_result rows)
            SELECT regexp_matches(
                NEW.content,
                '\\"type\\"\s*:\s*\\"Account\\".{0,200}\\"Id\\"\s*:\s*\\"(001[A-Za-z0-9]{12,15})\\"[^{}]*\\"Name\\"\s*:\s*\\"([^"\\]+)\\"',
                'gs'
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

CREATE TRIGGER trg_populate_abm_run_account_name
    AFTER INSERT ON public.chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.populate_abm_run_account_name();


-- ── 2. NEW: BEFORE INSERT trigger on abm_runs ────────────────────────────────
-- Resolves account_name from existing chat_messages when the run is created.
-- Covers the timing case where Account JSON arrives BEFORE the marker creates
-- the abm_runs row (the message-side trigger has nothing to update at that
-- point, since no abm_runs row exists yet).

CREATE OR REPLACE FUNCTION public.resolve_abm_run_account_name_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    name_val text;
BEGIN
    IF NEW.account_name IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT (
        ARRAY_AGG(
            COALESCE(
              (regexp_match(m.content,
                '"type"\s*:\s*"Account".{0,200}"Id"\s*:\s*"' || NEW.account_id || '[A-Za-z0-9]*"[^{}]*"Name"\s*:\s*"([^"]+)"',
                's'
              ))[1],
              (regexp_match(m.content,
                '\\"type\\"\s*:\s*\\"Account\\".{0,200}\\"Id\\"\s*:\s*\\"' || NEW.account_id || '[A-Za-z0-9]*\\"[^{}]*\\"Name\\"\s*:\s*\\"([^"\\]+)\\"',
                's'
              ))[1]
            )
            ORDER BY m.created_at
        ) FILTER (WHERE
            (regexp_match(m.content,
              '"type"\s*:\s*"Account".{0,200}"Id"\s*:\s*"' || NEW.account_id || '[A-Za-z0-9]*"[^{}]*"Name"\s*:\s*"([^"]+)"',
              's'
            )) IS NOT NULL
            OR
            (regexp_match(m.content,
              '\\"type\\"\s*:\s*\\"Account\\".{0,200}\\"Id\\"\s*:\s*\\"' || NEW.account_id || '[A-Za-z0-9]*\\"[^{}]*\\"Name\\"\s*:\s*\\"([^"\\]+)\\"',
              's'
            )) IS NOT NULL
        )
    )[1]
    INTO name_val
    FROM public.chat_messages m
    WHERE m.chat_id = NEW.chat_id
      AND m.role = 'assistant'
      AND m.content LIKE '%' || NEW.account_id || '%';

    IF name_val IS NOT NULL THEN
        NEW.account_name := name_val;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_abm_run_account_name_on_insert ON public.abm_runs;
CREATE TRIGGER trg_resolve_abm_run_account_name_on_insert
    BEFORE INSERT ON public.abm_runs
    FOR EACH ROW
    EXECUTE FUNCTION public.resolve_abm_run_account_name_on_insert();


-- ── 3. Recompute account_name for ALL rows with the tight regex ─────────────
-- Aggregates across every matching message per run, takes the first non-null
-- match (chronological). Both backfills missed NULLs AND clears false
-- positives (Henri Huynh, etc.) where the loose regex picked up a nested name.

UPDATE public.abm_runs r
SET account_name = sub.name_val
FROM (
    SELECT
      r2.id,
      (ARRAY_AGG(
          COALESCE(
            (regexp_match(m.content,
              '"type"\s*:\s*"Account".{0,200}"Id"\s*:\s*"' || r2.account_id || '[A-Za-z0-9]*"[^{}]*"Name"\s*:\s*"([^"]+)"',
              's'
            ))[1],
            (regexp_match(m.content,
              '\\"type\\"\s*:\s*\\"Account\\".{0,200}\\"Id\\"\s*:\s*\\"' || r2.account_id || '[A-Za-z0-9]*\\"[^{}]*\\"Name\\"\s*:\s*\\"([^"\\]+)\\"',
              's'
            ))[1]
          )
          ORDER BY m.created_at
      ) FILTER (WHERE
          (regexp_match(m.content,
            '"type"\s*:\s*"Account".{0,200}"Id"\s*:\s*"' || r2.account_id || '[A-Za-z0-9]*"[^{}]*"Name"\s*:\s*"([^"]+)"',
            's'
          )) IS NOT NULL
          OR
          (regexp_match(m.content,
            '\\"type\\"\s*:\s*\\"Account\\".{0,200}\\"Id\\"\s*:\s*\\"' || r2.account_id || '[A-Za-z0-9]*\\"[^{}]*\\"Name\\"\s*:\s*\\"([^"\\]+)\\"',
            's'
          )) IS NOT NULL
      ))[1] AS name_val
    FROM public.abm_runs r2
    LEFT JOIN public.chat_messages m
      ON m.chat_id = r2.chat_id
     AND m.role = 'assistant'
     AND m.content LIKE '%' || r2.account_id || '%'
    GROUP BY r2.id
) sub
WHERE r.id = sub.id
  AND r.account_name IS DISTINCT FROM sub.name_val;
