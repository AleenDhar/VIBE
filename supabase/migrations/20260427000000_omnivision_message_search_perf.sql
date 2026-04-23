-- Omnivision message search: trigram index + widened type filter
-- =============================================================================
-- Why this exists
-- ---------------
-- The message search box in Omnivision was returning "No messages found" for
-- Salesforce account IDs that genuinely exist in chat_messages content
-- (verified against raw SELECTs). Root cause was twofold:
--
--   1. chat_messages.content had no index that could accelerate
--      ILIKE '%…%'. The search_omnivision_messages RPC triggered a full
--      sequential scan of all 808K rows, which took ~10 seconds locally
--      and hit Supabase's PostgREST statement timeout (~3-8s) in the
--      deployed app. The TS catch block treated the cancellation as a
--      generic error and returned [], so the UI rendered the empty state.
--
--   2. Even without the timeout, the RPC filtered to `cm.type = 'message'`
--      — user-typed messages only. For an account ID like 001P700000aKh2Y
--      that appears in 10 rows across 3 chats, this filter hides 8 of them
--      (5 tool_result, 3 final), surfacing only 2 user messages. Super-
--      admins auditing "every trace of account X in the system" were
--      seeing a fraction of the real footprint.
--
-- Fix: trigram GIN index + broadened type whitelist.
-- =============================================================================

-- pg_trgm is shipped with Supabase; this is idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on chat_messages.content. With this in place the
-- planner can answer ILIKE '%foo%' by looking up the trigrams of 'foo'
-- against pre-computed trigrams of each row's content — sub-second
-- instead of ~10s on 808K rows. Index size is ~a few hundred MB; one-
-- time cost for durable search responsiveness.
CREATE INDEX IF NOT EXISTS idx_chat_messages_content_trgm
    ON public.chat_messages
    USING GIN (content gin_trgm_ops);

-- Replace the RPC with a broader type filter. Returns rows where the
-- query text appears in user messages, final assistant responses, or
-- tool results — the three places audit evidence actually lives. The
-- `tool_call` type is excluded because its content is just the JSON
-- arguments to the tool invocation, which is already visible in the
-- subsequent tool_result row and would double-count.
CREATE OR REPLACE FUNCTION public.search_omnivision_messages(
    query_text   text,
    result_limit integer DEFAULT 50
)
RETURNS TABLE(
    message_id uuid,
    chat_id    uuid,
    role       text,
    content    text,
    type       text,
    created_at timestamp with time zone,
    chat_title text,
    project_id uuid,
    user_id    uuid,
    username   text,
    full_name  text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    caller_role TEXT;
BEGIN
    SELECT p.role INTO caller_role
    FROM public.profiles p
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
    FROM public.chat_messages cm
    JOIN public.chats        c  ON c.id  = cm.chat_id
    -- LEFT JOIN so orphan chats (user_id IS NULL) still surface — they
    -- may hold the only reference to an account the admin is searching
    -- for, and previously the INNER JOIN dropped them.
    LEFT JOIN public.profiles pr ON pr.id = c.user_id
    WHERE cm.content ILIKE '%' || query_text || '%'
      AND cm.type IN ('message', 'final', 'tool_result')
    ORDER BY cm.created_at DESC
    LIMIT result_limit;
END;
$$;
