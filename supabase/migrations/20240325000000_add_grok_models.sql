-- Add Grok (xAI) models to ai_models table
INSERT INTO public.ai_models (id, name, provider, is_available_to_all)
VALUES
    ('grok:grok-3', 'Grok 3', 'grok', true),
    ('grok:grok-3-mini', 'Grok 3 Mini', 'grok', true),
    ('grok:grok-4-0709', 'Grok 4', 'grok', true),
    ('grok:grok-4-fast-non-reasoning', 'Grok 4 Fast', 'grok', true),
    ('grok:grok-4-fast-reasoning', 'Grok 4 Fast Reasoning', 'grok', true),
    ('grok:grok-4-1-fast-non-reasoning', 'Grok 4.1 Fast', 'grok', true),
    ('grok:grok-4-1-fast-reasoning', 'Grok 4.1 Fast Reasoning', 'grok', true),
    ('grok:grok-4.20-beta-0309-non-reasoning', 'Grok 4.2 Beta', 'grok', true),
    ('grok:grok-4.20-beta-0309-reasoning', 'Grok 4.2 Beta Reasoning', 'grok', true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    is_available_to_all = EXCLUDED.is_available_to_all;
