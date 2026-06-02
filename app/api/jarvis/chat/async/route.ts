import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/actions/admin";

// =============================================================================
// Jarvis chat proxy → backend POST /api/jarvis/chat/async
// =============================================================================
// Same transport as the analysis agent: the backend composes Jarvis's system
// prompt from saved settings, runs the agent, and persists events to Supabase
// chat_messages (keyed by chat_id). We pipe the SSE keepalive stream straight
// through. Admin-only + Bearer.
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
        return NextResponse.json({ error: "Jarvis is not configured." }, { status: 500 });
    }

    const body = await req.text();

    let upstream: Response;
    try {
        upstream = await fetch(`${base}/api/jarvis/chat/async`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${API_AUTH_TOKEN}`,
                "Content-Type": "application/json",
                Accept: "text/event-stream",
            },
            body,
            cache: "no-store",
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Upstream request failed";
        return NextResponse.json({ error: `Cannot reach Jarvis: ${message}` }, { status: 502 });
    }

    if (!upstream.ok) {
        const text = await upstream.text();
        return new NextResponse(text || JSON.stringify({ error: `Jarvis error ${upstream.status}` }), {
            status: upstream.status,
            headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
        });
    }

    return new NextResponse(upstream.body, {
        status: 200,
        headers: {
            "content-type": upstream.headers.get("content-type") || "text/event-stream",
            "cache-control": "no-store",
        },
    });
}
