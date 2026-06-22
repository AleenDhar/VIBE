-- Cross-task stop signal for the agent backend.
--
-- The deepagent backend (server.py) runs multiple load-balanced ECS tasks. Its
-- in-memory cancel (_running_tasks / _cancelled_chats) only covers ONE process,
-- so POST /api/chat/stop can land on a different task than the one running the
-- agent ("No running agent task found") and the run never stops.
--
-- This flag is the shared signal: /api/chat/stop sets stop_requested=true; the
-- running agent polls chats.stop_requested every few seconds and cancels itself
-- wherever it lives; the flag is cleared at the next run start so it can't carry
-- over and cancel a future run.
--
-- Additive + safe: a constant default means Postgres does NOT rewrite the table.
ALTER TABLE public.chats
    ADD COLUMN IF NOT EXISTS stop_requested boolean NOT NULL DEFAULT false;
