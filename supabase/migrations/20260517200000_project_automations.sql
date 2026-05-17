-- Project Automations
-- =============================================================================
-- A project automation = a named batch of prompts that each get run through
-- the project's phase pipeline. Each task row becomes a real chat in the
-- project (so users can drill into the full conversation) and records
-- progress (which phase last finished, status, timing).
--
-- Two tables:
--   project_automations  — the batch container (name, description, scope)
--   automation_tasks     — the ordered rows (prompt, status, link to chat)
--
-- Execution model: run/stop API routes update status + last_phase_* fields
-- as phases complete. `stop_requested` is the cooperative cancel signal the
-- pipeline polls between phases.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.project_automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    name TEXT,
    description TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS project_automations_project_id_idx
    ON public.project_automations(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.automation_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id UUID NOT NULL REFERENCES public.project_automations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    -- Per-row toggle. 'Run all' (and per-row Run) skip disabled rows so the
    -- user can park half-finished prompts or temporarily exclude rows from
    -- the batch without deleting them.
    enabled BOOLEAN NOT NULL DEFAULT true,
    -- status values: pending | running | completed | failed | stopped
    status TEXT NOT NULL DEFAULT 'pending',
    chat_id UUID REFERENCES public.chats(id) ON DELETE SET NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    last_phase_index INTEGER,
    last_phase_total INTEGER,
    last_phase_name TEXT,
    error TEXT,
    -- Cooperative cancel flag. The pipeline runner polls this between phases
    -- and exits gracefully (status='stopped') when true.
    stop_requested BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (automation_id, position)
);

CREATE INDEX IF NOT EXISTS automation_tasks_automation_id_position_idx
    ON public.automation_tasks(automation_id, position);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_project_automations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS project_automations_set_updated_at ON public.project_automations;
CREATE TRIGGER project_automations_set_updated_at
    BEFORE UPDATE ON public.project_automations
    FOR EACH ROW EXECUTE FUNCTION public.touch_project_automations_updated_at();

CREATE OR REPLACE FUNCTION public.touch_automation_tasks_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = timezone('utc'::text, now()); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS automation_tasks_set_updated_at ON public.automation_tasks;
CREATE TRIGGER automation_tasks_set_updated_at
    BEFORE UPDATE ON public.automation_tasks
    FOR EACH ROW EXECUTE FUNCTION public.touch_automation_tasks_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.project_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_tasks    ENABLE ROW LEVEL SECURITY;

-- READ: anyone who can read the parent project. Same predicate as phases.
CREATE POLICY "Users can read automations of visible projects"
    ON public.project_automations FOR SELECT
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_automations.project_id)
    );

CREATE POLICY "Users can read automation tasks of visible projects"
    ON public.automation_tasks FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.project_automations a
            JOIN public.projects p ON p.id = a.project_id
            WHERE a.id = automation_tasks.automation_id
        )
    );

-- WRITE: owner / editor member / admin. Identical predicate everywhere.
CREATE OR REPLACE FUNCTION public.user_can_edit_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.owner_id = auth.uid())
     OR EXISTS (
            SELECT 1 FROM public.project_members m
            WHERE m.project_id = p_project_id AND m.user_id = auth.uid() AND m.role = 'editor'
        )
     OR EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid() AND pr.role IN ('admin', 'super_admin')
        );
$$;

CREATE POLICY "Project editors can write automations"
    ON public.project_automations FOR ALL
    TO authenticated
    USING (public.user_can_edit_project(project_automations.project_id))
    WITH CHECK (public.user_can_edit_project(project_automations.project_id));

CREATE POLICY "Project editors can write automation tasks"
    ON public.automation_tasks FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.project_automations a
            WHERE a.id = automation_tasks.automation_id
              AND public.user_can_edit_project(a.project_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.project_automations a
            WHERE a.id = automation_tasks.automation_id
              AND public.user_can_edit_project(a.project_id)
        )
    );
