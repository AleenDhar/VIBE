-- Fireworks AI models (super-admin-only sandbox)
--
-- These are surfaced ONLY to super_admins: in the chat model picker
-- (ChatInterface filters provider='fireworks' to role='super_admin') and in the
-- admin panel (ApiKeyList Fireworks key row + ModelManager full catalog are
-- super-admin gated). They are seeded is_available_to_all=false so no normal
-- user can ever select them.
--
-- Reachability on the current Fireworks account (verified 2026-06-22):
--   * gpt-oss-120b / gpt-oss-20b  -> 200 (active)
--   * kimi-k2 / deepseek-v3 / qwen3 -> 404 "not deployed" (seeded INACTIVE;
--     a super_admin flips Status -> Active from the admin panel once serverless
--     access is enabled on the account).
--
-- The backend (server.py) routes any "fireworks:" model through the Fireworks
-- OpenAI-compatible endpoint using FIREWORKS_API_KEY from its environment.

INSERT INTO public.ai_models (id, name, provider, is_available_to_all, is_active)
VALUES
    ('fireworks:accounts/fireworks/models/gpt-oss-120b', 'GPT-OSS 120B ⚡ Fireworks', 'fireworks', false, true),
    ('fireworks:accounts/fireworks/models/gpt-oss-20b',  'GPT-OSS 20B ⚡ Fireworks',  'fireworks', false, true),
    ('fireworks:accounts/fireworks/models/kimi-k2-instruct', 'Kimi K2 Instruct ⚡ Fireworks', 'fireworks', false, false),
    ('fireworks:accounts/fireworks/models/deepseek-v3',  'DeepSeek V3 ⚡ Fireworks',  'fireworks', false, false),
    ('fireworks:accounts/fireworks/models/qwen3-235b-a22b', 'Qwen3 235B ⚡ Fireworks', 'fireworks', false, false)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    provider = EXCLUDED.provider;
    -- NB: is_active / is_available_to_all are intentionally NOT overwritten on
    -- conflict so re-running this migration never clobbers an admin's toggles.

-- Empty placeholder so the Fireworks key row renders in the admin panel.
-- The real key is set via the admin UI (super_admin) or scripts/seed-fireworks-models.mjs;
-- never commit the key value here.
INSERT INTO public.app_config (key, value)
VALUES ('fireworks_api_key', '')
ON CONFLICT (key) DO NOTHING;
