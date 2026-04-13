import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getISTSpendDate, getISTDayStart, getISTWeekStart } from "@/lib/spend-utils";

export const dynamic = "force-dynamic";

interface UsageRow {
  chat_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  updated_at: string;
}

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

  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Use admin client for DB queries (bypasses RLS) since we verified admin role above
  // Falls back to session client if service role key is not configured
  const adminDb = createAdminClient() || supabase;

  const agentApiUrl =
    process.env.AGENT_API_URL ||
    "https://agent-salesforce-link.replit.app";

  try {
    // Fetch global daily credit setting
    const { data: creditSetting } = await adminDb
      .from("app_config")
      .select("value")
      .eq("key", "default_daily_credit")
      .single();

    const globalDailyCredit = creditSetting ? Number(creditSetting.value) : 50;

    // Fetch all usage from the external backend (large limit)
    const res = await fetch(
      `${agentApiUrl}/api/usage?limit=10000&offset=0`,
      { headers: { "Content-Type": "application/json" } }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch usage from backend" },
        { status: res.status }
      );
    }

    const data = await res.json();
    const usageRows: UsageRow[] = data.usage || [];

    if (usageRows.length === 0) {
      return NextResponse.json({
        users: [],
        global_daily_credit: globalDailyCredit,
        spend_date: getISTSpendDate(),
      });
    }

    // Get all chat_ids from usage
    const chatIds = [...new Set(usageRows.map((r) => r.chat_id))];

    // Fetch chat info from local DB (admin client bypasses RLS)
    const { data: chats } = await adminDb
      .from("chats")
      .select("id, title, user_id, project_id, projects:project_id(name)")
      .in("id", chatIds);

    const chatMap: Record<
      string,
      { user_id: string; title: string; project_name: string }
    > = {};
    for (const chat of (chats || []) as any[]) {
      chatMap[chat.id] = {
        user_id: chat.user_id,
        title: chat.title || "New Chat",
        project_name: chat.projects?.name || "—",
      };
    }

    // Fetch all profiles for users who have chats
    const userIds = [
      ...new Set(
        Object.values(chatMap)
          .map((c) => c.user_id)
          .filter(Boolean)
      ),
    ];

    const { data: profiles } = await adminDb
      .from("profiles")
      .select("id, full_name, username, role, daily_spend_cap")
      .in("id", userIds);

    const profileMap: Record<
      string,
      {
        full_name: string;
        username: string | null;
        role: string;
        daily_spend_cap: number | null;
      }
    > = {};
    for (const p of (profiles || []) as any[]) {
      profileMap[p.id] = {
        full_name: p.full_name || "Unknown",
        username: p.username,
        role: p.role || "user",
        daily_spend_cap: p.daily_spend_cap,
      };
    }

    // Calculate time boundaries for today and this week
    const todayStart = getISTDayStart();
    const weekStart = getISTWeekStart();
    const todayStartMs = todayStart.getTime();
    const weekStartMs = weekStart.getTime();

    // Group usage rows by user and compute costs from actual data
    const userUsageMap: Record<
      string,
      {
        user_id: string;
        full_name: string;
        username: string | null;
        role: string;
        daily_spend_cap: number | null;
        today_cost: number;
        week_cost: number;
        week_active_days: Set<string>;
        total_cost: number;
        chats: any[];
      }
    > = {};

    for (const row of usageRows) {
      const chatInfo = chatMap[row.chat_id];
      if (!chatInfo || !chatInfo.user_id) continue;

      const userId = chatInfo.user_id;
      const prof = profileMap[userId];

      if (!userUsageMap[userId]) {
        userUsageMap[userId] = {
          user_id: userId,
          full_name: prof?.full_name || "Unknown",
          username: prof?.username || null,
          role: prof?.role || "user",
          daily_spend_cap: prof?.daily_spend_cap ?? null,
          today_cost: 0,
          week_cost: 0,
          week_active_days: new Set(),
          total_cost: 0,
          chats: [],
        };
      }

      const entry = userUsageMap[userId];
      const updatedAtMs = new Date(row.updated_at).getTime();

      entry.total_cost += row.cost_usd;

      // Chat was active today (updated after today's 4 AM IST)
      if (updatedAtMs >= todayStartMs) {
        entry.today_cost += row.cost_usd;
      }

      // Chat was active this week
      if (updatedAtMs >= weekStartMs) {
        entry.week_cost += row.cost_usd;
        // Track which day this falls on for averaging
        const dayStr = new Date(row.updated_at).toISOString().split("T")[0];
        entry.week_active_days.add(dayStr);
      }

      entry.chats.push({
        chat_id: row.chat_id,
        chat_title: chatInfo.title,
        project_name: chatInfo.project_name,
        model: row.model,
        cost_usd: row.cost_usd,
        total_tokens: row.total_tokens,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        updated_at: row.updated_at,
      });
    }

    const todayIST = getISTSpendDate();

    // Build final response — today_cost comes directly from external API data
    const users = Object.values(userUsageMap)
      .map((u) => {
        const daysInWeek = Math.max(1, u.week_active_days.size);
        const effectiveCap = u.daily_spend_cap ?? globalDailyCredit;

        return {
          user_id: u.user_id,
          full_name: u.full_name,
          username: u.username,
          role: u.role,
          daily_spend_cap: u.daily_spend_cap,
          effective_daily_credit: effectiveCap,
          today_cost: u.today_cost,
          week_avg_daily_cost: u.week_cost / daysInWeek,
          total_cost: u.total_cost,
          remaining_credit: Math.max(0, effectiveCap - u.today_cost),
          chats: u.chats,
        };
      })
      .sort((a, b) => b.total_cost - a.total_cost);

    return NextResponse.json({
      users,
      global_daily_credit: globalDailyCredit,
      spend_date: todayIST,
    });
  } catch (err) {
    console.error("[/api/usage/by-user] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
