-- =============================================
-- Workflow Scheduling Support
-- =============================================

-- Add scheduling columns to workflows table
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS schedule_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS schedule_cron TEXT;
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS schedule_input TEXT;
ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS schedule_timezone TEXT DEFAULT 'UTC';

-- Add triggered_by to execution records so we know if manual or scheduled
ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS triggered_by TEXT DEFAULT 'manual'
    CHECK (triggered_by IN ('manual', 'schedule', 'api'));
