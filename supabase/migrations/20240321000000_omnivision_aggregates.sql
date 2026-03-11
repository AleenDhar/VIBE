CREATE OR REPLACE FUNCTION public.get_omnivision_user_aggregates()
RETURNS TABLE (
    user_id uuid,
    username text,
    full_name text,
    avatar_url text,
    role text,
    chat_count bigint,
    project_count bigint
) AS $$
BEGIN
    -- Verify caller is super admin
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    RETURN QUERY
    SELECT 
        p.id as user_id,
        p.username,
        p.full_name,
        p.avatar_url,
        p.role,
        COUNT(DISTINCT c.id) as chat_count,
        COUNT(DISTINCT proj.id) as project_count
    FROM public.profiles p
    LEFT JOIN public.chats c ON c.user_id = p.id
    LEFT JOIN public.projects proj ON proj.owner_id = p.id
    GROUP BY p.id, p.username, p.full_name, p.avatar_url, p.role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
