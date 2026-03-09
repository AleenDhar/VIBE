-- AI Model Access Control Migration

-- 1. Create the new ai_models table
CREATE TABLE IF NOT EXISTS public.ai_models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    is_available_to_all BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;

-- Everyone can read active models
CREATE POLICY "Enable read access for all users on active models" 
ON public.ai_models FOR SELECT 
USING (is_active = true);

-- Only admins and super_admins can modify models
CREATE POLICY "Enable all access for admins on ai_models" 
ON public.ai_models FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND (profiles.role = 'admin' OR profiles.role = 'super_admin')
  )
);

-- 2. Add allowed_models to profiles if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'profiles' 
        AND column_name = 'allowed_models'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN allowed_models TEXT[] DEFAULT '{}';
    END IF;
END $$;

-- 3. Seed initial models
INSERT INTO public.ai_models (id, name, provider, is_available_to_all)
VALUES 
    ('anthropic:claude-haiku-4-5', 'Claude 3.5 Haiku', 'anthropic', true),
    ('openai:gpt-4o', 'GPT-4o', 'openai', false),
    ('google:gemini-1.5-pro', 'Gemini 1.5 Pro', 'google', false),
    ('anthropic:claude-3-5-sonnet', 'Claude 3.5 Sonnet', 'anthropic', false)
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    provider = EXCLUDED.provider,
    is_available_to_all = EXCLUDED.is_available_to_all;

-- 4. Grandfathering script: Give existing users access to the currently restricted models
-- Any user created before this migration runs gets access to the current restricted models.
-- We'll assume GPT-4o, Gemini 1.5 Pro, and Claude 3.5 Sonnet are the restricted ones.
UPDATE public.profiles
SET allowed_models = ARRAY['openai:gpt-4o', 'google:gemini-1.5-pro', 'anthropic:claude-3-5-sonnet'];

-- 5. Create function to get all active models (bypasses RLS for testing/server if needed)
CREATE OR REPLACE FUNCTION get_active_models()
RETURNS SETOF public.ai_models
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.ai_models WHERE is_active = true ORDER BY name ASC;
$$;

-- 6. Create function to check if a user can access a model
CREATE OR REPLACE FUNCTION can_user_access_model(user_id UUID, model_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_available_to_all BOOLEAN;
  v_user_role TEXT;
  v_allowed_models TEXT[];
BEGIN
  -- Check if model is available to all
  SELECT is_available_to_all INTO v_is_available_to_all
  FROM public.ai_models
  WHERE id = model_id AND is_active = true;

  IF v_is_available_to_all = true THEN
    RETURN true;
  END IF;

  -- Get user details
  SELECT role, allowed_models INTO v_user_role, v_allowed_models
  FROM public.profiles
  WHERE id = user_id;

  -- Super admins have access to everything
  IF v_user_role = 'super_admin' THEN
    RETURN true;
  END IF;

  -- Check if explicitly allowed
  IF v_allowed_models @> ARRAY[model_id] THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;
