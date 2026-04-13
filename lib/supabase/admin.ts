import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client using the service role key.
 * This bypasses RLS — use ONLY in server-side admin routes
 * after verifying the caller is an admin/super_admin.
 * Returns null if SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function createAdminClient() {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) return null;
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey,
    );
}
