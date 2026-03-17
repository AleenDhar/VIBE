-- Migration: Add global message search for Omnivision super admins
-- Allows searching across all chat_messages.content via ILIKE

CREATE OR REPLACE FUNCTION search_omnivision_messages(
    query_text TEXT,
    result_limit INT DEFAULT 50
)
RETURNS TABLE (
    message_id      UUID,
    chat_id         UUID,
    role            TEXT,
    content         TEXT,
    type            TEXT,
    created_at      TIMESTAMPTZ,
    chat_title      TEXT,
    project_id      UUID,
    user_id         UUID,
    username        TEXT,
    full_name       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    caller_role TEXT;
BEGIN
    -- Only super_admin can call this
    SELECT p.role INTO caller_role
    FROM profiles p
    WHERE p.id = auth.uid();

    IF caller_role IS DISTINCT FROM 'super_admin' THEN
        RAISE EXCEPTION 'Unauthorized: super_admin only';
    END IF;

    RETURN QUERY
    SELECT
        cm.id          AS message_id,
        cm.chat_id     AS chat_id,
        cm.role        AS role,
        cm.content     AS content,
        cm.type        AS type,
        cm.created_at  AS created_at,
        c.title        AS chat_title,
        c.project_id   AS project_id,
        c.user_id      AS user_id,
        pr.username    AS username,
        pr.full_name   AS full_name
    FROM chat_messages cm
    JOIN chats c       ON c.id  = cm.chat_id
    JOIN profiles pr   ON pr.id = c.user_id
    WHERE cm.content ILIKE '%' || query_text || '%'
      AND cm.type = 'message'
    ORDER BY cm.created_at DESC
    LIMIT result_limit;
END;
$$;
