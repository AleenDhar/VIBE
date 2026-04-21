-- Project tagging system
-- tags: global reusable labels. project_tags: many-to-many link to projects.

CREATE TABLE IF NOT EXISTS public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.project_tags (
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (project_id, tag_id)
);

CREATE INDEX IF NOT EXISTS project_tags_tag_id_idx ON public.project_tags(tag_id);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_tags ENABLE ROW LEVEL SECURITY;

-- Tags are globally readable by any authenticated user (shared vocabulary).
CREATE POLICY "Authenticated users can read tags"
    ON public.tags FOR SELECT
    TO authenticated
    USING (true);

-- Any authenticated user can create a tag; server actions enforce that
-- the caller has edit access to the project they're tagging.
CREATE POLICY "Authenticated users can create tags"
    ON public.tags FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

-- project_tags readable by anyone who can read the underlying project.
CREATE POLICY "Users can read project_tags for visible projects"
    ON public.project_tags FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_tags.project_id
        )
    );

-- Writes are enforced server-side via canEdit in actions; RLS just requires auth.
CREATE POLICY "Authenticated users can link project_tags"
    ON public.project_tags FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can unlink project_tags"
    ON public.project_tags FOR DELETE
    TO authenticated
    USING (auth.uid() IS NOT NULL);

-- Helper: tags with usage count, ordered by popularity then name.
CREATE OR REPLACE FUNCTION public.get_tags_with_usage()
RETURNS TABLE (
    id UUID,
    name TEXT,
    usage_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT t.id, t.name, COUNT(pt.project_id) AS usage_count
    FROM public.tags t
    LEFT JOIN public.project_tags pt ON pt.tag_id = t.id
    GROUP BY t.id, t.name
    ORDER BY usage_count DESC, t.name ASC;
$$;
