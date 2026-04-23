-- Admins can update any project
-- =============================================================================
-- Why this exists
-- ---------------
-- The projects table previously only allowed UPDATE from:
--   1. the project owner (`owner_id = auth.uid()`)
--   2. a member whose project_members.role = 'editor'
--
-- That meant admins and super_admins editing a project they did not own and
-- weren't explicitly listed as editor on got a silent no-op: PostgREST
-- returns { error: null } when a row-level-security-filtered UPDATE matches
-- zero rows. The app layer treated that as success, inserted a row into
-- system_prompt_versions, then on refresh re-read the (unchanged)
-- projects.system_prompt and "reverted" the visible change.
--
-- Reproduction in production: between 2026-04-16 and 2026-04-23, ten
-- admin/super_admin save attempts against non-owned projects were logged
-- to system_prompt_versions but never landed on projects — e.g. multiple
-- v10.0 attempts on the APAC ABM project that kept snapping back to v9.1.
--
-- This policy unions a new permissive UPDATE path onto the existing ones
-- so admins gain the ability to modify any project without changing
-- owner-only INSERT or DELETE semantics or touching child tables. The
-- existing owner and editor policies are preserved as-is; this is purely
-- additive.
-- =============================================================================

CREATE POLICY "Admins can update any project"
    ON public.projects
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'super_admin')
        )
    )
    WITH CHECK (
        -- Mirror the USING predicate so admins can't set a projects row
        -- into a state they wouldn't be allowed to target themselves.
        -- Prevents, e.g., a future scenario where someone tries to
        -- transfer ownership via UPDATE and ends up with a row they
        -- can't see.
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('admin', 'super_admin')
        )
    );
