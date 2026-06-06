
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { chatId } = await req.json();

        if (!chatId) {
            return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
        }

        const agentApiBaseUrl = process.env.AGENT_API_URL || "http://mase-alb-1262623499.ap-south-1.elb.amazonaws.com/api/chat/";
        // Ensure base URL doesn't have trailing slash for cleaner concatenation or handle it property
        const baseUrl = agentApiBaseUrl.endsWith('/') ? agentApiBaseUrl.slice(0, -1) : agentApiBaseUrl;

        // Construct stop URL: /api/chat/stop?chat_id=...
        // If agentApiBaseUrl is .../api/chat/, then we want .../api/chat/stop
        // The user provided example: http://mase-alb-1262623499.ap-south-1.elb.amazonaws.com/api/chat/stop?chat_id=...

        const stopUrl = `${baseUrl}/stop?chat_id=${chatId}`;
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
