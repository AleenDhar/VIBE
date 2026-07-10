"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import {
    Radar,
    RefreshCw,
    Zap,
    Timer,
    Globe2,
    Inbox,
    CheckCircle2,
    XCircle,
    UserX,
    ExternalLink,
    CircleDot,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────
interface WatchConfig {
    report_id: string;
    region: string;
    geography: string;
    project_id: string;
    enabled: boolean;
    dry_run: boolean;
    max_dispatch: number;
}
interface WatchCursor {
    report_id: string;
    watermark: string;
    updated_at: string;
}
interface LogRow {
    mqlh_id: string;
    report_id: string;
    contact_name: string | null;
    account_name: string | null;
    bdr_email: string | null;
    campaign_type: string | null;
    mql_status: string | null;
    mql_score: number | null;
    mql_date_time: string | null;
    created_date: string | null;
    chat_id: string | null;
    status: string;
    error: string | null;
    dispatched_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────
const isCdc = (r: LogRow) => (r.error || "").toLowerCase().startsWith("cdc");
const timeAgo = (iso: string) => {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
};

const STATUS_META: Record<string, { label: string; cls: string; Icon: any }> = {
    dispatched: { label: "Dispatched", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 },
    dry_run: { label: "Dry run", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30", Icon: CircleDot },
    skipped_no_bdr: { label: "No BDR", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30", Icon: UserX },
    failed: { label: "Failed", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30", Icon: XCircle },
};

// ── Component ────────────────────────────────────────────────────────────
export default function MqlWatchPage() {
    const router = useRouter();
    const [authorized, setAuthorized] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);
    const [configs, setConfigs] = useState<WatchConfig[]>([]);
    const [cursors, setCursors] = useState<Record<string, WatchCursor>>({});
    const [rows, setRows] = useState<LogRow[]>([]);
    const [totals, setTotals] = useState({ total: 0, today: 0, instant: 0, failed: 0 });

    // Auth gate (admin / super_admin) — same pattern as the Usage dashboard.
    useEffect(() => {
        (async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return router.push("/");
            const { data: profile } = await supabase
                .from("profiles").select("role").eq("id", user.id).single();
            if (profile?.role !== "admin" && profile?.role !== "super_admin") return router.push("/");
            setAuthorized(true);
        })();
    }, [router]);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        const supabase = createClient();
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        try {
            const [cfgRes, curRes, logRes, totalRes, todayRes, instantRes, failedRes] = await Promise.all([
                supabase.from("sf_report_watch_config").select("*").order("region"),
                supabase.from("sf_report_watch_cursor").select("*"),
                supabase.from("sf_report_watch_log").select("*").order("dispatched_at", { ascending: false }).limit(200),
                supabase.from("sf_report_watch_log").select("*", { count: "exact", head: true }).eq("status", "dispatched"),
                supabase.from("sf_report_watch_log").select("*", { count: "exact", head: true }).eq("status", "dispatched").gte("dispatched_at", midnight.toISOString()),
                supabase.from("sf_report_watch_log").select("*", { count: "exact", head: true }).eq("status", "dispatched").ilike("error", "cdc%"),
                supabase.from("sf_report_watch_log").select("*", { count: "exact", head: true }).eq("status", "failed"),
            ]);
            setConfigs((cfgRes.data as WatchConfig[]) || []);
            const cur: Record<string, WatchCursor> = {};
            ((curRes.data as WatchCursor[]) || []).forEach((c) => { cur[c.report_id] = c; });
            setCursors(cur);
            setRows((logRes.data as LogRow[]) || []);
            setTotals({
                total: totalRes.count || 0,
                today: todayRes.count || 0,
                instant: instantRes.count || 0,
                failed: failedRes.count || 0,
            });
        } catch (e) {
            console.error("[MqlWatch] fetch error", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!authorized) return;
        fetchAll();
        // Live-refresh when a new dispatch lands.
        const supabase = createClient();
        const ch = supabase
            .channel("mql_watch")
            .on("postgres_changes", { event: "*", schema: "public", table: "sf_report_watch_log" }, () => fetchAll())
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [authorized, fetchAll]);

    const cfgByReport = useMemo(() => {
        const m: Record<string, WatchConfig> = {};
        configs.forEach((c) => { m[c.report_id] = c; });
        return m;
    }, [configs]);

    const chatHref = (r: LogRow) => {
        if (!r.chat_id) return null;
        const pid = cfgByReport[r.report_id]?.project_id;
        return pid ? `/projects/${pid}/chat/${r.chat_id}` : `/chat/${r.chat_id}`;
    };

    if (authorized === null) {
        return (
            <div className="flex h-full items-center justify-center">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }
    if (!authorized) return null;

    const pollShare = Math.max(0, totals.total - totals.instant);

    const tiles = [
        { label: "Total dispatched", value: totals.total, sub: "all time", Icon: Inbox, color: "text-primary", bg: "bg-primary/10" },
        { label: "Today", value: totals.today, sub: "since midnight", Icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
        { label: "Instant (CDC)", value: totals.instant, sub: `${pollShare} via 5-min poll`, Icon: Zap, color: "text-amber-500", bg: "bg-amber-500/10" },
        { label: "Failed", value: totals.failed, sub: "needs attention", Icon: XCircle, color: totals.failed ? "text-red-500" : "text-muted-foreground", bg: totals.failed ? "bg-red-500/10" : "bg-muted" },
    ];

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                        <Radar className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">MQL Watch</h1>
                        <p className="text-sm text-muted-foreground">
                            Salesforce MQL reports → VIBE projects. Instant (CDC) + 5-min poll, exactly-once.
                        </p>
                    </div>
                </div>
                <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                    Refresh
                </Button>
            </div>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {tiles.map((t) => (
                    <div key={t.label} className="bg-card border rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs uppercase tracking-wider text-muted-foreground">{t.label}</p>
                                <p className={`text-3xl font-bold tabular-nums mt-1 ${t.color}`}>{t.value.toLocaleString()}</p>
                                <p className="text-xs text-muted-foreground mt-1">{t.sub}</p>
                            </div>
                            <div className={`p-2 rounded-lg ${t.bg}`}>
                                <t.Icon className={`h-5 w-5 ${t.color}`} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Region status */}
            <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Regions</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {configs.length === 0 && (
                        <div className="bg-card border rounded-xl p-6 text-center text-muted-foreground md:col-span-3">
                            No watched reports configured.
                        </div>
                    )}
                    {configs.map((c) => {
                        const cur = cursors[c.report_id];
                        const count = rows.filter((r) => r.report_id === c.report_id && r.status === "dispatched").length;
                        return (
                            <div key={c.report_id} className="bg-card border rounded-xl p-5 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 rounded-md bg-primary/10">
                                            <Globe2 className="h-4 w-4 text-primary" />
                                        </div>
                                        <span className="font-semibold">{c.region}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {c.enabled ? (
                                            c.dry_run ? (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30">Dry run</span>
                                            ) : (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 font-semibold">Live</span>
                                            )
                                        ) : (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-muted text-muted-foreground">Disabled</span>
                                        )}
                                    </div>
                                </div>
                                <dl className="space-y-1.5 text-xs">
                                    <div className="flex justify-between"><dt className="text-muted-foreground">Geography</dt><dd className="font-medium">{c.geography}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">Project</dt><dd className="font-mono text-[11px]">{c.project_id.slice(0, 8)}…</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">Recent dispatched</dt><dd className="font-medium tabular-nums">{count}</dd></div>
                                    <div className="flex justify-between"><dt className="text-muted-foreground">Watermark</dt><dd className="font-medium">{cur ? timeAgo(cur.watermark) : "—"}</dd></div>
                                </dl>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Recent dispatches */}
            <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-5 py-3 border-b">
                    <h2 className="text-sm font-semibold">Recent activity</h2>
                    <span className="text-xs text-muted-foreground">latest {rows.length}</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-muted/50 border-b">
                            <tr>
                                {["When", "Region", "Contact", "Account", "BDR", "Via", "Status", "Chat"].map((h) => (
                                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {rows.map((r) => {
                                const sm = STATUS_META[r.status] || { label: r.status, cls: "bg-muted text-muted-foreground border-border", Icon: CircleDot };
                                const region = cfgByReport[r.report_id]?.region || r.report_id.slice(0, 6);
                                const href = chatHref(r);
                                return (
                                    <tr key={r.mqlh_id} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap" title={new Date(r.dispatched_at).toLocaleString()}>{timeAgo(r.dispatched_at)}</td>
                                        <td className="px-4 py-2.5 text-xs font-medium">{region}</td>
                                        <td className="px-4 py-2.5 text-sm max-w-[160px] truncate" title={r.contact_name || ""}>{r.contact_name || "—"}</td>
                                        <td className="px-4 py-2.5 text-sm max-w-[180px] truncate text-muted-foreground" title={r.account_name || ""}>{r.account_name || "—"}</td>
                                        <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate" title={r.bdr_email || ""}>{r.bdr_email || "—"}</td>
                                        <td className="px-4 py-2.5">
                                            {isCdc(r) ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"><Zap className="h-3 w-3" />Instant</span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30"><Timer className="h-3 w-3" />Poll</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${sm.cls}`}><sm.Icon className="h-3 w-3" />{sm.label}</span>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            {href ? (
                                                <Link href={href} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Open<ExternalLink className="h-3 w-3" /></Link>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {rows.length === 0 && !loading && (
                                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No MQLs captured yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
