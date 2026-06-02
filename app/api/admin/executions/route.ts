import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const fromDate = params.get("from") || undefined;
  const toDate = params.get("to") || undefined;
  const status = params.get("status") || undefined;
  const type = params.get("type") || undefined;
  const userId = params.get("user") || undefined;
  const limit = parseInt(params.get("limit") || "50", 10);
  const offset = parseInt(params.get("offset") || "0", 10);

  try {
    // Build RPC params — only include defined values
    const rpcParams: Record<string, unknown> = {
      p_limit: limit,
      p_offset: offset,
    };
    if (fromDate) rpcParams.p_from_date = fromDate;
    if (toDate) rpcParams.p_to_date = toDate;
    if (status) rpcParams.p_status = status;
    if (type) rpcParams.p_type = type;
    if (userId) rpcParams.p_user_id = userId;

    const statsParams: Record<string, unknown> = {};
    if (fromDate) statsParams.p_from_date = fromDate;
    if (toDate) statsParams.p_to_date = toDate;

    // Fetch executions and stats in parallel
    const [execResult, statsResult] = await Promise.all([
      supabase.rpc("get_admin_executions", rpcParams),
      supabase.rpc(
        "get_admin_execution_stats",
        Object.keys(statsParams).length > 0 ? statsParams : undefined
      ),
    ]);

    if (execResult.error) {
      console.error("[/api/admin/executions] executions RPC error:", execResult.error);
      return NextResponse.json(
        { error: execResult.error.message },
        { status: 500 }
      );
    }

    if (statsResult.error) {
      console.error("[/api/admin/executions] stats RPC error:", statsResult.error);
      return NextResponse.json(
        { error: statsResult.error.message },
        { status: 500 }
      );
    }

    const executions = execResult.data || [];
    const total = executions.length > 0 ? executions[0].total_rows : 0;
    const stats = (statsResult.data || [])[0] || {
      total_count: 0,
      running_count: 0,
      completed_count: 0,
      failed_count: 0,
    };

    return NextResponse.json({ executions, stats, total });
  } catch (err) {
    console.error("[/api/admin/executions] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
