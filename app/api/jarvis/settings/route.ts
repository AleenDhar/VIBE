import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/actions/admin";

// =============================================================================
// Jarvis settings proxy (GET / PUT)
// =============================================================================
// Forwards to the backend's /api/jarvis/settings with the Bearer token. Admin-
// only. GET returns the analyses checklist + system prompt; PUT does a partial
// update (enabled_analysis_ids and/or system_prompt).
// =============================================================================

export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.API_BASE_URL;
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || process.env.DISPATCH_SECRET;

async function forward(req: NextRequest): Promise<NextResponse> {
    if (!(await verifyAdmin())) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const base = API_BASE_URL?.replace(/\/$/, "");
    if (!base || !API_AUTH_TOKEN) {
        return NextResponse.json(
            { error: "Jarvis is not configured (missing API_BASE_URL / token)." },
            { status: 500 }
        );
    }

    const headers: Record<string, string> = {
        Authorization: `Bearer ${API_AUTH_TOKEN}`,
        Accept: "application/json",
    };
    let body: string | undefined;
    if (req.method !== "GET") {
        const raw = await req.text();
        if (raw) {
            body = raw;
            headers["Content-Type"] = req.headers.get("content-type") || "application/json";
        }
    }

    let upstream: Response;
    try {
        upstream = await fetch(`${base}/api/jarvis/settings`, {
            method: req.method,
            headers,
            body,
            cache: "no-store",
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Upstream request failed";
        return NextResponse.json({ error: `Cannot reach Jarvis: ${message}` }, { status: 502 });
    }

    const text = await upstream.text();
    return new NextResponse(text, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
}

export async function GET(req: NextRequest) {
    return forward(req);
}
export async function PUT(req: NextRequest) {
    return forward(req);
}
