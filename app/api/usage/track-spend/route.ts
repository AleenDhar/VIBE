import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getISTSpendDate } from "@/lib/spend-utils";

/**
 * POST /api/usage/track-spend
 * Called after a chat stream completes to record the cost delta for today.
 * Body: { chat_id: string }
 *
 * Fetches the chat's current total cost from the external backend,
 * computes the delta from last known value (stored in app_config as a JSON map),
 * and upserts the delta into user_daily_spend.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { chat_id } = body;

  if (!chat_id) {
    return NextResponse.json(
      { error: "chat_id is required" },
      { status: 400 }
    );
  }

  try {
    // 1. Fetch current cost from external backend
    const agentApiUrl =
      process.env.AGENT_API_URL ||
      "https://agent-salesforce-link.replit.app";
    const res = await fetch(`${agentApiUrl}/api/usage/${chat_id}`, {
      headers: { "Content-Type": "application/json" },
    });

    let currentCost = 0;
    if (res.ok) {
      const data = await res.json();
      currentCost = Number(data?.usage?.cost_usd) || 0;
    }

    if (currentCost <= 0) {
      return NextResponse.json({ success: true, tracked: 0 });
    }

    // 2. Get last known cost for this chat from system_settings
    const snapshotKey = `chat_cost_snapshot_${chat_id}`;
    const { data: snapshotRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", snapshotKey)
      .single();

    const lastKnownCost = snapshotRow ? Number((snapshotRow.value as any)?.cost || 0) : 0;
    const delta = Math.max(0, currentCost - lastKnownCost);

    // 3. Update the snapshot
    await supabase.from("system_settings").upsert({
      key: snapshotKey,
      value: { cost: currentCost, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    });

    // 4. If there's a positive delta, add to today's daily spend
    if (delta > 0) {
      const spendDate = getISTSpendDate();

      const { data: existing } = await supabase
        .from("user_daily_spend")
        .select("id, total_cost")
        .eq("user_id", user.id)
        .eq("spend_date", spendDate)
        .single();

      if (existing) {
        const newTotal = Number(existing.total_cost) + delta;
        await supabase
          .from("user_daily_spend")
          .update({
            total_cost: newTotal,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("user_daily_spend").insert({
          user_id: user.id,
          spend_date: spendDate,
          total_cost: delta,
        });
      }
    }

    return NextResponse.json({ success: true, tracked: delta });
  } catch (err) {
    console.error("[/api/usage/track-spend] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
