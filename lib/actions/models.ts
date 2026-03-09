"use server";

import { createClient } from "@/lib/supabase/server";

export interface AIModel {
    id: string;
    name: string;
    provider: string;
    is_available_to_all: boolean;
    is_active: boolean;
}

// Get all active models (for the model selector)
export async function getActiveModels(): Promise<AIModel[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('ai_models')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

    if (error) {
        console.error("Error fetching active models:", error);
        return [];
    }

    return data || [];
}

// Check if a model is valid and active
export async function isModelValid(modelId: string): Promise<boolean> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('ai_models')
        .select('id')
        .eq('id', modelId)
        .eq('is_active', true)
        .single();

    return !error && !!data;
}

// Get user's permitted models (Admin Management)
export async function getUserAllowedModels(userId: string): Promise<string[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('profiles')
        .select('allowed_models')
        .eq('id', userId)
        .single();

    if (error) {
        console.error("Error fetching user allowed models:", error);
        return [];
    }

    return data?.allowed_models || [];
}

// Update user's permitted models (Admin Management)
export async function updateUserAllowedModels(userId: string, allowedModels: string[]) {
    // Needs security check in the upstream action (admin.ts)
    const supabase = await createClient();

    // We update via rpc or just direct if RLS allows admin access
    const { error } = await supabase
        .from('profiles')
        .update({ allowed_models: allowedModels })
        .eq('id', userId);

    return { success: !error, error: error?.message };
}
