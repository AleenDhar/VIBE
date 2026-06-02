import { NextRequest, NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/actions/admin";

// =============================================================================
// Bearer proxy for the Agentic Analysis Workspace
// =============================================================================
// The browser must NEVER see API_AUTH_TOKEN, so all REST writes/reads go
// through this same-origin proxy. It forwards `/api/analysis[/<path>]?<query>`
// straight to `${API_BASE_URL}/api/analysis[/<path>]` with the Bearer header
// attached here, server-side, and streams the JSON response (status + body)
// back to the caller unchanged.
//
// An OPTIONAL catch-all ([[...path]]) is used so the base collection endpoint
// `/api/analysis` (list + create) is matched as well as nested paths like
// `/api/analysis/{id}/dashboards`.
//
// Realtime reads do NOT use this proxy — they hit Supabase directly with the
// anon key from the browser (see lib/analysis/realtime.ts).
// =============================================================================

export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.API_BASE_URL;
// The analysis backend runs on the same Replit host as the phase orchestrator,
// whose auth middleware checks the DISPATCH_SECRET bearer (see
// lib/dispatch-pipeline.ts). Reuse it unless an explicit API_AUTH_TOKEN is set.
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || process.env.DISPATCH_SECRET;

function backendBase(): string | null {
    if (!API_BASE_URL) return null;
    return API_BASE_URL.replace(/\/$/, "");
}

async function forward(req: NextRequest, path: string[] | undefined): Promise<NextResponse> {
    // Admin-only feature — block non-admins from reaching the backend.
    if (!(await verifyAdmin())) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const base = backendBase();
    if (!base || !API_AUTH_TOKEN) {
        return NextResponse.json(
            { error: "Analysis API is not configured (missing API_BASE_URL / API_AUTH_TOKEN)." },
            { status: 500 }
        );
    }

    // Reconstruct `/api/analysis[/<...path>]` plus the original query string.
    const suffix = (path ?? []).map(encodeURIComponent).join("/");
    const suffixPath = suffix ? `/${suffix}` : "";
    const search = req.nextUrl.search || "";
    const target = `${base}/api/analysis${suffixPath}${search}`;

    const headers: Record<string, string> = {
        Authorization: `Bearer ${API_AUTH_TOKEN}`,
        Accept: "application/json",
    };

    // Only carry a body for methods that have one.
    let body: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
        const raw = await req.text();
        if (raw) {
            body = raw;
            headers["Content-Type"] = req.headers.get("content-type") || "application/json";
        }
    }

    let upstream: Response;
    try {
        upstream = await fetch(target, {
            method: req.method,
            headers,
            body,
            cache: "no-store",
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Upstream request failed";
        return NextResponse.json({ error: `Cannot reach analysis backend: ${message}` }, { status: 502 });
    }

    // Pass the body through verbatim. Most responses are JSON; if the backend
    // ever returns non-JSON we still forward the text and content-type so the
    // client can surface something sensible.
    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "application/json";
    return new NextResponse(text, {
        status: upstream.status,
        headers: { "content-type": contentType },
    });
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, { params }: Ctx) {
    const { path } = await params;
    return forward(req, path);
}
export async function POST(req: NextRequest, { params }: Ctx) {
    const { path } = await params;
    return forward(req, path);
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
    const { path } = await params;
    return forward(req, path);
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
    const { path } = await params;
    return forward(req, path);
}
export async function PUT(req: NextRequest, { params }: Ctx) {
    const { path } = await params;
    return forward(req, path);
}
