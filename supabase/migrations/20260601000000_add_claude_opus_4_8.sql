-- Add Claude Opus 4.8 to ai_models table.
-- Restricted (is_available_to_all = false): only users whose
-- profiles.allowed_models includes this id can select it, matching the
-- access pattern of Opus 4.6 / 4.7. Grant per-user via Admin → Users.
INSERT INTO public.ai_models (id, name, provider, is_active, is_available_to_all)
VALUES
    ('anthropic:claude-opus-4-8', 'Claude Opus 4.8', 'anthropic', true, false)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    is_active = EXCLUDED.is_active,
    is_available_to_all = EXCLUDED.is_available_to_all;
