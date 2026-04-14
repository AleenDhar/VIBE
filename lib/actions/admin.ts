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

    revalidatePath("/admin");
    return { success: true };
}

// 2b. Extraction Prompts
export async function getExtractionPrompts() {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) return { system: "", analysis: "" };

    const supabase = await createClient();
    const { data } = await supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["instruction_extraction_system_prompt", "instruction_extraction_analysis_prompt"]);

    const prompts: Record<string, string> = { system: "", analysis: "" };
    data?.forEach((row: any) => {
        if (row.key === "instruction_extraction_system_prompt") prompts.system = row.value;
        if (row.key === "instruction_extraction_analysis_prompt") prompts.analysis = row.value;
    });

    return prompts;
}

export async function updateExtractionPrompt(key: "system" | "analysis", value: string) {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) return { success: false, error: "Unauthorized" };

    const configKey = key === "system"
        ? "instruction_extraction_system_prompt"
        : "instruction_extraction_analysis_prompt";

    const supabase = await createClient();
    const { error } = await supabase
        .from("app_config")
        .upsert({
            key: configKey,
            value,
            updated_at: new Date().toISOString()
        });

    if (error) return { success: false, error: error.message };

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

    const supabase = await createClient();

    // Use SECURITY DEFINER RPC function to bypass RLS for trusted admin operations.
    // All permission checks (super_admin grants, demotions) are enforced inside the
    // Postgres function itself, so we don't need to duplicate them here.
    const { error } = await supabase.rpc('update_user_role', {
        target_user_id: userId,
        new_role: newRole,
    });

    if (error) {
        return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    return { success: true };
}

// 5. Get User Aggregates for Omnivision
export interface UserAggregate {
    user_id: string;
    username: string | null;
    full_name: string | null;
    avatar_url: string | null;
    role: string | null;
    chat_count: number;
    project_count: number;
}

export async function getOmnivisionUserAggregates(fromDate?: string, toDate?: string) {
    const isSuperAdmin = await verifySuperAdmin();
    if (!isSuperAdmin) return [];

    const supabase = await createClient();

    const rpcParams: Record<string, string | null> = {
        from_date: fromDate || null,
        to_date: toDate || null,
    };

    const { data, error } = await supabase
        .rpc("get_omnivision_user_aggregates", rpcParams)
        .order("chat_count", { ascending: false })
        .limit(2000);

    if (error) {
        console.error("Error fetching user aggregates:", error);
        return [];
    }
    
    // Default null texts to empty to match expected format
    return (data || []) as UserAggregate[];
}

// 5b. Get chats for a specific user on-demand
export async function getOmnivisionChatsForUser(targetUserId: string, fromDate?: string, toDate?: string) {
    const isSuperAdmin = await verifySuperAdmin();
    if (!isSuperAdmin) return [];

    const supabase = await createClient();

    // Fetch all chats for this user (up to 1000 for safety)
    let query = supabase
        .from("chats")
        .select("id, title, created_at, updated_at, project_id, user_id")
        .eq("user_id", targetUserId)
        .order("created_at", { ascending: false })
        .limit(1000);

    if (fromDate) query = query.gte("created_at", fromDate);
    if (toDate) query = query.lte("created_at", toDate);

    const { data: chats, error: chatsError } = await query;

    if (chatsError) {
        console.error("Error fetching chats for user:", chatsError);
        return [];
    }

    // Fetch the target user's profile
    const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name, role, avatar_url")
        .eq("id", targetUserId)
        .single();

    // Fetch ALL projects via security-definer RPC to resolve names
    const { data: projects, error: projError } = await supabase
        .rpc("get_all_projects_for_admin");

    const projectMap: Record<string, string> = {};
    (projects || []).forEach((p: { id: string; name: string }) => { projectMap[p.id] = p.name; });

    // Fetch last message type per chat for live status
    const { data: lastStatuses } = await supabase.rpc("get_chat_last_statuses");
    const lastStatusMap: Record<string, string> = {};
    (lastStatuses || []).forEach((s: { chat_id: string; last_type: string }) => {
        lastStatusMap[s.chat_id] = s.last_type;
    });

    // Merge and filter out empty chats
    // A chat only exists in lastStatusMap if it has at least one message row.
    return (chats || [])
        .filter(chat => lastStatusMap[chat.id] !== undefined)
        .map(chat => {
            return {
                ...chat,
                project_name: chat.project_id ? (projectMap[chat.project_id] ?? null) : null,
                last_msg_type: lastStatusMap[chat.id] ?? null,
                profiles: profileData || null,
            };
    });
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

// 7. Search messages across all chats (Omnivision)
export interface MessageSearchResult {
    message_id: string;
    chat_id: string;
    role: string;
    content: string;
    type: string;
    created_at: string;
    chat_title: string | null;
    project_id: string | null;
    user_id: string;
    username: string | null;
    full_name: string | null;
}

export async function searchOmnivisionMessages(query: string): Promise<MessageSearchResult[]> {
    const isSuperAdmin = await verifySuperAdmin();
    if (!isSuperAdmin) return [];

    if (!query || query.trim().length < 2) return [];

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("search_omnivision_messages", {
        query_text: query.trim(),
        result_limit: 50,
    });

    if (error) {
        console.error("Error searching messages:", error);
        return [];
    }

    return (data || []) as MessageSearchResult[];
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

// 5. Update user allowed models (Admin Management)
export async function updateUserAllowedModels(userId: string, allowedModels: string[]) {
    // Needs security check in the upstream action (admin.ts)
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
        return { success: false, error: "Unauthorized: Admins only." };
    }

    const supabase = await createClient();

    // We update via rpc or just direct if RLS allows admin access
    const { error } = await supabase
        .from('profiles')
        .update({ allowed_models: allowedModels })
        .eq('id', userId);

    if (error) {
        return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    return { success: true };
}

// 6. Update global model availability (Admin Management)
export async function updateModelAvailability(modelId: string, isAvailableToAll: boolean, isActive: boolean = true) {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
        return { success: false, error: "Unauthorized: Admins only." };
    }

    const supabase = await createClient();

    const { error } = await supabase
        .from('ai_models')
        .update({
            is_available_to_all: isAvailableToAll,
            is_active: isActive,
            updated_at: new Date().toISOString()
        })
        .eq('id', modelId);

    if (error) {
        console.error("Error updating model availability:", error);
        return { success: false, error: error.message };
    }

    revalidatePath("/admin");
    return { success: true };
}
