-- Omnivision count fix
-- ================================================================
-- Fixes three bugs in `get_omnivision_user_aggregates` and introduces
-- a companion RPC for the drill-down chat list so both views agree:
--
--   Bug 1 (empty-chat hiding): the old RPC kept `EXISTS chat_messages`
--     for chat rows, but still filtered by `chats.created_at`. Shell
--     rows inserted by the UI at "New Chat" time vanished from the
--     count even when the user intended them to exist.
--
--   Bug 2 (activity-vs-creation drift): filtering by `chats.created_at`
--     misses chats that were *used* in the window but created earlier.
--     The new RPC switches to message-activity: a chat is counted when
--     any of its `chat_messages` landed inside the window.
--
--   Bug 3 (timezone drift): the old RPC took `timestamptz` bounds the
--     browser computed in *its* local timezone, so the same label
--     ("2026-04-01 → 2026-04-20") returned different totals to an IST
--     admin vs a UTC admin. The new RPC takes plain `date` params and
--     pins boundaries to Asia/Kolkata server-side.
--
--   Bug 4 (orphan chats dropped from totals): chats with `user_id IS
--     NULL` were silently excluded by the `profiles LEFT JOIN chats
--     ON user_id` join shape. The new RPC emits a synthetic
--     "(unattributed)" row so header totals reflect reality.
-- ================================================================

-- Drop the old signature first; Postgres treats (timestamptz, timestamptz)
-- and (date, date) as distinct functions, and we want exactly one.
DROP FUNCTION IF EXISTS public.get_omnivision_user_aggregates(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.get_omnivision_user_aggregates(
    from_date DATE DEFAULT NULL,
    to_date   DATE DEFAULT NULL
)
RETURNS TABLE (
    user_id uuid,
    username text,
    full_name text,
    avatar_url text,
    role text,
    chat_count bigint,
    project_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    biz_tz  CONSTANT text := 'Asia/Kolkata';
    from_ts timestamptz;
    to_ts   timestamptz;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Pin the window to IST day boundaries. Inclusive on `from_date`,
    -- exclusive on `(to_date + 1)` so the full `to_date` day is included.
    from_ts := CASE WHEN from_date IS NULL THEN NULL
                    ELSE (from_date::timestamp AT TIME ZONE biz_tz) END;
    to_ts   := CASE WHEN to_date IS NULL THEN NULL
                    ELSE ((to_date + 1)::timestamp AT TIME ZONE biz_tz) END;

    RETURN QUERY
    WITH active_chats AS (
        -- A chat is "active in window" iff at least one of its messages
        -- landed inside the window. Chat creation date is irrelevant.
        SELECT c.id, c.user_id
        FROM public.chats c
        WHERE EXISTS (
            SELECT 1 FROM public.chat_messages cm
            WHERE cm.chat_id = c.id
              AND (from_ts IS NULL OR cm.created_at >= from_ts)
              AND (to_ts   IS NULL OR cm.created_at <  to_ts)
        )
    )
    -- One row per profile so users with 0 activity still render.
    SELECT
        p.id                                  AS user_id,
        p.username,
        p.full_name,
        p.avatar_url,
        p.role,
        COUNT(DISTINCT ac.id)::bigint         AS chat_count,
        COUNT(DISTINCT proj.id)::bigint       AS project_count
    FROM public.profiles p
    LEFT JOIN active_chats ac  ON ac.user_id   = p.id
    LEFT JOIN public.projects proj ON proj.owner_id = p.id
    GROUP BY p.id, p.username, p.full_name, p.avatar_url, p.role

    UNION ALL

    -- Synthetic "(unattributed)" row for chats whose user_id is NULL.
    -- Emitted only when there are any, so the dashboard shows it as
    -- a first-class entry instead of them silently vanishing from
    -- totals. Uses a zero UUID so the TS layer can special-case it.
    SELECT
        '00000000-0000-0000-0000-000000000000'::uuid AS user_id,
        '(unattributed)'::text                        AS username,
        'Unattributed chats'::text                    AS full_name,
        NULL::text                                    AS avatar_url,
        'unknown'::text                               AS role,
        COUNT(*)::bigint                              AS chat_count,
        0::bigint                                     AS project_count
    FROM active_chats ac
    WHERE ac.user_id IS NULL
    HAVING COUNT(*) > 0;
END;
$$;


-- Drill-down list for a specific user, matching the aggregate's semantics.
-- Replaces the `.from("chats").select().gte/lte("created_at", ...)` path
-- in lib/actions/admin.ts which suffered from the same timezone and
-- creation-vs-activity bugs as the aggregate.
--
-- Special case: when target_user_id is the zero UUID, return chats with
-- user_id IS NULL (the orphan bucket surfaced by the aggregate).
CREATE OR REPLACE FUNCTION public.get_omnivision_chats_for_user(
    target_user_id UUID,
    from_date      DATE DEFAULT NULL,
    to_date        DATE DEFAULT NULL
)
RETURNS TABLE (
    id         uuid,
    title      text,
    created_at timestamptz,
    updated_at timestamptz,
    project_id uuid,
    user_id    uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    biz_tz  CONSTANT text := 'Asia/Kolkata';
    from_ts timestamptz;
    to_ts   timestamptz;
    orphan_sentinel CONSTANT uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    from_ts := CASE WHEN from_date IS NULL THEN NULL
                    ELSE (from_date::timestamp AT TIME ZONE biz_tz) END;
    to_ts   := CASE WHEN to_date IS NULL THEN NULL
                    ELSE ((to_date + 1)::timestamp AT TIME ZONE biz_tz) END;

    RETURN QUERY
    SELECT c.id, c.title, c.created_at, c.updated_at, c.project_id, c.user_id
    FROM public.chats c
    WHERE CASE
            WHEN target_user_id = orphan_sentinel THEN c.user_id IS NULL
            ELSE c.user_id = target_user_id
          END
      AND EXISTS (
            SELECT 1 FROM public.chat_messages cm
            WHERE cm.chat_id = c.id
              AND (from_ts IS NULL OR cm.created_at >= from_ts)
              AND (to_ts   IS NULL OR cm.created_at <  to_ts)
          )
    ORDER BY c.created_at DESC
    LIMIT 1000;
END;
$$;
