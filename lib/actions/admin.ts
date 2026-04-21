"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { SENTINEL_ORPHAN_USER_ID } from "@/lib/omnivision-constants";

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

/**
 * Fetches per-user chat aggregates for the Omnivision dashboard.
 *
 * Both `fromDate` and `toDate` must be plain calendar dates in `YYYY-MM-DD`
 * form (no time, no timezone). The RPC resolves the window against the
 * Asia/Kolkata business timezone server-side, so the same label returns
 * the same numbers regardless of the viewer's browser timezone.
 *
 * A chat is counted for a user when any of its `chat_messages` landed
 * inside the window — i.e., based on activity, not chat creation date.
 * Chats with `user_id IS NULL` appear as a synthetic "(unattributed)"
 * row (SENTINEL_ORPHAN_USER_ID in lib/omnivision-constants.ts) instead of
 * silently vanishing.
 */
export async function getOmnivisionUserAggregates(fromDate?: string, toDate?: string) {
    const isSuperAdmin = await verifySuperAdmin();
    if (!isSuperAdmin) return [];

    const supabase = await createClient();

    const rpcParams: Record<string, string> = {};
    if (fromDate) rpcParams.from_date = fromDate;
    if (toDate) rpcParams.to_date = toDate;

    const { data, error } = await supabase
        .rpc("get_omnivision_user_aggregates", Object.keys(rpcParams).length > 0 ? rpcParams : undefined)
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
/**
 * Drill-down chat list for Omnivision. Delegates to the
 * `get_omnivision_chats_for_user` RPC so the list always matches the
 * aggregate's semantics: activity-based filter, IST-pinned boundaries,
 * orphan bucket served when `targetUserId === SENTINEL_ORPHAN_USER_ID`.
 *
 * `fromDate` / `toDate` must be `YYYY-MM-DD` strings.
 */
export async function getOmnivisionChatsForUser(targetUserId: string, fromDate?: string, toDate?: string) {
    const isSuperAdmin = await verifySuperAdmin();
    if (!isSuperAdmin) return [];

    const supabase = await createClient();

    const rpcParams: Record<string, string> = { target_user_id: targetUserId };
    if (fromDate) rpcParams.from_date = fromDate;
    if (toDate) rpcParams.to_date = toDate;

    const { data: chats, error: chatsError } = await supabase
        .rpc("get_omnivision_chats_for_user", rpcParams);

    if (chatsError) {
        console.error("Error fetching chats for user:", chatsError);
        return [];
    }

    // Fetch the target user's profile (orphan sentinel has no real profile)
    let profileData: { full_name: string | null; role: string | null; avatar_url: string | null } | null = null;
    if (targetUserId !== SENTINEL_ORPHAN_USER_ID) {
        const { data } = await supabase
            .from("profiles")
            .select("full_name, role, avatar_url")
            .eq("id", targetUserId)
            .single();
        profileData = data;
    } else {
        profileData = { full_name: "Unattributed chats", role: "unknown", avatar_url: null };
    }

    // Fetch ALL projects via security-definer RPC to resolve names
    const { data: projects } = await supabase
        .rpc("get_all_projects_for_admin");

    const projectMap: Record<string, string> = {};
    (projects || []).forEach((p: { id: string; name: string }) => { projectMap[p.id] = p.name; });

    // Fetch last message type per chat for live status
    const { data: lastStatuses } = await supabase.rpc("get_chat_last_statuses");
    const lastStatusMap: Record<string, string> = {};
    (lastStatuses || []).forEach((s: { chat_id: string; last_type: string }) => {
        lastStatusMap[s.chat_id] = s.last_type;
    });

    // The RPC already guarantees at least one message in window, so no
    // empty-chat filtering is needed here. Map metadata in.
    return (chats || []).map((chat: any) => ({
        ...chat,
        project_name: chat.project_id ? (projectMap[chat.project_id] ?? null) : null,
        last_msg_type: lastStatusMap[chat.id] ?? null,
        profiles: profileData,
    }));
}

// ── ABM Run Attribution (Path C surfacing) ─────────────────────────────────

/**
 * Per-user ABM reuse metrics for the Omnivision window.
 *
 * Returns rows where the user had at least one ABM run in the window.
 * Powered by the `get_abm_run_counts_by_user` RPC which filters by
 * `started_at` in IST (same semantic as the chat aggregate).
 *
 * `chats_with_reuse` = chats that had MORE than one ABM run in them.
 * `max_runs_in_one_chat` = the heaviest single chat's run count.
 */
export interface AbmRunCountsByUser {
    user_id: string;
    run_count: number;
    distinct_accounts: number;
    chats_with_reuse: number;
    max_runs_in_one_chat: number;
}

export async function getAbmRunCountsByUser(fromDate?: string, toDate?: string): Promise<AbmRunCountsByUser[]> {
    const isSuperAdmin = await verifySuperAdmin();
    if (!isSuperAdmin) return [];

    const supabase = await createClient();

    const rpcParams: Record<string, string> = {};
    if (fromDate) rpcParams.from_date = fromDate;
    if (toDate) rpcParams.to_date = toDate;

    const { data, error } = await supabase
        .rpc("get_abm_run_counts_by_user", Object.keys(rpcParams).length > 0 ? rpcParams : undefined);

    if (error) {
        console.error("Error fetching ABM run counts:", error);
        return [];
    }

    return (data || []) as AbmRunCountsByUser[];
}

/**
 * Per-chat drill-down: the ABM runs that happened inside one chat, in
 * sequence order. Used to show the "1 chat = 7 ABMs" expansion in the UI.
 *
 * Each run has account_id, campaign_id, pushed_count, started_at,
 * completed_at, and a `source` (marker | heuristic | manual).
 */
export interface AbmRunForChat {
    seq: number;
    account_id: string;
    campaign_id: string | null;
    pushed_count: number | null;
    started_at: string;
    completed_at: string | null;
    source: "marker" | "heuristic" | "manual";
}

export async function getAbmRunsForChat(chatId: string): Promise<AbmRunForChat[]> {
    const isSuperAdmin = await verifySuperAdmin();
    if (!isSuperAdmin) return [];

    const supabase = await createClient();
    const { data, error } = await supabase
        .rpc("get_abm_runs_for_chat", { p_chat_id: chatId });

    if (error) {
        console.error("Error fetching ABM runs for chat:", error);
        return [];
    }

    return (data || []) as AbmRunForChat[];
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
