import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/actions/admin";

// =============================================================================
// Document-upload proxy for the Analysis workspace
// =============================================================================
// Forwards to the Replit backend's `POST /api/documents/upload`, which takes
// ALREADY-EXTRACTED plain text (not a binary file), chunks + embeds it, and
// stores it in pgvector so the agent can retrieve it via its search_knowledge
// tool. Text extraction happens client-side (lib/extract-file-content.ts).
//
// Body: { content, name, project_id?, chat_id? }  (>=1 of project_id/chat_id)
// =============================================================================

export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.API_BASE_URL;
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || process.env.DISPATCH_SECRET;

export async function POST(req: NextRequest): Promise<NextResponse> {
    if (!(await verifyAdmin())) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const base = API_BASE_URL?.replace(/\/$/, "");
    if (!base || !API_AUTH_TOKEN) {
        return NextResponse.json(
            { error: "Document upload is not configured (missing API_BASE_URL / token)." },
            { status: 500 }
        );
    }

    const body = await req.text();

    let upstream: Response;
    try {
        upstream = await fetch(`${base}/api/documents/upload`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${API_AUTH_TOKEN}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body,
            cache: "no-store",
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Upstream request failed";
        return NextResponse.json({ error: `Cannot reach document service: ${message}` }, { status: 502 });
    }

    const text = await upstream.text();
    return new NextResponse(text, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
}
