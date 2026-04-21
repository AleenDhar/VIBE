-- Add Claude Opus 4.7 to ai_models table
INSERT INTO public.ai_models (id, name, provider, is_available_to_all)
VALUES
    ('anthropic:claude-opus-4-7', 'Claude Opus 4.7', 'anthropic', true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    is_available_to_all = EXCLUDED.is_available_to_all;
