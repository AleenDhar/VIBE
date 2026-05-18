-- Automation prompt template + per-task variables
-- =============================================================================
-- Adds a reusable prompt template to project_automations and a JSONB variable
-- bag to automation_tasks. Together they power CSV upload: the automation
-- owner writes a template like
--     "Run ABM diagnosis for Salesforce account {{account_id}}, campaign
--      {{campaign_id}}, owned by BDR {{bdr_id}}."
-- and each CSV row becomes a task whose `prompt` is the rendered template
-- and whose `variables` hold the row's structured field values.
--
-- Rendering happens at insert time (in the bulk-create server action), so the
-- pipeline runner stays untouched — it still reads `prompt` as the user's
-- first chat message.
-- =============================================================================

ALTER TABLE public.project_automations
    ADD COLUMN IF NOT EXISTS prompt_template TEXT;

ALTER TABLE public.automation_tasks
    ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '{}'::jsonb;
