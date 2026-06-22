
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { chatId } = await req.json();

        if (!chatId) {
            return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
        }

        // Normalize to the /api/chat root the SAME way app/api/chat/route.ts does.
        // BUG FIX: AGENT_API_URL is set to the BARE host (no /api/chat) in
        // .env.local, so the old `${base}/stop` produced ".../stop" — which the
        // backend doesn't serve (stop lives at /api/chat/stop). The POST 404'd,
        // the route returned not-ok, and the UI got stuck on "Stopping…" while
        // the run kept going. Append /api/chat when missing so we always hit
        // ".../api/chat/stop".
        let base = (process.env.AGENT_API_URL || "http://mase-alb-1262623499.ap-south-1.elb.amazonaws.com/api/chat")
            .replace(/\/$/, "");
        if (!base.endsWith("/api/chat")) base = `${base}/api/chat`;

        const stopUrl = `${base}/stop?chat_id=${encodeURIComponent(chatId)}`;
        console.log(`[API] Stopping chat: ${stopUrl}`);

        const authToken = process.env.DISPATCH_SECRET;
        const headers: Record<string, string> = { "Content-Length": "0" };
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        const response = await fetch(stopUrl, {
            method: "POST",
            headers,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[API] Stop failed: ${response.status} - ${errorText}`);
            return NextResponse.json({ error: `Failed to stop chat: ${errorText}` }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error: any) {
        console.error("Stop Route Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
