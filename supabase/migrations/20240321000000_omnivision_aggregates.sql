CREATE OR REPLACE FUNCTION public.get_omnivision_user_aggregates(
    from_date TIMESTAMPTZ DEFAULT NULL,
    to_date TIMESTAMPTZ DEFAULT NULL
)
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
    -- Only join chats that have at least one message and fall within date range
    LEFT JOIN (
        SELECT ch.id, ch.user_id
        FROM public.chats ch
        WHERE EXISTS (
            SELECT 1 FROM public.chat_messages cm WHERE cm.chat_id = ch.id
        )
        AND (from_date IS NULL OR ch.created_at >= from_date)
        AND (to_date IS NULL OR ch.created_at <= to_date)
    ) c ON c.user_id = p.id
    LEFT JOIN public.projects proj ON proj.owner_id = p.id
    GROUP BY p.id, p.username, p.full_name, p.avatar_url, p.role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
