"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  formatModelName,
  formatTokenCount,
  formatCost,
} from "@/lib/usage-utils";
import { Button } from "@/components/ui/Button";
import {
  RefreshCw,
  Coins,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Users,
  Table as TableIcon,
  AlertTriangle,
  Settings,
  Save,
  DollarSign,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

interface UsageRow {
  chat_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  updated_at: string;
}

interface ChatInfo {
  userName: string;
  projectName: string;
  chatTitle: string;
}

interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

interface UserChatDetail {
  chat_id: string;
  chat_title: string;
  project_name: string;
  model: string;
  cost_usd: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  updated_at: string;
}

interface UserUsageSummary {
  user_id: string;
  full_name: string;
  username: string | null;
  role: string;
  daily_spend_cap: number | null;
  effective_daily_credit: number;
  today_cost: number;
  week_avg_daily_cost: number;
  total_cost: number;
  remaining_credit: number;
  chats: UserChatDetail[];
}

type SortKey = keyof UsageRow;
type SortDir = "asc" | "desc";
type ViewMode = "table" | "per-user";

// ── Component ──────────────────────────────────────────────────────────

export default function UsagePage() {
  const [viewMode, setViewMode] = useState<ViewMode>("per-user");

  // Table view state
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [chatInfoMap, setChatInfoMap] = useState<Record<string, ChatInfo>>({});

  // Per-user view state
  const [userSummaries, setUserSummaries] = useState<UserUsageSummary[]>([]);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [userLoading, setUserLoading] = useState(false);

  // Global credit state
  const [globalCredit, setGlobalCredit] = useState<number>(50);
  const [editingCredit, setEditingCredit] = useState(false);
  const [creditInput, setCreditInput] = useState("");
  const [savingCredit, setSavingCredit] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  // Auth check
  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "admin" && profile?.role !== "super_admin") {
        router.push("/");
        return;
      }
      setAuthorized(true);
    }
    checkAuth();
  }, [router]);

  // ── Table view fetching ──

  const fetchUsage = async (p = page, ps = pageSize) => {
    setLoading(true);
    const offset = (p - 1) * ps;
    try {
      const res = await fetch(`/api/usage?limit=${ps}&offset=${offset}`);
      if (!res.ok) throw new Error("Failed to fetch usage");
      const data = await res.json();
      setRows(data.usage || []);
      setTotals(data.totals || null);
      setTotalCount(data.count || 0);
    } catch (err) {
      console.error("[UsagePage] Error fetching usage:", err);
    } finally {
      setLoading(false);
    }
  };

  const enrichChatInfo = async (usageRows: UsageRow[]) => {
    if (usageRows.length === 0) return;
    const chatIds = usageRows.map((r) => r.chat_id);
    try {
      const { data: chats } = await supabase
        .from("chats")
        .select("id, title, user_id, project_id, projects:project_id(name)")
        .in("id", chatIds);

      if (!chats || chats.length === 0) return;

      const userIds = [
        ...new Set((chats as any[]).map((c) => c.user_id).filter(Boolean)),
      ];
      const profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        if (profiles) {
          for (const p of profiles) {
            profileMap[p.id] = p.full_name || "Unknown";
          }
        }
      }

      const map: Record<string, ChatInfo> = {};
      for (const chat of chats as any[]) {
        map[chat.id] = {
          userName: profileMap[chat.user_id] || "Unknown",
          projectName: chat.projects?.name || "—",
          chatTitle: chat.title || "New Chat",
        };
      }
      setChatInfoMap(map);
    } catch (err) {
      console.error("[UsagePage] Error enriching chat info:", err);
    }
  };

  // ── Per-user view fetching ──

  const fetchUserUsage = async () => {
    setUserLoading(true);
    try {
      const res = await fetch("/api/usage/by-user");
      if (!res.ok) throw new Error("Failed to fetch user usage");
      const data = await res.json();
      setUserSummaries(data.users || []);
      setGlobalCredit(data.global_daily_credit ?? 50);
    } catch (err) {
      console.error("[UsagePage] Error fetching user usage:", err);
    } finally {
      setUserLoading(false);
    }
  };

  // ── Save global credit ──

  const handleSaveCredit = async () => {
    const val = Number(creditInput);
    if (isNaN(val) || val < 0) return;
    setSavingCredit(true);
    try {
      const res = await fetch("/api/admin/global-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_daily_credit: val }),
      });
      const data = await res.json();
      if (data.success) {
        setGlobalCredit(data.default_daily_credit);
        setEditingCredit(false);
        // Refresh to recalculate remaining credits
        fetchUserUsage();
      }
    } catch (err) {
      console.error("[UsagePage] Error saving credit:", err);
    } finally {
      setSavingCredit(false);
    }
  };

  useEffect(() => {
    if (authorized && viewMode === "table") fetchUsage(page, pageSize);
    if (authorized && viewMode === "per-user") fetchUserUsage();
  }, [authorized, viewMode, page, pageSize]);

  useEffect(() => {
    if (rows.length > 0 && viewMode === "table") enrichChatInfo(rows);
  }, [rows]);

  // ── Table helpers ──

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    }
    const aStr = String(aVal);
    const bStr = String(bVal);
    return sortDir === "asc"
      ? aStr.localeCompare(bStr)
      : bStr.localeCompare(aStr);
  });

  // ── Per-user helpers ──

  const toggleUserExpanded = (userId: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const getRoleBadge = (role: string) => {
    if (role === "super_admin")
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">
          Super Admin
        </span>
      );
    if (role === "admin")
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
          Admin
        </span>
      );
    return null;
  };

  // ── Loading states ──

  if (authorized === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!authorized) return null;

  const isLoading = viewMode === "table" ? loading : userLoading;

  const SortHeader = ({
    label,
    field,
  }: {
    label: string;
    field: SortKey;
  }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          className={`h-3 w-3 ${sortKey === field ? "text-foreground" : "opacity-40"}`}
        />
      </span>
    </th>
  );

  // Credit usage percentage helper
  const getCreditBar = (used: number, limit: number) => {
    const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
    let color = "bg-emerald-500";
    if (pct >= 90) color = "bg-red-500";
    else if (pct >= 70) color = "bg-amber-500";
    return { pct, color };
  };

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Coins className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Usage Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Token usage, costs, and daily credits
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex bg-muted rounded-lg p-1">
            <button
              onClick={() => setViewMode("per-user")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === "per-user"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Per User
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === "table"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <TableIcon className="h-3.5 w-3.5" />
              All Chats
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              viewMode === "table" ? fetchUsage() : fetchUserUsage()
            }
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* ══════════════════ PER-USER VIEW ══════════════════ */}
      {viewMode === "per-user" && (
        <>
          {/* Global Daily Credit Control */}
          <div className="bg-card border rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <DollarSign className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    Global Daily Credit Limit
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Default daily spending limit for all users. Resets at 4:00
                    AM IST.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {editingCredit ? (
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-medium">$</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={creditInput}
                      onChange={(e) => setCreditInput(e.target.value)}
                      className="w-24 bg-background border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveCredit();
                        if (e.key === "Escape") setEditingCredit(false);
                      }}
                    />
                    <span className="text-sm text-muted-foreground">/ day</span>
                    <Button
                      size="sm"
                      onClick={handleSaveCredit}
                      disabled={savingCredit}
                    >
                      <Save className="h-3.5 w-3.5 mr-1" />
                      {savingCredit ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingCredit(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-emerald-500">
                      ${globalCredit.toFixed(2)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / day per user
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCreditInput(String(globalCredit));
                        setEditingCredit(true);
                      }}
                    >
                      <Settings className="h-3.5 w-3.5 mr-1" />
                      Change
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* User list */}
          {userLoading && userSummaries.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">
                Loading user usage data...
              </span>
            </div>
          ) : userSummaries.length === 0 ? (
            <div className="bg-card border rounded-xl p-8 text-center text-muted-foreground">
              No usage data available
            </div>
          ) : (
            <div className="space-y-3">
              {userSummaries.map((u) => {
                const isExpanded = expandedUsers.has(u.user_id);
                const effectiveCap = u.effective_daily_credit;
                const capExceeded = u.today_cost >= effectiveCap;
                const capNearLimit =
                  u.today_cost >= effectiveCap * 0.8 && !capExceeded;
                const bar = getCreditBar(u.today_cost, effectiveCap);

                return (
                  <div
                    key={u.user_id}
                    className={`bg-card border rounded-xl shadow-sm overflow-hidden ${
                      capExceeded
                        ? "border-red-500/50"
                        : capNearLimit
                          ? "border-amber-500/50"
                          : ""
                    }`}
                  >
                    {/* User Summary Row */}
                    <div
                      className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => toggleUserExpanded(u.user_id)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-bold text-primary">
                              {(u.full_name || "?")[0].toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">
                                {u.full_name}
                              </span>
                              {getRoleBadge(u.role)}
                              {capExceeded && (
                                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 font-semibold">
                                  <AlertTriangle className="h-3 w-3" />
                                  Limit Reached
                                </span>
                              )}
                              {u.daily_spend_cap !== null && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                                  Custom: ${u.daily_spend_cap}/day
                                </span>
                              )}
                            </div>
                            {u.username && (
                              <p className="text-xs text-muted-foreground truncate">
                                @{u.username}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-6">
                          {/* Stats */}
                          <div className="hidden md:flex items-center gap-4">
                            <div className="text-right">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Today
                              </p>
                              <p
                                className={`text-sm font-bold tabular-nums ${
                                  capExceeded
                                    ? "text-red-600 dark:text-red-400"
                                    : ""
                                }`}
                              >
                                {formatCost(u.today_cost)}
                              </p>
                            </div>
                            <div className="h-8 w-px bg-border" />
                            <div className="text-right">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Remaining
                              </p>
                              <p
                                className={`text-sm font-bold tabular-nums ${
                                  u.remaining_credit <= 0
                                    ? "text-red-600 dark:text-red-400"
                                    : u.remaining_credit <
                                        effectiveCap * 0.2
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {formatCost(u.remaining_credit)}
                              </p>
                            </div>
                            <div className="h-8 w-px bg-border" />
                            <div className="text-right">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Week Avg / Day
                              </p>
                              <p className="text-sm font-bold tabular-nums">
                                {formatCost(u.week_avg_daily_cost)}
                              </p>
                            </div>
                            <div className="h-8 w-px bg-border" />
                            <div className="text-right">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                All-Time
                              </p>
                              <p className="text-sm font-bold tabular-nums text-primary">
                                {formatCost(u.total_cost)}
                              </p>
                            </div>
                          </div>

                          {/* Expand Toggle */}
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <span className="text-xs">
                              {u.chats.length} chat
                              {u.chats.length !== 1 ? "s" : ""}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Credit usage bar */}
                      <div className="ml-[52px] mr-16">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${bar.color}`}
                              style={{ width: `${bar.pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right">
                            {formatCost(u.today_cost)} / {formatCost(effectiveCap)}
                          </span>
                        </div>
                      </div>

                      {/* Mobile stats */}
                      <div className="md:hidden ml-[52px] mt-2 flex flex-wrap gap-3 text-xs">
                        <div>
                          <span className="text-muted-foreground">
                            Today:{" "}
                          </span>
                          <span
                            className={`font-bold ${capExceeded ? "text-red-600" : ""}`}
                          >
                            {formatCost(u.today_cost)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Left:{" "}
                          </span>
                          <span className="font-bold text-emerald-600">
                            {formatCost(u.remaining_credit)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Week Avg:{" "}
                          </span>
                          <span className="font-bold">
                            {formatCost(u.week_avg_daily_cost)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            Total:{" "}
                          </span>
                          <span className="font-bold text-primary">
                            {formatCost(u.total_cost)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Expanded: Per-chat per-model breakdown */}
                    {isExpanded && (
                      <div className="border-t">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="px-4 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                  Chat
                                </th>
                                <th className="px-4 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                  Project
                                </th>
                                <th className="px-4 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                  Model
                                </th>
                                <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                  Input
                                </th>
                                <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                  Output
                                </th>
                                <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                  Cost
                                </th>
                                <th className="px-4 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                  Last Active
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {u.chats
                                .sort(
                                  (a, b) =>
                                    new Date(b.updated_at).getTime() -
                                    new Date(a.updated_at).getTime()
                                )
                                .map((chat) => (
                                  <tr
                                    key={chat.chat_id}
                                    className="hover:bg-muted/20 transition-colors"
                                  >
                                    <td
                                      className="px-4 py-2 text-xs max-w-[200px] truncate"
                                      title={chat.chat_title}
                                    >
                                      {chat.chat_title}
                                    </td>
                                    <td className="px-4 py-2 text-xs text-muted-foreground">
                                      {chat.project_name}
                                    </td>
                                    <td className="px-4 py-2 text-xs">
                                      <span className="inline-flex px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium">
                                        {formatModelName(chat.model)}
                                      </span>
                                    </td>
                                    <td className="px-4 py-2 text-xs tabular-nums text-right text-muted-foreground">
                                      {formatTokenCount(chat.input_tokens)}
                                    </td>
                                    <td className="px-4 py-2 text-xs tabular-nums text-right text-muted-foreground">
                                      {formatTokenCount(chat.output_tokens)}
                                    </td>
                                    <td className="px-4 py-2 text-xs tabular-nums text-right font-medium">
                                      {formatCost(chat.cost_usd)}
                                    </td>
                                    <td className="px-4 py-2 text-xs text-right text-muted-foreground">
                                      {new Date(
                                        chat.updated_at
                                      ).toLocaleDateString()}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ══════════════════ TABLE VIEW (Original) ══════════════════ */}
      {viewMode === "table" && (
        <>
          {/* Total Spend Card */}
          {totals && (
            <div className="bg-card border rounded-xl p-6 shadow-sm">
              <p className="text-sm text-muted-foreground mb-1">Total Spend</p>
              <p className="text-3xl font-bold text-primary">
                {formatCost(totals.cost_usd)}
              </p>
              <div className="flex gap-6 mt-3 text-sm text-muted-foreground">
                <span>Input: {formatTokenCount(totals.input_tokens)}</span>
                <span>Output: {formatTokenCount(totals.output_tokens)}</span>
                <span>
                  Total: {formatTokenCount(totals.total_tokens)} tokens
                </span>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <SortHeader label="Chat ID" field="chat_id" />
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Project
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Chat Title
                    </th>
                    <SortHeader label="Model" field="model" />
                    <SortHeader label="Input Tokens" field="input_tokens" />
                    <SortHeader label="Output Tokens" field="output_tokens" />
                    <SortHeader label="Total Tokens" field="total_tokens" />
                    <SortHeader label="Cost" field="cost_usd" />
                    <SortHeader label="Last Updated" field="updated_at" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedRows.map((row) => (
                    <tr
                      key={row.chat_id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-mono text-muted-foreground">
                        {row.chat_id.slice(0, 8)}...
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {chatInfoMap[row.chat_id]?.userName || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {chatInfoMap[row.chat_id]?.projectName || "—"}
                      </td>
                      <td
                        className="px-4 py-3 text-sm max-w-[200px] truncate"
                        title={chatInfoMap[row.chat_id]?.chatTitle}
                      >
                        {chatInfoMap[row.chat_id]?.chatTitle || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {formatModelName(row.model)}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {formatTokenCount(row.input_tokens)}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {formatTokenCount(row.output_tokens)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium tabular-nums">
                        {formatTokenCount(row.total_tokens)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium tabular-nums">
                        {formatCost(row.cost_usd)}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {new Date(row.updated_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {sortedRows.length === 0 && !loading && (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No usage data available
                      </td>
                    </tr>
                  )}
                </tbody>
                {totals && sortedRows.length > 0 && (
                  <tfoot className="bg-muted/30 border-t-2 font-medium">
                    <tr>
                      <td className="px-4 py-3 text-sm" colSpan={5}>
                        Totals
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {formatTokenCount(totals.input_tokens)}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {formatTokenCount(totals.output_tokens)}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {formatTokenCount(totals.total_tokens)}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums">
                        {formatCost(totals.cost_usd)}
                      </td>
                      <td className="px-4 py-3 text-sm"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-background border rounded px-2 py-1 text-sm"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span className="ml-4">
                  {totalCount === 0
                    ? "0 results"
                    : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} of ${totalCount.toLocaleString()}`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm px-3 text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
