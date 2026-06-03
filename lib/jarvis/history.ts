"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

// Jarvis conversation registry, stored in Supabase (public.jarvis_chats, RLS
// scoped to the user). Replaces the old per-browser localStorage list so the
// History menu is consistent across devices / prod.

export interface JarvisChatEntry {
    id: string;
    title: string;
    created_at: string;
}

export async function listJarvisChats(supabase: SupabaseClient): Promise<JarvisChatEntry[]> {
    const { data, error } = await supabase
        .from("jarvis_chats")
        .select("id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
    if (error) return [];
    return (data as JarvisChatEntry[]) ?? [];
}

// Register a conversation on its first message. Insert-if-absent so the title
// (first message) and created_at stay stable on re-entry.
export async function addJarvisChat(
    supabase: SupabaseClient,
    userId: string,
    entry: { id: string; title: string }
): Promise<void> {
    if (!userId) return;
    await supabase
        .from("jarvis_chats")
        .upsert(
            { id: entry.id, user_id: userId, title: entry.title },
            { onConflict: "id", ignoreDuplicates: true }
        );
}

export async function removeJarvisChat(supabase: SupabaseClient, id: string): Promise<void> {
    await supabase.from("jarvis_chats").delete().eq("id", id);
}
