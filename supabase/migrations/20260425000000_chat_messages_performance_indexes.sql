-- Omnivision "Today" filter was timing out because chat_messages had
-- no index on chat_id or created_at. Every Omnivision RPC filter of
-- the form `EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.chat_id = c.id
-- AND cm.created_at BETWEEN … AND …)` triggered a full seq scan of the
-- 808K-row table per chat (~8,900 chats) → 7 billion row checks → 30s+
-- and the Postgres statement_timeout cancelled it. The Supabase JS
-- client got the cancellation as a generic error, the server action
-- caught it and returned [], and the UI rendered "0 users / 0 chats".
--
-- With these indexes the same RPC drops from 30s+ to ~700ms: the
-- planner uses idx_chat_messages_created_at to scan only the in-window
-- slice, aggregates by chat_id to the small set of active chats, then
-- hash-joins to the chats table.

-- Composite (chat_id, created_at): serves both the EXISTS lookups
-- (join on chat_id) and the time-range predicate (secondary key). Also
-- enough for the ingest trigger's single-row lookup per message.
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id_created_at
    ON public.chat_messages (chat_id, created_at);

-- Plain (created_at): supports queries that filter by time window only
-- (e.g. "all messages today" analytics, orphan-chat sweeps, usage
-- attribution jobs) without needing to pivot through chat_id first.
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
    ON public.chat_messages (created_at);
