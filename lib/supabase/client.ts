import { createBrowserClient } from '@supabase/ssr'

export const createClient = () => {
    // Generate an absolute URL for the browser to prevent invalid URL errors
    const supabaseUrl = typeof window !== 'undefined' ? `${window.location.origin}/supabase-proxy` : process.env.NEXT_PUBLIC_SUPABASE_URL!;

    return createBrowserClient(
        supabaseUrl,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
}
