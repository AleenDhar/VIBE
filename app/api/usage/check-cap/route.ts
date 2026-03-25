import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeTodaySpend } from "@/lib/spend-check";

/**
 * GET /api/usage/check-cap
 * Returns whether the current user is within their daily spend cap.
 * Calculates today's spend live from external backend (no stored state).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("daily_spend_cap")
      .eq("id", user.id)
      .single();

    // Per-user cap takes priority; otherwise use global default
    let effectiveCap = profile?.daily_spend_cap;
    if (effectiveCap === null || effectiveCap === undefined) {
      const { data: globalSetting } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "default_daily_credit")
        .single();
      effectiveCap = globalSetting ? Number(globalSetting.value) : null;
    }

    // No cap at all = unlimited
    if (effectiveCap === null || effectiveCap === undefined) {
      return NextResponse.json({
        allowed: true,
        daily_spend_cap: null,
        today_spend: 0,
        remaining: null,
      });
    }

    const capNum = Number(effectiveCap);
    const todaySpend = await computeTodaySpend(user.id, supabase);
    const remaining = Math.max(0, capNum - todaySpend);
    const allowed = todaySpend < capNum;

    return NextResponse.json({
      allowed,
      daily_spend_cap: capNum,
      today_spend: todaySpend,
      remaining,
    });
  } catch (err) {
    console.error("[/api/usage/check-cap] Error:", err);
    // On error, allow (fail open for usability)
    return NextResponse.json({ allowed: true, error: "check failed" });
  }
}
