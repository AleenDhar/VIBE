import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/actions/admin";

// =============================================================================
// Agent-chat proxy for the Analysis workspace
// =============================================================================
// Forwards to the Replit agent's `POST /api/chat/async` with the Bearer header.
// That endpoint runs the agent (which has the analysis + dashboard tools) in a
// background task and streams its events into Supabase `chat_messages` keyed by
// chat_id. We pipe the upstream stream straight back so the connection stays
// open for the run's lifetime; the client renders progress from realtime, not
// from this body.
//
// Kept on a distinct path (not /api/analysis/...) so it doesn't collide with
// the app's own /api/chat route or the /api/analysis Bearer proxy.
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
            { error: "Analysis agent is not configured (missing API_BASE_URL / token)." },
            { status: 500 }
        );
    }

    const body = await req.text();

    let upstream: Response;
    try {
        upstream = await fetch(`${base}/api/chat/async`, {
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
        return NextResponse.json({ error: `Cannot reach analysis agent: ${message}` }, { status: 502 });
    }

    // Non-2xx (e.g. 409 already running, 503 capacity) — forward the JSON error.
    if (!upstream.ok) {
        const text = await upstream.text();
        return new NextResponse(text || JSON.stringify({ error: `Agent error ${upstream.status}` }), {
            status: upstream.status,
            headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
        });
    }

    // Pipe the keepalive/event stream straight through.
    return new NextResponse(upstream.body, {
        status: 200,
        headers: {
            "content-type": upstream.headers.get("content-type") || "text/event-stream",
            "cache-control": "no-store",
        },
    });
}
