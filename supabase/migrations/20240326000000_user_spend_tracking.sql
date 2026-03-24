-- =============================================================================
-- Add daily spend cap to profiles and create spend tracking table
-- =============================================================================

-- 1. Add daily_spend_cap column to profiles (nullable = no cap)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_spend_cap numeric DEFAULT NULL;

-- 2. Create user_daily_spend table for tracking daily consumption
CREATE TABLE IF NOT EXISTS public.user_daily_spend (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  spend_date  date        NOT NULL,
  total_cost  numeric     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_daily_spend_pkey PRIMARY KEY (id),
  CONSTRAINT user_daily_spend_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles (id) ON DELETE CASCADE,
  CONSTRAINT user_daily_spend_unique UNIQUE (user_id, spend_date)
);

ALTER TABLE public.user_daily_spend ENABLE ROW LEVEL SECURITY;

-- RLS policies: admins can read all, users can read their own
CREATE POLICY "Admins can read all daily spend"
  ON public.user_daily_spend FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Users can read own daily spend"
  ON public.user_daily_spend FOR SELECT
  USING (user_id = auth.uid());

-- Service role / server-side can insert/update (via supabase service client)
CREATE POLICY "Service can insert daily spend"
  ON public.user_daily_spend FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service can update daily spend"
  ON public.user_daily_spend FOR UPDATE
  USING (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_daily_spend_user_date
  ON public.user_daily_spend (user_id, spend_date DESC);

-- 3. Set the global daily credit default to $50
INSERT INTO public.app_config (key, value, updated_at)
VALUES ('default_daily_credit', '50', now())
ON CONFLICT (key) DO UPDATE SET value = '50', updated_at = now();
