-- Backfill: every project gets a Phase 1 by default
-- =============================================================================
-- Pairs with 20260517000000_project_phases.sql. That migration created the
-- phases schema; this one ensures EVERY existing project has at least one
-- phase so the pipeline runner kicks in everywhere uniformly, instead of
-- some projects silently falling back to the legacy single-call path.
--
-- For each project that has zero phases:
--   - insert position=1 with name='Phase 1', enabled=true
--   - model_id = anthropic:claude-sonnet-4-6 (product default)
--   - system_prompt = COALESCE(projects.system_prompt, '')
--   - NULL out projects.system_prompt afterwards so the chat route doesn't
--     double-apply it (the runner skips the legacy field when phases exist,
--     but clearing it removes ambiguity and prevents future drift if anyone
--     edits the legacy column out of habit).
--
-- Sonnet 4.6 is seeded into ai_models defensively in case the row hasn't
-- been added yet; ON CONFLICT keeps the migration idempotent.
-- =============================================================================

-- 1. Ensure the default phase model exists in the model registry.
INSERT INTO public.ai_models (id, name, provider, is_available_to_all)
VALUES ('anthropic:claude-sonnet-4-6', 'Claude Sonnet 4.6', 'anthropic', true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    is_available_to_all = EXCLUDED.is_available_to_all,
    is_active = true;

-- 2. Backfill one Phase 1 per project that doesn't already have phases.
INSERT INTO public.project_phases (project_id, name, position, model_id, system_prompt, enabled)
SELECT
    p.id,
    'Phase 1',
    1,
    'anthropic:claude-sonnet-4-6',
    COALESCE(p.system_prompt, ''),
    true
FROM public.projects p
WHERE NOT EXISTS (
    SELECT 1 FROM public.project_phases pp WHERE pp.project_id = p.id
);

-- 3. Clear the legacy projects.system_prompt for any project where we just
-- seeded the prompt into Phase 1. We can't easily target "rows we just
-- inserted" but the safe equivalent is: any project that now has exactly one
-- phase at position 1 whose system_prompt matches the project's legacy
-- system_prompt. That uniquely identifies the rows backfilled in step 2.
UPDATE public.projects p
SET system_prompt = NULL
WHERE p.system_prompt IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM public.project_phases pp
      WHERE pp.project_id = p.id
        AND pp.position = 1
        AND pp.system_prompt = COALESCE(p.system_prompt, '')
  );
