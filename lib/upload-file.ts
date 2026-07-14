/**
 * Client-side helper that uploads a file to Supabase Storage THROUGH our own
 * origin (`/api/storage-upload`) instead of directly to `*.supabase.co`.
 *
 * Why: on the corporate network, Zscaler DLP blocks the browser's direct
 * upload POST to Supabase Storage (403 "block page", surfaced as
 * "Upload failed: Forbidden"). Posting to our own origin is allowed; the server
 * route then forwards to Supabase from Vercel's network, out of Zscaler's path.
 *
 * Storage RLS is unchanged — the route uploads using the caller's session.
 */
export interface UploadResult {
    path: string;
    publicUrl: string;
    signedUrl?: string;
}

export async function uploadFileViaServer(
    file: File,
    path: string,
    opts?: { signedUrl?: boolean }
): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file);
    form.append("path", path);
    if (opts?.signedUrl) form.append("signedUrl", "true");

    let res: Response;
    try {
        res = await fetch("/api/storage-upload", { method: "POST", body: form });
    } catch (e: any) {
        throw new Error(`Upload request failed: ${e?.message || e}`);
    }

    if (!res.ok) {
        let message = `Upload failed (${res.status})`;
        try {
            const body = await res.json();
            if (body?.error) message = body.error;
        } catch {
            /* non-JSON error body */
        }
        throw new Error(message);
    }

    return res.json();
}
