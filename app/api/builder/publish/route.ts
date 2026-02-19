import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { slug, htmlContent } = await req.json();

        if (!slug || !htmlContent) {
            return NextResponse.json({ error: "Missing slug or content" }, { status: 400 });
        }

        // Validate slug (alphanumeric and dashes only)
        if (!/^[a-z0-9-]+$/.test(slug)) {
            return NextResponse.json({ error: "Invalid slug format. Use lowercase, numbers, and dashes." }, { status: 400 });
        }

        // Check if slug is reserved
        const reserved = ["builder", "chat", "projects", "admin", "api", "auth", "login", "signup"];
        if (reserved.includes(slug)) {
            return NextResponse.json({ error: "This name is reserved." }, { status: 400 });
        }

        // Upsert the published app
        const { error } = await supabase
            .from("published_apps")
            .upsert({
                user_id: user.id,
                slug: slug,
                html_content: htmlContent,
                updated_at: new Date().toISOString()
            }, { onConflict: "slug" });

        if (error) {
            console.error("Publish Error:", error);
            if (error.code === "23505") { // Unique constraint
                return NextResponse.json({ error: "This name is already taken. Please choose another." }, { status: 400 });
            }
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, url: `/${slug}` });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
