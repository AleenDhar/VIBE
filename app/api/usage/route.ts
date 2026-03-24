import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify admin role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = request.nextUrl.searchParams.get("limit") || "100";
  const offset = request.nextUrl.searchParams.get("offset") || "0";
  const agentApiUrl = process.env.AGENT_API_URL || "https://agent-salesforce-link.replit.app";

  try {
    const res = await fetch(`${agentApiUrl}/api/usage?limit=${limit}&offset=${offset}`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch usage from backend" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[/api/usage] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
