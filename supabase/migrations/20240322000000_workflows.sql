-- =============================================
-- Workspaces Infrastructure
-- =============================================

CREATE TABLE public.workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_members (
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')) DEFAULT 'editor',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- RLS: Users can see workspaces they belong to
CREATE POLICY "Members can access their workspaces" ON public.workspaces
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members
            WHERE workspace_id = workspaces.id
            AND user_id = auth.uid()
        )
    );

-- RLS: Users can see membership rows for their workspaces
CREATE POLICY "Members can see workspace members" ON public.workspace_members
    FOR ALL USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_id = workspace_members.workspace_id
            AND wm.user_id = auth.uid()
        )
    );

-- Auto-create a default workspace when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user_workspace()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.workspaces (name, created_by)
    VALUES ('My Workspace', NEW.id)
    RETURNING id INTO NEW.id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (
        (SELECT id FROM public.workspaces WHERE created_by = NEW.id ORDER BY created_at DESC LIMIT 1),
        NEW.id,
        'owner'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: If you already have a trigger on auth.users for profile creation,
-- you may want to add workspace creation there instead.
-- This trigger creates a workspace for new signups:
CREATE OR REPLACE TRIGGER on_auth_user_created_workspace
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_workspace();

-- =============================================
-- Workflows
-- =============================================

CREATE TABLE public.workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    definition JSONB DEFAULT '{"edges": [], "nodes": []}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can access workflows" ON public.workflows
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members
            WHERE workspace_id = workflows.workspace_id
            AND user_id = auth.uid()
        )
    );

CREATE INDEX idx_workflows_workspace_id ON public.workflows(workspace_id);

-- =============================================
-- Workflow Executions
-- =============================================

CREATE TABLE public.workflow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    status TEXT CHECK (status IN ('running', 'completed', 'failed')),
    input JSONB,
    output JSONB,
    node_outputs JSONB DEFAULT '{}'::JSONB,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    finished_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.workflow_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can access executions" ON public.workflow_executions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.workspace_members
            WHERE workspace_id = workflow_executions.workspace_id
            AND user_id = auth.uid()
        )
    );

CREATE INDEX idx_workflow_executions_workflow_id ON public.workflow_executions(workflow_id);
CREATE INDEX idx_workflow_executions_status ON public.workflow_executions(status);
