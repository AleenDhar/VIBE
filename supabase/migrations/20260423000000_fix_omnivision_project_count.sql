-- Omnivision project_count fix
-- =============================================================================
-- The previous version of `get_omnivision_user_aggregates` (and the version
-- before that, in 20240321000000_omnivision_aggregates.sql) computed
-- project_count via:
--
--     LEFT JOIN public.projects proj ON proj.owner_id = p.id
--
-- This counts projects the user OWNS, not projects they've used. Regular
-- users never own projects (admins create them), so 55 of 64 active users
-- in the 2026-04-01..04-20 window were showing "0 projects" in Omnivision
-- even though they were working inside 2–5 projects each.
--
-- This migration replaces the function so project_count now means:
--     "distinct projects this user has chats under, where those chats had
--      at least one message inside the selected date window."
--
-- That aligns project_count with the window-activity semantics of
-- chat_count — the same user who had 30 active chats across 3 projects in
-- the window will now show "30 chats · 3 projects", matching intuition.
--
-- The owner-of-projects data is still available via other admin queries if
-- needed; it just no longer powers this dashboard column.
-- =============================================================================

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

    from_ts := CASE WHEN from_date IS NULL THEN NULL
                    ELSE (from_date::timestamp AT TIME ZONE biz_tz) END;
    to_ts   := CASE WHEN to_date IS NULL THEN NULL
                    ELSE ((to_date + 1)::timestamp AT TIME ZONE biz_tz) END;

    RETURN QUERY
    WITH active_chats AS (
        -- Carry project_id through so project_count can count distinct
        -- projects the user actually *used* in the window.
        SELECT c.id, c.user_id, c.project_id
        FROM public.chats c
        WHERE EXISTS (
            SELECT 1 FROM public.chat_messages cm
            WHERE cm.chat_id = c.id
              AND (from_ts IS NULL OR cm.created_at >= from_ts)
              AND (to_ts   IS NULL OR cm.created_at <  to_ts)
        )
    )
    -- One row per profile so users with zero activity still render.
    -- COUNT(DISTINCT …) excludes NULLs by default, which naturally drops
    -- direct (non-project) chats from the project_count.
    SELECT
        p.id                                 AS user_id,
        p.username,
        p.full_name,
        p.avatar_url,
        p.role,
        COUNT(DISTINCT ac.id)::bigint        AS chat_count,
        COUNT(DISTINCT ac.project_id)::bigint AS project_count
    FROM public.profiles p
    LEFT JOIN active_chats ac ON ac.user_id = p.id
    GROUP BY p.id, p.username, p.full_name, p.avatar_url, p.role

    UNION ALL

    -- Synthetic orphan bucket: chats with user_id IS NULL that had
    -- activity in the window. Its project_count mirrors the new semantics.
    SELECT
        '00000000-0000-0000-0000-000000000000'::uuid,
        '(unattributed)'::text,
        'Unattributed chats'::text,
        NULL::text,
        'unknown'::text,
        COUNT(*)::bigint,
        COUNT(DISTINCT ac.project_id)::bigint
    FROM active_chats ac
    -- Qualify `user_id` with the `ac` alias: without it, Postgres sees the
    -- RETURNS TABLE column `user_id` and the CTE's `user_id` as equally
    -- valid references and raises `column reference "user_id" is ambiguous`.
    WHERE ac.user_id IS NULL
    HAVING COUNT(*) > 0;
END;
$$;
