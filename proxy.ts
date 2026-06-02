import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/proxy";

// Admins land on the Analysis workspace instead of /projects.
async function isAdminUser(request: NextRequest, userId: string): Promise<boolean> {
    try {
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return request.cookies.getAll();
                    },
                    setAll() {
                        /* read-only here */
                    },
                },
            }
        );
        const { data } = await supabase.from("profiles").select("role").eq("id", userId).single();
        return data?.role === "admin" || data?.role === "super_admin";
    } catch {
        return false;
    }
}

export async function proxy(request: NextRequest) {
    try {
        const { response, user } = await updateSession(request);

        // Helper for creating redirects while preserving updated session cookies
        const createRedirect = (path: string) => {
            const redirectUrl = new URL(path, request.url);
            const redirectResponse = NextResponse.redirect(redirectUrl);

            // Copy cookies from updateSession response (which may contain refreshed auth tokens)
            response.cookies.getAll().forEach((cookie) => {
                redirectResponse.cookies.set(cookie);
            });

            return redirectResponse;
        };

        // Authenticated users visiting the landing page: admins → Analysis,
        // everyone else → projects.
        if (user && request.nextUrl.pathname === "/") {
            const dest = (await isAdminUser(request, user.id)) ? "/analysis" : "/projects";
            return createRedirect(dest);
        }

        // Define protected routes (add/remove as needed)
        const protectedRoutes = ["/chat", "/projects", "/admin", "/omnivision", "/builder", "/analysis"];

        // Check if current path matches any protected route
        const isProtectedRoute = protectedRoutes.some(route =>
            request.nextUrl.pathname.startsWith(route)
        );

        // Unauthenticated users trying to access protected routes go to login
        if (!user && isProtectedRoute) {
            return createRedirect("/");
        }

        return response;
    } catch (e) {
        console.error("Proxy failed:", e);
        return NextResponse.next({
            request: {
                headers: request.headers,
            },
        });
    }
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * Feel free to modify this pattern to include more paths.
         */
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    ],
};
