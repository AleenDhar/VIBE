-- Project Phases
-- =============================================================================
-- Per-project ordered pipeline of (model, system_prompt, enabled) stages.
-- When a user sends a message in a chat that belongs to a project with at
-- least one enabled phase, /api/chat runs each enabled phase sequentially:
-- phase N receives the full running chat history (including phase 1..N-1
-- outputs as assistant turns) plus its own system_prompt, and emits an
-- assistant turn the next phase will consume.
--
-- Disabled phases are skipped without affecting numbering. Position is the
-- ordering key (1-based); deletes leave gaps that get compacted by the
-- reorder server action rather than via a trigger.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.project_phases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    name TEXT,
    position INTEGER NOT NULL,
    -- model_id is nullable so a phase can be created before a model is picked;
    -- /api/chat refuses to run a phase whose model_id is null.
    model_id TEXT REFERENCES public.ai_models(id) ON DELETE SET NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (project_id, position)
);

CREATE INDEX IF NOT EXISTS project_phases_project_id_position_idx
    ON public.project_phases(project_id, position);

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_project_phases_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_phases_set_updated_at ON public.project_phases;
CREATE TRIGGER project_phases_set_updated_at
    BEFORE UPDATE ON public.project_phases
    FOR EACH ROW EXECUTE FUNCTION public.touch_project_phases_updated_at();

ALTER TABLE public.project_phases ENABLE ROW LEVEL SECURITY;

-- READ: anyone who can read the parent project can read its phases.
-- Public projects are readable by all authenticated users; private projects
-- are readable by owner, project_members rows, and admins. We delegate the
-- visibility check to a project SELECT existence test rather than re-encoding
-- the rules here.
CREATE POLICY "Users can read phases of visible projects"
    ON public.project_phases FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_phases.project_id
        )
    );

-- WRITE (INSERT/UPDATE/DELETE): owner, editor members, or admin/super_admin.
-- Mirrors the canEdit logic in app/(platform)/projects/[id]/page.tsx so the
-- UI and DB agree on who can mutate.
CREATE POLICY "Project editors can insert phases"
    ON public.project_phases FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_phases.project_id
              AND p.owner_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.project_members m
            WHERE m.project_id = project_phases.project_id
              AND m.user_id = auth.uid()
              AND m.role = 'editor'
        )
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'super_admin')
        )
    );

CREATE POLICY "Project editors can update phases"
    ON public.project_phases FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_phases.project_id
              AND p.owner_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.project_members m
            WHERE m.project_id = project_phases.project_id
              AND m.user_id = auth.uid()
              AND m.role = 'editor'
        )
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'super_admin')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_phases.project_id
              AND p.owner_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.project_members m
            WHERE m.project_id = project_phases.project_id
              AND m.user_id = auth.uid()
              AND m.role = 'editor'
        )
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'super_admin')
        )
    );

CREATE POLICY "Project editors can delete phases"
    ON public.project_phases FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_phases.project_id
              AND p.owner_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.project_members m
            WHERE m.project_id = project_phases.project_id
              AND m.user_id = auth.uid()
              AND m.role = 'editor'
        )
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'super_admin')
        )
    );
