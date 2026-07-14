import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Server-side storage upload proxy
// =============================================================================
// The browser CANNOT upload directly to Supabase Storage on the corporate
// network: Zscaler DLP blocks the browser -> *.supabase.co/storage/v1/object
// file-upload POST and returns a 403 block page (surfaced in the UI as
// "Upload failed: Forbidden"). Reads are unaffected because most are rendered
// server-side on Vercel.
//
// This route lets the browser POST the file to our OWN origin (which Zscaler
// allows — it's where the app is served from). The upload to Supabase then
// happens from Vercel's network, so Zscaler never sees it. Same pattern the
// backend already uses (CodeBuild in AWS) to sidestep the proxy.
//
// Auth: uses the caller's Supabase session (cookies), so Storage RLS still
// applies exactly as it did for the direct client upload.
//
// Body: multipart/form-data with
//   - file:      the File to upload (required)
//   - path:      destination object path in the `project-files` bucket (required)
//   - signedUrl: "true" to also return a 1-year signed URL (for images)
// Returns: { path, publicUrl, signedUrl? } or { error }
// =============================================================================

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "project-files";

export async function POST(req: NextRequest): Promise<NextResponse> {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let form: FormData;
    try {
        form = await req.formData();
    } catch {
        return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const file = form.get("file");
    const path = form.get("path");
    const wantSignedUrl = form.get("signedUrl") === "true";

    if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing 'file'" }, { status: 400 });
    }
    if (typeof path !== "string" || !path) {
        return NextResponse.json({ error: "Missing 'path'" }, { status: 400 });
    }

    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
            contentType: file.type || undefined,
            upsert: false,
        });

    if (uploadError) {
        return NextResponse.json({ error: uploadError.message }, { status: 400 });
    }

    const {
        data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(path);

    let signedUrl: string | undefined;
    if (wantSignedUrl) {
        const { data } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 year
        signedUrl = data?.signedUrl ?? undefined;
    }

    return NextResponse.json({ path, publicUrl, signedUrl });
}
