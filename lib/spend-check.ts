import { getISTDayStart } from "@/lib/spend-utils";

interface UsageRow {
  chat_id: string;
  cost_usd: number;
  updated_at: string;
}

/**
 * Compute a user's today spend by fetching live data from the external backend
 * and filtering for chats updated after 4 AM IST today.
 * No stored state — pure calculation every time.
 */
export async function computeTodaySpend(
  userId: string,
  supabase: any
): Promise<number> {
  const agentApiUrl =
    process.env.AGENT_API_URL || "https://agent-salesforce-link.replit.app";
  const todayStart = getISTDayStart();
  const todayStartMs = todayStart.getTime();

  // Fetch user's chats and all usage in parallel
  const [chatsRes, usageRes] = await Promise.all([
    supabase.from("chats").select("id").eq("user_id", userId),
    fetch(`${agentApiUrl}/api/usage?limit=10000&offset=0`, {
      headers: { "Content-Type": "application/json" },
    }),
  ]);

  const userChatIds = new Set(
    ((chatsRes.data || []) as { id: string }[]).map((c) => c.id)
  );

  if (!usageRes.ok) return 0;

  const data = await usageRes.json();
  const rows: UsageRow[] = data.usage || [];

  let todaySpend = 0;
  for (const row of rows) {
    if (!userChatIds.has(row.chat_id)) continue;
    const updatedAtMs = new Date(row.updated_at).getTime();
    if (updatedAtMs >= todayStartMs) {
      todaySpend += Number(row.cost_usd) || 0;
    }
  }

  return todaySpend;
}
