import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chat_id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { chat_id } = await params;
  const agentApiUrl = process.env.AGENT_API_URL || "http://mase-alb-1262623499.ap-south-1.elb.amazonaws.com";
  // The backend gates /api/usage behind its API auth token (only /api/chat,
  // /api/config etc. are public). Without this header the call 401s and no
  // cost is ever shown.
  const apiAuthToken = process.env.API_AUTH_TOKEN || process.env.DISPATCH_SECRET;

  try {
    const res = await fetch(`${agentApiUrl}/api/usage/${chat_id}`, {
      headers: {
        "Content-Type": "application/json",
        ...(apiAuthToken ? { Authorization: `Bearer ${apiAuthToken}` } : {}),
      },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch usage" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error(`[/api/usage/${chat_id}] Error:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
