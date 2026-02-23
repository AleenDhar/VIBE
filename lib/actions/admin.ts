"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// 1. Verify Admin Status (Server-side) - also allows super_admin
export async function verifyAdmin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return false;

    // Check role in profiles
    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    return profile?.role === 'admin' || profile?.role === 'super_admin';
}

// 1b. Verify Super Admin Status (Server-side)
export async function verifySuperAdmin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return false;

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    return profile?.role === 'super_admin';
}

// 1c. Get current user role
export async function getCurrentUserRole(): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    return profile?.role || null;
}

// 2. Fetch/Update Base Prompt
export async function getBasePrompt() {
    const isAdmin = await verifyAdmin();
    // Allow users to READ the prompt if needed? Or restrict to admin?
    // Let's restrict editing to ADMIN only, reading is fine for system use.

    // For the admin UI, we need to read it.
    if (!isAdmin) {
        // Only return if admin for editing UI? No, verifying admin for the page load is better.
        // Let's assume the page handles redirection if not admin.
    }

    const supabase = await createClient();
    const { data } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "agent_base_prompt")
        .single();

    return data?.value || "";
}

export async function updateBasePrompt(newPrompt: string) {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
        return { success: false, error: "Unauthorized: Admins only." };
    }

    const supabase = await createClient();
    const { error } = await supabase
        .from("app_config")
        .upsert({
            key: "agent_base_prompt",
            value: newPrompt,
            updated_at: new Date().toISOString()
        });

    if (error) {
        console.error("Error updating prompt:", error);
        return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    return { success: true };
}

// 3. User Management
export async function getAllUsers() {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) return [];

    const supabase = await createClient();
    const { data: users, error } = await supabase
        .from("profiles")
        .select("*")
        .order("role", { ascending: true }) // Admins first (a comes before u)
        .order("full_name", { ascending: true });

    if (error) {
        console.error("Error fetching users:", error);
        return [];
    }

    return users;
}

export async function updateUserRole(userId: string, newRole: 'admin' | 'user' | 'super_admin') {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
        return { success: false, error: "Unauthorized" };
    }

    // Only super_admin can grant/revoke super_admin role
    if (newRole === 'super_admin') {
        const isSuperAdmin = await verifySuperAdmin();
        if (!isSuperAdmin) {
            return { success: false, error: "Only Super Admins can grant Super Admin role." };
        }
    }

    // Prevent removing super_admin role from others unless you're super_admin
    const supabase = await createClient();
    const { data: targetProfile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

    if (targetProfile?.role === 'super_admin' && newRole !== 'super_admin') {
        const isSuperAdmin = await verifySuperAdmin();
        if (!isSuperAdmin) {
            return { success: false, error: "Only Super Admins can demote a Super Admin." };
        }
    }

    const { error } = await supabase
        .from("profiles")
        .update({ role: newRole })
        .eq("id", userId);

    if (error) {
        return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    return { success: true };
}

// 5. Get ALL chats with user info + project name (Super Admin Omnivision)
export async function getAllChatsWithUsers() {
    const isSuperAdmin = await verifySuperAdmin();
    if (!isSuperAdmin) return [];

    const supabase = await createClient();

    // Fetch all chats, skip those with no owner (they'd show as Unknown User)
    const { data: chats, error: chatsError } = await supabase
        .from("chats")
        .select("id, title, created_at, updated_at, project_id, user_id")
        .not("user_id", "is", null)
        .order("created_at", { ascending: false });

    if (chatsError) {
        console.error("Error fetching all chats:", chatsError);
        return [];
    }

    // Fetch ALL profiles via security-definer RPC (same pattern as projects, bypasses RLS)
    const { data: profiles, error: profilesError } = await supabase
        .rpc("get_all_profiles_for_admin");

    if (profilesError) {
        console.error("Error fetching profiles via RPC:", profilesError);
    }

    // Fetch ALL projects via security-definer RPC (bypasses RLS so names always resolve)
    const { data: projects, error: projError } = await supabase
        .rpc("get_all_projects_for_admin");

    if (projError) {
        console.error("Error fetching projects via RPC:", projError);
    }

    // Fetch last message type per chat (to show live/done status)
    const { data: lastStatuses } = await supabase
        .rpc("get_chat_last_statuses");

    // Build lookup maps
    const profileMap: Record<string, any> = {};
    (profiles || []).forEach((p: { id: string; full_name: string; role: string; avatar_url: string }) => {
        profileMap[p.id] = p;
    });

    const projectMap: Record<string, string> = {};
    (projects || []).forEach((p: { id: string; name: string }) => { projectMap[p.id] = p.name; });

    const lastStatusMap: Record<string, string> = {};
    (lastStatuses || []).forEach((s: { chat_id: string; last_type: string }) => {
        lastStatusMap[s.chat_id] = s.last_type;
    });

    // Merge — only chats with a valid profile are included
    return (chats || [])
        .filter(chat => profileMap[chat.user_id])
        .map(chat => ({
            ...chat,
            project_name: chat.project_id ? (projectMap[chat.project_id] ?? null) : null,
            last_msg_type: lastStatusMap[chat.id] ?? null,
            profiles: profileMap[chat.user_id],
        }));
}

// 6. Get chat messages for omnivision
export async function getChatMessagesForOmnivision(chatId: string) {
    const isSuperAdmin = await verifySuperAdmin();
    if (!isSuperAdmin) return [];

    const supabase = await createClient();
    const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

    if (error) {
        console.error("Error fetching messages:", error);
        return [];
    }

    return data || [];
}

// 4. API Key Management
export async function getApiKeys() {
    const isAdmin = await verifyAdmin();
    // Allow reading keys if admin, otherwise empty
    if (!isAdmin) return {};

    const supabase = await createClient();
    const { data } = await supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["openai_api_key", "google_api_key", "anthropic_api_key", "agent_api_url"]);

    // Transform into object
    const keys: Record<string, string> = {};
    data?.forEach((row: any) => {
        keys[row.key] = row.value;
    });

    return keys;
}

export async function updateApiKey(key: string, value: string) {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
        return { success: false, error: "Unauthorized: Admins only." };
    }

    const allowedKeys = ["openai_api_key", "google_api_key", "anthropic_api_key", "agent_api_url"];
    if (!allowedKeys.includes(key)) {
        return { success: false, error: "Invalid API Key type." };
    }

    const supabase = await createClient();
    const { error } = await supabase
        .from("app_config")
        .upsert({
            key,
            value,
            updated_at: new Date().toISOString()
        });

    if (error) {
        console.error("Error updating API key:", error);
        return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    return { success: true };
}
