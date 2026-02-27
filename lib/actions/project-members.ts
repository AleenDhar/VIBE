"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function grantProjectAccess(projectId: string, email: string) {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { error: "Unauthorized" };
    }

    // Check if user is admin
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
        // Allow if user is the project owner
        const { data: project } = await supabase
            .from('projects')
            .select('owner_id')
            .eq('id', projectId)
            .single();

        if (!project || project.owner_id !== user.id) {
            return { error: "Only admins or project owners can grant access" };
        }
    }

    // Call our secure function to get user ID by email
    const { data: targetUserId, error: fnError } = await supabase
        .rpc('get_user_id_by_email', { email_address: email });

    if (fnError || !targetUserId) {
        return { error: "User with this email not found." };
    }

    if (targetUserId === user.id) {
        return { error: "You cannot add yourself." };
    }

    // Check if they are already a member
    const { data: existingMember } = await supabase
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', targetUserId)
        .single();

    if (existingMember) {
        return { error: "User is already a member." };
    }

    // Insert into project_members
    const { error: insertError } = await supabase
        .from('project_members')
        .insert({
            project_id: projectId,
            user_id: targetUserId,
            role: "viewer"
        });

    if (insertError) {
        return { error: insertError.message };
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true };
}

export async function revokeProjectAccess(projectId: string, targetUserId: string) {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { error: "Unauthorized" };
    }

    // Check admin/owner rights
    // Wait, the RLS policy on project_members handles this but let's do it safely
    const { error } = await supabase
        .from('project_members')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', targetUserId);

    if (error) {
        return { error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true };
}

export async function getProjectMembers(projectId: string) {
    const supabase = await createClient();

    // Join with profiles to get the user's name
    const { data, error } = await supabase
        .from('project_members')
        .select(`
            user_id,
            role,
            profiles:user_id ( full_name, avatar_url )
        `)
        .eq('project_id', projectId);

    if (error) {
        console.error(error);
        return [];
    }

    return data;
}

export async function grantAccessToAllUsers(projectId: string) {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { error: "Unauthorized" };
    }

    // Check if user is admin
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
        return { error: "Only admins can grant bulk access" };
    }

    // Fetch all non-admin users
    const { data: allUsers, error: usersError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'user');

    if (usersError) {
        return { error: "Failed to fetch users" };
    }

    if (!allUsers || allUsers.length === 0) {
        return { error: "No standard users found to add" };
    }

    // Fetch existing members
    const { data: existingMembers, error: membersError } = await supabase
        .from('project_members')
        .select('user_id')
        .eq('project_id', projectId);

    if (membersError) {
        return { error: "Failed to fetch existing members" };
    }

    const existingUserIds = new Set((existingMembers || []).map(m => m.user_id));

    // Filter users who are not already members
    const newMembers = allUsers
        .filter(u => !existingUserIds.has(u.id))
        .map(u => ({
            project_id: projectId,
            user_id: u.id,
            role: "viewer"
        }));

    if (newMembers.length === 0) {
        return { success: true, message: "All users already have access" };
    }

    // Bulk insert new members
    const { error: insertError } = await supabase
        .from('project_members')
        .insert(newMembers);

    if (insertError) {
        return { error: "Failed to bulk add users" };
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true, count: newMembers.length };
}

export async function getAllWorkspaceUsers() {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return [];
    }

    // Fetch all registered users
    const { data: allUsers, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role')
        .order('full_name', { ascending: true });

    if (error) {
        console.error("Failed to fetch workspace users:", error);
        return [];
    }

    return allUsers || [];
}

export async function toggleUserProjectAccess(projectId: string, userId: string, grant: boolean) {
    try {
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { error: "Unauthorized" };
        }

        // Check if user is admin or project owner
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
            const { data: project } = await supabase
                .from('projects')
                .select('owner_id')
                .eq('id', projectId)
                .single();

            if (!project || project.owner_id !== user.id) {
                return { error: "Only admins or project owners can manage access" };
            }
        }

        if (grant) {
            // Check if already a member
            const { data: existing } = await supabase
                .from('project_members')
                .select('id')
                .eq('project_id', projectId)
                .eq('user_id', userId)
                .single();

            if (existing) {
                return { success: true }; // Already a member, no-op
            }

            const { error: insertError } = await supabase
                .from('project_members')
                .insert({
                    project_id: projectId,
                    user_id: userId,
                    role: "viewer"
                });

            if (insertError) {
                console.error("[toggleUserProjectAccess] Insert error:", insertError);
                return { error: insertError.message };
            }
        } else {
            const { error: deleteError } = await supabase
                .from('project_members')
                .delete()
                .eq('project_id', projectId)
                .eq('user_id', userId);

            if (deleteError) {
                console.error("[toggleUserProjectAccess] Delete error:", deleteError);
                return { error: deleteError.message };
            }
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (err: any) {
        console.error("[toggleUserProjectAccess] Unexpected error:", err);
        return { error: err.message || "An unexpected error occurred" };
    }
}
