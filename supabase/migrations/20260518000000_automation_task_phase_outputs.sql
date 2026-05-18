-- Add phase_outputs column to automation_tasks
-- =============================================================================
-- The automation runner now persists each phase's final text into a JSONB
-- array on the task so the automations detail page can render a column per
-- phase showing that phase's response. Without this column the runner only
-- has the text in memory and feeds it forward to the next phase as context
-- — there's nothing on the row for the UI to display.
--
-- Shape: phase_outputs = [
--   { phase_index, phase_name, phase_model_id, content, completed_at },
--   ...
-- ]
--
-- On each run the runner clears this array first, then appends one entry per
-- completed phase. Old entries from a prior run are overwritten — re-runs
-- replace prior results, matching the established behavior.
-- =============================================================================

ALTER TABLE public.automation_tasks
    ADD COLUMN IF NOT EXISTS phase_outputs JSONB NOT NULL DEFAULT '[]'::jsonb;
