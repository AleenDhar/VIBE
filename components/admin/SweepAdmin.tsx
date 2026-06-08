"use client";

import { useState, useTransition } from "react";
import {
    addTrackedOpp,
    removeTrackedOpp,
    runOppNow,
    getTrackedOpps,
    getReruns,
    getErrors,
    type TrackedOpp,
    type RerunRow,
} from "@/lib/actions/sweep";

const SF_BASE = "https://zycus.lightning.force.com/lightning/r/Opportunity";

type Tab = "tracked" | "reruns" | "errors" | "prompt";

function fmtDate(s: string | null) {
    if (!s) return "—";
    try {
        return new Date(s).toLocaleString(undefined, {
            year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
    } catch {
        return s;
    }
}
function fmtMoney(n: number | null) {
    if (n == null) return "—";
    return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtDur(ms: number | null) {
    if (ms == null) return "—";
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function statusPill(status: string | null) {
    const ok = status === "completed";
    const cls = ok
        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
        : "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30";
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${cls}`}>
            {status || "unknown"}
        </span>
    );
}

export function SweepAdmin({
    initialOpps,
    initialReruns,
    initialErrors,
    prompt,
}: {
    initialOpps: TrackedOpp[];
    initialReruns: RerunRow[];
    initialErrors: RerunRow[];
    prompt: string;
}) {
    const [tab, setTab] = useState<Tab>("tracked");
    const [opps, setOpps] = useState<TrackedOpp[]>(initialOpps);
    const [reruns, setReruns] = useState<RerunRow[]>(initialReruns);
    const [errors, setErrors] = useState<RerunRow[]>(initialErrors);
    const [search, setSearch] = useState("");
    const [addInput, setAddInput] = useState("");
    const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const [pending, startTransition] = useTransition();

    function flash(kind: "ok" | "err", text: string) {
        setMsg({ kind, text });
        setTimeout(() => setMsg(null), 5000);
    }

    function refreshOpps(s = search) {
        startTransition(async () => setOpps(await getTrackedOpps(s)));
    }
    function refreshReruns() {
        startTransition(async () => setReruns(await getReruns(150)));
    }
    function refreshErrors() {
        startTransition(async () => setErrors(await getErrors(100)));
    }

    function onAdd() {
        if (!addInput.trim()) return;
        startTransition(async () => {
            const r = await addTrackedOpp(addInput);
            if (r.success) {
                flash("ok", `Added ${r.opp_id} to the tracked list.`);
                setAddInput("");
                setOpps(await getTrackedOpps(search));
            } else {
                flash("err", r.error || "Add failed");
            }
        });
    }
    function onRemove(oppId: string, name: string | null) {
        if (!confirm(`Remove "${name || oppId}" from the tracked list? It will stop auto-triggering.`)) return;
        startTransition(async () => {
            const r = await removeTrackedOpp(oppId);
            if (r.success) {
                flash("ok", `Removed ${oppId}.`);
                setOpps(await getTrackedOpps(search));
            } else {
                flash("err", r.error || "Remove failed");
            }
        });
    }
    function onRun(oppId: string) {
        startTransition(async () => {
            const r = await runOppNow(oppId);
            if (r.success) flash("ok", `Re-analysis triggered for ${oppId} (runs in background).`);
            else flash("err", r.error || "Trigger failed");
        });
    }

    const tabs: { id: Tab; label: string; count?: number }[] = [
        { id: "tracked", label: "Tracked opps", count: opps.length },
        { id: "reruns", label: "Reruns", count: reruns.length },
        { id: "errors", label: "Errors", count: errors.length },
        { id: "prompt", label: "Sweep prompt" },
    ];

    return (
        <div className="flex flex-col gap-4">
            {/* tabs */}
            <div className="flex flex-wrap gap-2 border-b">
                {tabs.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                            tab === t.id
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {t.label}
                        {typeof t.count === "number" && (
                            <span className="ml-1.5 text-xs text-muted-foreground">({t.count})</span>
                        )}
                    </button>
                ))}
                {pending && <span className="self-center text-xs text-muted-foreground">working…</span>}
            </div>

            {msg && (
                <div
                    className={`text-sm rounded-md px-3 py-2 border ${
                        msg.kind === "ok"
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                            : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"
                    }`}
                >
                    {msg.text}
                </div>
            )}

            {/* TRACKED */}
            {tab === "tracked" && (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            value={addInput}
                            onChange={(e) => setAddInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && onAdd()}
                            placeholder="Add opp: paste a Salesforce Opportunity id (006…) or a Lightning URL"
                            className="flex-1 bg-background border rounded-md px-3 py-2 text-sm"
                        />
                        <button
                            onClick={onAdd}
                            disabled={pending}
                            className="px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
                        >
                            Add to tracked
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && refreshOpps()}
                            placeholder="Search name / account / owner / id…"
                            className="flex-1 bg-background border rounded-md px-3 py-2 text-sm"
                        />
                        <button onClick={() => refreshOpps()} className="px-3 py-2 rounded-md text-sm border">
                            Search
                        </button>
                    </div>

                    <div className="overflow-x-auto border rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2">Opportunity</th>
                                    <th className="px-3 py-2">Account</th>
                                    <th className="px-3 py-2">Owner</th>
                                    <th className="px-3 py-2">Stage</th>
                                    <th className="px-3 py-2">Amount</th>
                                    <th className="px-3 py-2">Swept</th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {opps.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                                            No tracked opportunities.
                                        </td>
                                    </tr>
                                )}
                                {opps.map((o) => (
                                    <tr key={o.opp_id} className="border-t hover:bg-muted/30">
                                        <td className="px-3 py-2">
                                            <a
                                                href={`${SF_BASE}/${o.opp_id}/view`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-primary hover:underline"
                                            >
                                                {o.opp_name || o.opp_id}
                                            </a>
                                            <div className="text-[11px] text-muted-foreground">{o.opp_id}</div>
                                        </td>
                                        <td className="px-3 py-2">{o.account_name || "—"}</td>
                                        <td className="px-3 py-2">{o.owner_name || "—"}</td>
                                        <td className="px-3 py-2">{o.stage || "—"}</td>
                                        <td className="px-3 py-2">{fmtMoney(o.amount)}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{o.swept_at || "—"}</td>
                                        <td className="px-3 py-2 text-right whitespace-nowrap">
                                            <button
                                                onClick={() => onRun(o.opp_id)}
                                                disabled={pending}
                                                className="px-2 py-1 text-xs rounded border mr-1 hover:bg-muted disabled:opacity-50"
                                            >
                                                Run now
                                            </button>
                                            <button
                                                onClick={() => onRemove(o.opp_id, o.opp_name)}
                                                disabled={pending}
                                                className="px-2 py-1 text-xs rounded border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                                            >
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* RERUNS */}
            {tab === "reruns" && (
                <RunTable rows={reruns} onRefresh={refreshReruns} showError={false} />
            )}

            {/* ERRORS */}
            {tab === "errors" && (
                <RunTable rows={errors} onRefresh={refreshErrors} showError={true} />
            )}

            {/* PROMPT */}
            {tab === "prompt" && (
                <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                        Read-only. This is the system prompt the per-opportunity sweep agent uses
                        (from <code>app_config.deal_sweep_system_prompt</code>). Editing from here can be
                        enabled later.
                    </p>
                    <textarea
                        readOnly
                        value={prompt || "(prompt not found)"}
                        className="w-full h-[60vh] font-mono text-xs bg-muted/30 border rounded-lg p-3"
                    />
                </div>
            )}
        </div>
    );
}

function RunTable({
    rows,
    onRefresh,
    showError,
}: {
    rows: RerunRow[];
    onRefresh: () => void;
    showError: boolean;
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-end">
                <button onClick={onRefresh} className="px-3 py-1.5 rounded-md text-sm border">
                    Refresh
                </button>
            </div>
            <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2">When</th>
                            <th className="px-3 py-2">Opportunity</th>
                            <th className="px-3 py-2">Source</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Duration</th>
                            <th className="px-3 py-2">Model</th>
                            <th className="px-3 py-2">Cost</th>
                            {showError && <th className="px-3 py-2">Error</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={showError ? 8 : 7} className="px-3 py-6 text-center text-muted-foreground">
                                    {showError ? "No errors 🎉" : "No runs yet."}
                                </td>
                            </tr>
                        )}
                        {rows.map((r, i) => (
                            <tr key={i} className="border-t hover:bg-muted/30 align-top">
                                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                                <td className="px-3 py-2">
                                    <a
                                        href={`${SF_BASE}/${r.opp_id}/view`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary hover:underline"
                                    >
                                        {r.opp_name || r.opp_id}
                                    </a>
                                </td>
                                <td className="px-3 py-2">{r.source || "—"}</td>
                                <td className="px-3 py-2">{statusPill(r.status)}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{fmtDur(r.duration_ms)}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{r.model || "—"}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{fmtMoney(r.cost_usd)}</td>
                                {showError && (
                                    <td className="px-3 py-2 text-xs text-red-600 dark:text-red-400 max-w-md">
                                        {r.error || "—"}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
