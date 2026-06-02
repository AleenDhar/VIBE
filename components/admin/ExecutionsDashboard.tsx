"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  formatDuration,
  getStatusColor,
  getExecutionTypeConfig,
} from "@/lib/execution-utils";
import { Button } from "@/components/ui/Button";
import {
  Activity,
  RefreshCw,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Wand2,
  GitBranch,
  X,
  AlertTriangle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

interface Execution {
  execution_id: string;
  execution_type: "chat" | "automation" | "workflow";
  title: string;
  status: string;
  user_id: string | null;
  user_name: string;
  project_id: string | null;
  project_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  extra_metadata: Record<string, unknown> | null;
  total_rows: number;
}

interface ExecutionStats {
  total_count: number;
  running_count: number;
  completed_count: number;
  failed_count: number;
}

type SortKey = "execution_type" | "title" | "user_name" | "status" | "started_at";
type SortDir = "asc" | "desc";

// ── Component ──────────────────────────────────────────────────────────

export function ExecutionsDashboard() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Sorting & Pagination
  const [sortKey, setSortKey] = useState<SortKey>("started_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const router = useRouter();

  // ── Auth check ──
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
      if (profile?.role !== "super_admin") {
        router.push("/");
        return;
      }
      setAuthorized(true);
    }
    checkAuth();
  }, [router]);

  // ── Fetch data ──
  const fetchExecutions = useCallback(async () => {
    setLoading(true);
    const offset = (page - 1) * pageSize;
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
    });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);

    try {
      const res = await fetch(`/api/admin/executions?${params}`);
      if (!res.ok) throw new Error("Failed to fetch executions");
      const data = await res.json();
      setExecutions(data.executions || []);
      setStats(data.stats || null);
      setTotalCount(Number(data.total) || 0);
    } catch (err) {
      console.error("[ExecutionsDashboard] Error:", err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, typeFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (authorized) fetchExecutions();
  }, [authorized, fetchExecutions]);

  // ── Auto-refresh ──
  useEffect(() => {
    if (!autoRefresh || !authorized) return;
    const interval = setInterval(fetchExecutions, 10_000);
    return () => clearInterval(interval);
  }, [autoRefresh, authorized, fetchExecutions]);

  // ── Sorting ──
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedExecutions = [...executions].sort((a, b) => {
    const aVal = a[sortKey] ?? "";
    const bVal = b[sortKey] ?? "";
    if (sortKey === "started_at") {
      const aTime = aVal ? new Date(aVal as string).getTime() : 0;
      const bTime = bVal ? new Date(bVal as string).getTime() : 0;
      return sortDir === "asc" ? aTime - bTime : bTime - aTime;
    }
    const aStr = String(aVal);
    const bStr = String(bVal);
    return sortDir === "asc"
      ? aStr.localeCompare(bStr)
      : bStr.localeCompare(aStr);
  });

  // ── Pagination ──
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // ── Helpers ──
  const toggleExpanded = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setTypeFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const hasFilters =
    statusFilter !== "all" || typeFilter !== "all" || dateFrom || dateTo;

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "chat":
        return <MessageSquare className="h-3.5 w-3.5" />;
      case "automation":
        return <Wand2 className="h-3.5 w-3.5" />;
      case "workflow":
        return <GitBranch className="h-3.5 w-3.5" />;
      default:
        return <Activity className="h-3.5 w-3.5" />;
    }
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

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Executions</h1>
            <p className="text-sm text-muted-foreground">
              Track all agent runs across chats, automations, and workflows
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${
              autoRefresh
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-gray-400"
              }`}
            />
            Live
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchExecutions()}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-card border rounded-xl p-4 shadow-sm">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-2xl font-bold tabular-nums">
              {stats.total_count.toLocaleString()}
            </p>
          </div>
          <div className="bg-card border border-blue-500/20 rounded-xl p-4 shadow-sm">
            <p className="text-sm text-blue-600 dark:text-blue-400">Running</p>
            <p className="text-2xl font-bold tabular-nums text-blue-700 dark:text-blue-400">
              {stats.running_count.toLocaleString()}
            </p>
          </div>
          <div className="bg-card border border-emerald-500/20 rounded-xl p-4 shadow-sm">
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              Completed
            </p>
            <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {stats.completed_count.toLocaleString()}
            </p>
          </div>
          <div className="bg-card border border-red-500/20 rounded-xl p-4 shadow-sm">
            <p className="text-sm text-red-600 dark:text-red-400">Failed</p>
            <p className="text-2xl font-bold tabular-nums text-red-700 dark:text-red-400">
              {stats.failed_count.toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-card border rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* Status filter */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="bg-background border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="all">All</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
              <option value="stopped">Stopped</option>
            </select>
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Type
            </label>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className="bg-background border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="all">All</option>
              <option value="chat">Chat</option>
              <option value="automation">Automation</option>
              <option value="workflow">Workflow</option>
            </select>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="bg-background border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="bg-background border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50 border-b">
              <tr>
                <SortHeader label="Type" field="execution_type" />
                <SortHeader label="Title" field="title" />
                <SortHeader label="User" field="user_name" />
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Project
                </th>
                <SortHeader label="Status" field="status" />
                <SortHeader label="Started" field="started_at" />
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedExecutions.map((exec) => {
                const isExpanded = expandedRows.has(exec.execution_id);
                const typeConfig = getExecutionTypeConfig(exec.execution_type);
                const statusColor = getStatusColor(exec.status);

                return (
                  <Fragment key={exec.execution_id}>
                    <tr
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => toggleExpanded(exec.execution_id)}
                    >
                      {/* Type */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${typeConfig.color}`}
                        >
                          {getTypeIcon(exec.execution_type)}
                          {typeConfig.label}
                        </span>
                      </td>

                      {/* Title */}
                      <td
                        className="px-4 py-3 text-sm max-w-[250px] truncate"
                        title={exec.title}
                      >
                        {exec.title}
                      </td>

                      {/* User */}
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {exec.user_name || "—"}
                      </td>

                      {/* Project */}
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {exec.project_name || "—"}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${statusColor}`}
                        >
                          {exec.status === "running" && (
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                          )}
                          {exec.status}
                        </span>
                      </td>

                      {/* Started */}
                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                        {exec.started_at
                          ? new Date(exec.started_at).toLocaleString()
                          : "—"}
                      </td>

                      {/* Duration */}
                      <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                        {formatDuration(exec.started_at, exec.completed_at)}
                      </td>

                      {/* Expand toggle */}
                      <td className="px-4 py-3">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </td>
                    </tr>

                    {/* Expanded details row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="bg-muted/20 px-6 py-4">
                          <div className="space-y-2 text-sm">
                            {exec.error_message && (
                              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                                <div>
                                  <p className="font-medium text-red-700 dark:text-red-400">
                                    Error
                                  </p>
                                  <p className="text-red-600 dark:text-red-300 text-xs mt-1">
                                    {exec.error_message}
                                  </p>
                                </div>
                              </div>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                                  Execution ID
                                </p>
                                <p className="font-mono text-xs">
                                  {exec.execution_id.slice(0, 8)}...
                                </p>
                              </div>
                              {exec.started_at && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                                    Started
                                  </p>
                                  <p className="text-xs">
                                    {new Date(exec.started_at).toLocaleString()}
                                  </p>
                                </div>
                              )}
                              {exec.completed_at && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                                    Completed
                                  </p>
                                  <p className="text-xs">
                                    {new Date(
                                      exec.completed_at
                                    ).toLocaleString()}
                                  </p>
                                </div>
                              )}
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                                  Duration
                                </p>
                                <p className="text-xs font-medium">
                                  {formatDuration(
                                    exec.started_at,
                                    exec.completed_at
                                  )}
                                </p>
                              </div>
                            </div>

                            {/* Extra metadata */}
                            {exec.extra_metadata &&
                              Object.keys(exec.extra_metadata).length > 0 && (
                                <div className="mt-2 pt-2 border-t border-border/50">
                                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                                    Details
                                  </p>
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    {Object.entries(exec.extra_metadata).map(
                                      ([key, value]) => {
                                        if (
                                          value === null ||
                                          value === undefined
                                        )
                                          return null;
                                        return (
                                          <div key={key}>
                                            <p className="text-[10px] text-muted-foreground capitalize">
                                              {key.replace(/_/g, " ")}
                                            </p>
                                            <p
                                              className="text-xs truncate"
                                              title={String(value)}
                                            >
                                              {String(value)}
                                            </p>
                                          </div>
                                        );
                                      }
                                    )}
                                  </div>
                                </div>
                              )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {sortedExecutions.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    No executions found
                  </td>
                </tr>
              )}
            </tbody>
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
                : `${(page - 1) * pageSize + 1}\u2013${Math.min(page * pageSize, totalCount)} of ${totalCount.toLocaleString()}`}
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

