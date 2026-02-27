import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        request.cookies.set(name, value)
                    )
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // refresh session if expired - required for Server Components
    // https://supabase.com/docs/guides/auth/server-side/nextjs
    let user: any = null;
    try {
        console.log("Middleware: Checking Supabase session...");
        const { data, error } = await supabase.auth.getUser()
        if (error) {
            console.log("Middleware: Auth error (handled):", error.message);
        } else {
            console.log("Middleware: User found:", data.user?.id);
            user = data.user
        }
    } catch (e) {
        console.log("Middleware: Catastrophic fetch error caught:", e)
        // proceed as unauthenticated
    }

    return { response: supabaseResponse, user }
}
