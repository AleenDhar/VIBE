"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// 1. Verify Admin Status (Server-side)
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

    return profile?.role === 'admin';
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

export async function updateUserRole(userId: string, newRole: 'admin' | 'user') {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
        return { success: false, error: "Unauthorized" };
    }

    const supabase = await createClient();
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
