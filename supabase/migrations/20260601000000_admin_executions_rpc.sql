-- Admin Executions Dashboard — RPC functions
-- =============================================================================
-- Two SECURITY DEFINER functions that bypass RLS so admins can see all
-- executions across every user. Follows the pattern established by
-- get_omnivision_user_aggregates and get_all_projects_for_admin.
--
-- get_admin_executions       — paginated list unioning chats, automation_tasks,
--                              and workflow_executions
-- get_admin_execution_stats  — summary counts (total / running / completed / failed)
-- =============================================================================

-- ── Helper: derive chat "status" from last message recency ──────────────
-- If the most recent message in a chat landed < 2 minutes ago we consider
-- the execution "running"; otherwise "completed".

CREATE OR REPLACE FUNCTION public.get_admin_executions(
    p_from_date  DATE     DEFAULT NULL,
    p_to_date    DATE     DEFAULT NULL,
    p_status     TEXT     DEFAULT NULL,
    p_type       TEXT     DEFAULT NULL,   -- 'chat' | 'automation' | 'workflow'
    p_user_id    UUID     DEFAULT NULL,
    p_limit      INTEGER  DEFAULT 50,
    p_offset     INTEGER  DEFAULT 0
)
RETURNS TABLE (
    execution_id    UUID,
    execution_type  TEXT,
    title           TEXT,
    status          TEXT,
    user_id         UUID,
    user_name       TEXT,
    project_id      UUID,
    project_name    TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    extra_metadata  JSONB,
    total_rows      BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_from TIMESTAMPTZ;
    v_to   TIMESTAMPTZ;
BEGIN
    -- Convert date boundaries to IST (Asia/Kolkata) 4 AM boundaries,
    -- matching the spend-tracking convention used elsewhere.
    IF p_from_date IS NOT NULL THEN
        v_from := (p_from_date::TIMESTAMP AT TIME ZONE 'Asia/Kolkata') + INTERVAL '4 hours';
    END IF;
    IF p_to_date IS NOT NULL THEN
        v_to := ((p_to_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Kolkata') + INTERVAL '4 hours';
    END IF;

    RETURN QUERY
    WITH unified AS (
        -- ── A. Manual chats ───────────────────────────────────────────
        SELECT
            c.id                                     AS execution_id,
            'chat'::TEXT                              AS execution_type,
            COALESCE(c.title, 'New Chat')             AS title,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM public.chat_messages cm
                    WHERE cm.chat_id = c.id
                      AND cm.created_at > NOW() - INTERVAL '2 minutes'
                ) THEN 'running'
                ELSE 'completed'
            END                                       AS status,
            c.user_id                                 AS user_id,
            COALESCE(pr.full_name, pr.username, '')   AS user_name,
            c.project_id                              AS project_id,
            pj.name                                   AS project_name,
            c.created_at                              AS started_at,
            c.updated_at                              AS completed_at,
            NULL::TEXT                                 AS error_message,
            jsonb_build_object(
                'message_count', (
                    SELECT COUNT(*) FROM public.chat_messages cm
                    WHERE cm.chat_id = c.id
                )
            )                                         AS extra_metadata
        FROM public.chats c
        LEFT JOIN public.profiles pr ON pr.id = c.user_id
        LEFT JOIN public.projects pj ON pj.id = c.project_id
        -- Exclude chats that are automation-generated (title starts with zero-width space)
        WHERE (c.title IS NULL OR LEFT(c.title, 1) <> E'\u200B')
          -- Exclude chats that are linked from an automation_task
          AND NOT EXISTS (
              SELECT 1 FROM public.automation_tasks at2
              WHERE at2.chat_id = c.id
          )

        UNION ALL

        -- ── B. Automation tasks ───────────────────────────────────────
        SELECT
            at.id                                     AS execution_id,
            'automation'::TEXT                         AS execution_type,
            COALESCE(
                pa.name || ' #' || at.position,
                'Task #' || at.position
            )                                         AS title,
            at.status                                 AS status,
            pa.created_by                             AS user_id,
            COALESCE(pr.full_name, pr.username, '')   AS user_name,
            pa.project_id                             AS project_id,
            pj.name                                   AS project_name,
            COALESCE(at.started_at, at.created_at)    AS started_at,
            at.completed_at                           AS completed_at,
            at.error                                  AS error_message,
            jsonb_build_object(
                'prompt', LEFT(at.prompt, 200),
                'phase_name', at.last_phase_name,
                'phase_index', at.last_phase_index,
                'phase_total', at.last_phase_total,
                'automation_name', pa.name
            )                                         AS extra_metadata
        FROM public.automation_tasks at
        JOIN public.project_automations pa ON pa.id = at.automation_id
        LEFT JOIN public.profiles pr ON pr.id = pa.created_by
        LEFT JOIN public.projects pj ON pj.id = pa.project_id

        UNION ALL

        -- ── C. Workflow executions ────────────────────────────────────
        SELECT
            we.id                                     AS execution_id,
            'workflow'::TEXT                            AS execution_type,
            COALESCE(w.name, 'Workflow Run')           AS title,
            we.status                                  AS status,
            ws.created_by                              AS user_id,
            COALESCE(pr.full_name, pr.username, '')    AS user_name,
            NULL::UUID                                 AS project_id,
            NULL::TEXT                                  AS project_name,
            we.created_at                              AS started_at,
            we.finished_at                             AS completed_at,
            we.error                                   AS error_message,
            jsonb_build_object(
                'workflow_name', w.name,
                'workflow_id', w.id,
                'workspace_name', ws.name
            )                                          AS extra_metadata
        FROM public.workflow_executions we
        LEFT JOIN public.workflows w ON w.id = we.workflow_id
        LEFT JOIN public.workspaces ws ON ws.id = we.workspace_id
        LEFT JOIN public.profiles pr ON pr.id = ws.created_by
    )
    SELECT
        u.execution_id,
        u.execution_type,
        u.title,
        u.status,
        u.user_id,
        u.user_name,
        u.project_id,
        u.project_name,
        u.started_at,
        u.completed_at,
        u.error_message,
        u.extra_metadata,
        COUNT(*) OVER()  AS total_rows
    FROM unified u
    WHERE
        (p_from_date IS NULL OR u.started_at >= v_from)
        AND (p_to_date IS NULL OR u.started_at < v_to)
        AND (p_status IS NULL OR u.status = p_status)
        AND (p_type IS NULL OR u.execution_type = p_type)
        AND (p_user_id IS NULL OR u.user_id = p_user_id)
    ORDER BY u.started_at DESC NULLS LAST
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;


-- ── Summary stats ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_admin_execution_stats(
    p_from_date  DATE DEFAULT NULL,
    p_to_date    DATE DEFAULT NULL
)
RETURNS TABLE (
    total_count      BIGINT,
    running_count    BIGINT,
    completed_count  BIGINT,
    failed_count     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_from TIMESTAMPTZ;
    v_to   TIMESTAMPTZ;
BEGIN
    IF p_from_date IS NOT NULL THEN
        v_from := (p_from_date::TIMESTAMP AT TIME ZONE 'Asia/Kolkata') + INTERVAL '4 hours';
    END IF;
    IF p_to_date IS NOT NULL THEN
        v_to := ((p_to_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Kolkata') + INTERVAL '4 hours';
    END IF;

    RETURN QUERY
    WITH unified AS (
        -- Chats
        SELECT
            c.id AS eid,
            CASE
                WHEN EXISTS (
                    SELECT 1 FROM public.chat_messages cm
                    WHERE cm.chat_id = c.id
                      AND cm.created_at > NOW() - INTERVAL '2 minutes'
                ) THEN 'running'
                ELSE 'completed'
            END AS status,
            c.created_at AS started_at
        FROM public.chats c
        WHERE (c.title IS NULL OR LEFT(c.title, 1) <> E'\u200B')
          AND NOT EXISTS (
              SELECT 1 FROM public.automation_tasks at2
              WHERE at2.chat_id = c.id
          )

        UNION ALL

        -- Automation tasks
        SELECT
            at.id AS eid,
            at.status,
            COALESCE(at.started_at, at.created_at) AS started_at
        FROM public.automation_tasks at

        UNION ALL

        -- Workflow executions
        SELECT
            we.id AS eid,
            we.status,
            we.created_at AS started_at
        FROM public.workflow_executions we
    )
    SELECT
        COUNT(*)                                        AS total_count,
        COUNT(*) FILTER (WHERE u.status = 'running')   AS running_count,
        COUNT(*) FILTER (WHERE u.status = 'completed') AS completed_count,
        COUNT(*) FILTER (WHERE u.status = 'failed')    AS failed_count
    FROM unified u
    WHERE
        (p_from_date IS NULL OR u.started_at >= v_from)
        AND (p_to_date IS NULL OR u.started_at < v_to);
END;
$$;
