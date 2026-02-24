import { NextResponse } from 'next/server'
// The client you created from the Server-Side Auth instructions
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    // if "next" is in param, use it as the redirect URL
    const next = searchParams.get('next') ?? '/projects'

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            const forwardedHost = request.headers.get('x-forwarded-host') // original origin before load balancer
            const isLocalEnv = process.env.NODE_ENV === 'development'
            if (isLocalEnv) {
                // we can be sure that there is no load balancer in between, so no need to watch for X-Forwarded-Host
                return NextResponse.redirect(`${origin}${next}`)
            } else if (forwardedHost) {
                return NextResponse.redirect(`https://${forwardedHost}${next}`)
            } else {
                return NextResponse.redirect(`${origin}${next}`)
            }
        } else {
            console.error("Auth callback error:", error.message);
            return NextResponse.json({ error: "Auth callback error", details: error.message }, { status: 400 });
        }
    } else {
        console.error("Auth callback error: No code provided in URL search params.");
    }

    // return the user to an error page with instructions
    return NextResponse.json({
        error: "Missing auth code in URL.",
        url: request.url,
        message: "Supabase sent you here, but without a PKCE code. If you are using implicit flow, please enable PKCE or check your email templates."
    }, { status: 400 });
}
