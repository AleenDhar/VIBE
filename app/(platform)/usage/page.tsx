"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatModelName, formatTokenCount, formatCost } from "@/lib/usage-utils";
import { Button } from "@/components/ui/Button";
import { RefreshCw, Coins, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

interface UsageRow {
  chat_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  updated_at: string;
}

interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

type SortKey = keyof UsageRow;
type SortDir = "asc" | "desc";

export default function UsagePage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const router = useRouter();

  // Auth check
  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
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

  useEffect(() => {
    if (authorized) fetchUsage(page, pageSize);
  }, [authorized, page, pageSize]);

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
    return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  });

  if (authorized === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authorized) return null;

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === field ? "text-foreground" : "opacity-40"}`} />
      </span>
    </th>
  );

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
            <p className="text-sm text-muted-foreground">Token usage and costs across all chats</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchUsage()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Total Spend Card */}
      {totals && (
        <div className="bg-card border rounded-xl p-6 shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">Total Spend</p>
          <p className="text-3xl font-bold text-primary">{formatCost(totals.cost_usd)}</p>
          <div className="flex gap-6 mt-3 text-sm text-muted-foreground">
            <span>Input: {formatTokenCount(totals.input_tokens)}</span>
            <span>Output: {formatTokenCount(totals.output_tokens)}</span>
            <span>Total: {formatTokenCount(totals.total_tokens)} tokens</span>
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
                <tr key={row.chat_id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-muted-foreground">
                    {row.chat_id.slice(0, 8)}...
                  </td>
                  <td className="px-4 py-3 text-sm">{formatModelName(row.model)}</td>
                  <td className="px-4 py-3 text-sm tabular-nums">{formatTokenCount(row.input_tokens)}</td>
                  <td className="px-4 py-3 text-sm tabular-nums">{formatTokenCount(row.output_tokens)}</td>
                  <td className="px-4 py-3 text-sm font-medium tabular-nums">{formatTokenCount(row.total_tokens)}</td>
                  <td className="px-4 py-3 text-sm font-medium tabular-nums">{formatCost(row.cost_usd)}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {new Date(row.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
              {sortedRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No usage data available
                  </td>
                </tr>
              )}
            </tbody>
            {totals && sortedRows.length > 0 && (
              <tfoot className="bg-muted/30 border-t-2 font-medium">
                <tr>
                  <td className="px-4 py-3 text-sm" colSpan={2}>Totals</td>
                  <td className="px-4 py-3 text-sm tabular-nums">{formatTokenCount(totals.input_tokens)}</td>
                  <td className="px-4 py-3 text-sm tabular-nums">{formatTokenCount(totals.output_tokens)}</td>
                  <td className="px-4 py-3 text-sm tabular-nums">{formatTokenCount(totals.total_tokens)}</td>
                  <td className="px-4 py-3 text-sm tabular-nums">{formatCost(totals.cost_usd)}</td>
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
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="bg-background border rounded px-2 py-1 text-sm"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="ml-4">
              {totalCount === 0 ? "0 results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} of ${totalCount.toLocaleString()}`}
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
    </div>
  );
}
