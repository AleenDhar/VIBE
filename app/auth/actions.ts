"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"

export async function loginWithEmail(email: string, password?: string) {
    const supabase = await createClient();

    const { error } = await supabase.auth.signInWithPassword({
        email,
        password: password || "",
    });

    if (error) {
        return { error: error.message };
    }

    revalidatePath("/", "layout");
    redirect("/projects");
}

export async function signUpWithEmail(email: string, password?: string) {
    const supabase = await createClient();
    const headersList = await headers();
    const origin = headersList.get("origin") || "";

    const { error } = await supabase.auth.signUp({
        email,
        password: password || "",
        options: {
            emailRedirectTo: `${origin}/auth/callback`,
        },
    });

    if (error) {
        return { error: error.message };
    }

    return { message: "Check your email for the confirmation link." };
}

export async function resetPasswordForEmail(email: string) {
    const supabase = await createClient();
    const headersList = await headers();
    const origin = headersList.get("origin") || "";

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/callback?next=/auth/update-password`,
    });

    if (error) {
        return { error: error.message };
    }

    return { message: "Check your email for the password reset link." };
}

export async function loginWithOAuth(provider: 'google' | 'github') {
    const supabase = await createClient();
    const headersList = await headers();
    const origin = headersList.get("origin") || "";

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
            redirectTo: `${origin}/auth/callback`,
        },
    });

    if (error) {
        return { error: error.message };
    }

    if (data.url) {
        redirect(data.url);
    }
}
