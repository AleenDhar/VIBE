-- Flagged chats RPC for the Omnivision "jump to offenders" panel
-- =============================================================================
-- Returns every chat that had more than one ABM run inside the selected
-- window, with enough metadata (owner, project, account list, time range)
-- for a super-admin to audit and link directly to the chat.
--
-- Ordering: most runs first, then most recent activity — so the worst
-- offenders surface at the top of the panel.
--
-- IST-pinned like the other Omnivision RPCs so the window matches what
-- the dashboard displays.
--
-- Limit 500 to keep the response fast; 500 is far above any realistic
-- number of flagged chats for a single window (current all-time total
-- is 119).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_flagged_abm_chats(
    from_date DATE DEFAULT NULL,
    to_date   DATE DEFAULT NULL
)
RETURNS TABLE (
    chat_id           uuid,
    chat_title        text,
    project_id        uuid,
    project_name      text,
    owner_user_id     uuid,
    owner_username    text,
    owner_full_name   text,
    owner_role        text,
    runs              bigint,
    distinct_accounts bigint,
    account_ids       text[],
    first_run_at      timestamptz,
    last_run_at       timestamptz
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
    WITH filtered AS (
        SELECT r.chat_id, r.account_id, r.seq, r.started_at
        FROM public.abm_runs r
        WHERE (from_ts IS NULL OR r.started_at >= from_ts)
          AND (to_ts   IS NULL OR r.started_at <  to_ts)
    ),
    -- Aggregate per chat; keep only those with > 1 run (the "flagged" set).
    -- Column aliases avoid colliding with any RETURNS TABLE column name
    -- (the trap that bit us twice before).
    per_chat AS (
        SELECT
            f.chat_id                                            AS cid,
            COUNT(*)                                             AS rn,
            COUNT(DISTINCT f.account_id)                         AS da,
            array_agg(f.account_id ORDER BY f.seq)               AS accts,
            MIN(f.started_at)                                    AS first_at,
            MAX(f.started_at)                                    AS last_at
        FROM filtered f
        GROUP BY f.chat_id
        HAVING COUNT(*) > 1
    )
    SELECT
        pc.cid                             AS chat_id,
        c.title                            AS chat_title,
        c.project_id                       AS project_id,
        pr.name                            AS project_name,
        c.user_id                          AS owner_user_id,
        owner.username                     AS owner_username,
        owner.full_name                    AS owner_full_name,
        owner.role                         AS owner_role,
        pc.rn::bigint                      AS runs,
        pc.da::bigint                      AS distinct_accounts,
        pc.accts                           AS account_ids,
        pc.first_at                        AS first_run_at,
        pc.last_at                         AS last_run_at
    FROM per_chat pc
    JOIN public.chats c           ON c.id = pc.cid
    LEFT JOIN public.projects pr  ON pr.id = c.project_id
    LEFT JOIN public.profiles owner ON owner.id = c.user_id
    ORDER BY pc.rn DESC, pc.last_at DESC
    LIMIT 500;
END;
$$;
