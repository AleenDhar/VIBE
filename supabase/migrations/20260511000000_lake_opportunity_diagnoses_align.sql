-- lake.opportunity_diagnoses — align column names to Replit backend writes
-- =============================================================================
-- The initial migration (20260508000000_lake_opportunity_diagnoses.sql) shipped
-- column names from the planning spec, but the Replit backend's
-- `_write_lake_diagnosis` code uses slightly different field names. This
-- migration renames + adds columns so PostgREST writes from the agent succeed
-- without partial NULLs.
--
-- Changes:
--   * avoma_meeting_count → meeting_count_30d   (semantic: count is 30-day window)
--   * last_meeting_at     → last_meeting_date   (kept timestamptz for precision)
--   * + last_meeting_id   text                  (new — identifies the meeting)
--   * + key_themes        jsonb                 (new — narrative field array)
--
-- forecast_category stays as-is; not in Replit's write set today, but harmless
-- (writes that don't include it leave NULL).
-- =============================================================================

ALTER TABLE lake.opportunity_diagnoses
    RENAME COLUMN avoma_meeting_count TO meeting_count_30d;

ALTER TABLE lake.opportunity_diagnoses
    RENAME COLUMN last_meeting_at TO last_meeting_date;

ALTER TABLE lake.opportunity_diagnoses
    ADD COLUMN IF NOT EXISTS last_meeting_id text;

ALTER TABLE lake.opportunity_diagnoses
    ADD COLUMN IF NOT EXISTS key_themes jsonb;
