"use client";

import { useState, useTransition } from "react";
import {
    addTrackedOpp,
    removeTrackedOpp,
    runOppNow,
    getTrackedOpps,
    getReruns,
    getErrors,
    getOppRuns,
    getOppAnalysis,
    updateSweepPrompt,
    type TrackedOpp,
    type RerunRow,
    type OppRun,
    type OppAnalysis,
    type Delta,
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
    const [promptDraft, setPromptDraft] = useState(prompt);
    const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
    const [pending, startTransition] = useTransition();

    // Per-opp drill-in drawer (run history + analysis).
    const [drawerOpp, setDrawerOpp] = useState<TrackedOpp | null>(null);
    const [drawerRuns, setDrawerRuns] = useState<OppRun[]>([]);
    const [drawerAnalysis, setDrawerAnalysis] = useState<OppAnalysis>(null);
    const [drawerBusy, setDrawerBusy] = useState(false);

    function openDrawer(o: TrackedOpp) {
        setDrawerOpp(o);
        setDrawerRuns([]);
        setDrawerAnalysis(null);
        setDrawerBusy(true);
        (async () => {
            const [runs, analysis] = await Promise.all([
                getOppRuns(o.opp_id),
                getOppAnalysis(o.opp_id),
            ]);
            setDrawerRuns(runs);
            setDrawerAnalysis(analysis);
            setDrawerBusy(false);
        })();
    }

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
                                    <tr
                                        key={o.opp_id}
                                        onClick={() => openDrawer(o)}
                                        className="border-t hover:bg-muted/30 cursor-pointer"
                                        title="View run history & analysis"
                                    >
                                        <td className="px-3 py-2">
                                            <a
                                                href={`${SF_BASE}/${o.opp_id}/view`}
                                                target="_blank"
                                                rel="noreferrer"
                                                onClick={(e) => e.stopPropagation()}
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
                                                onClick={(e) => { e.stopPropagation(); onRun(o.opp_id); }}
                                                disabled={pending}
                                                className="px-2 py-1 text-xs rounded border mr-1 hover:bg-muted disabled:opacity-50"
                                            >
                                                Run now
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onRemove(o.opp_id, o.opp_name); }}
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
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                            The system prompt the per-opportunity sweep agent uses
                            (<code>app_config.deal_sweep_system_prompt</code>). Saved edits take
                            effect on the <b>next sweep</b> — no redeploy needed.
                        </p>
                        <div className="flex items-center gap-2">
                            {promptDraft !== prompt && (
                                <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>
                            )}
                            <button
                                onClick={() => setPromptDraft(prompt)}
                                disabled={pending || promptDraft === prompt}
                                className="px-3 py-1.5 rounded-md text-sm border disabled:opacity-50"
                            >
                                Reset
                            </button>
                            <button
                                onClick={() => {
                                    startTransition(async () => {
                                        const r = await updateSweepPrompt(promptDraft);
                                        if (r.success) flash("ok", "Sweep prompt saved. It applies on the next sweep.");
                                        else flash("err", r.error || "Save failed");
                                    });
                                }}
                                disabled={pending || promptDraft === prompt}
                                className="px-4 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
                            >
                                Save prompt
                            </button>
                        </div>
                    </div>
                    <textarea
                        value={promptDraft}
                        onChange={(e) => setPromptDraft(e.target.value)}
                        spellCheck={false}
                        placeholder="(prompt not found)"
                        className="w-full h-[60vh] font-mono text-xs bg-background border rounded-lg p-3"
                    />
                </div>
            )}

            {drawerOpp && (
                <OppDrawer
                    opp={drawerOpp}
                    runs={drawerRuns}
                    analysis={drawerAnalysis}
                    busy={drawerBusy}
                    onClose={() => setDrawerOpp(null)}
                    onRunNow={() => onRun(drawerOpp.opp_id)}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Right-side drawer: a deal's run history + the analysis the sweeps produced.
// Pick a run on the left to see exactly what THAT run changed (deltas tagged
// with the run's swept date), alongside the current verdict + recommended moves.
// ---------------------------------------------------------------------------
function OppDrawer({
    opp,
    runs,
    analysis,
    busy,
    onClose,
    onRunNow,
}: {
    opp: TrackedOpp;
    runs: OppRun[];
    analysis: OppAnalysis;
    busy: boolean;
    onClose: () => void;
    onRunNow: () => void;
}) {
    // Selected run → its swept date (YYYY-MM-DD) used to attribute deltas.
    const [selRunId, setSelRunId] = useState<string | null>(null);
    const selRun = runs.find((r) => r.created_at === selRunId) || null;
    const selDate = selRun ? selRun.created_at.slice(0, 10) : null;

    const deltas = analysis?.deltas ?? [];
    const runDeltas = selDate ? deltas.filter((d) => (d.date || "") === selDate) : [];

    return (
        <>
            <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
            <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[560px] bg-background border-l shadow-2xl flex flex-col">
                {/* header */}
                <div className="px-4 py-3 border-b flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="font-semibold truncate">{opp.opp_name || opp.opp_id}</div>
                        <div className="text-xs text-muted-foreground truncate">
                            {[opp.account_name, opp.owner_name, opp.stage, fmtMoney(opp.amount)]
                                .filter(Boolean)
                                .join(" · ")}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{opp.opp_id}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            onClick={onRunNow}
                            className="px-2 py-1 text-xs rounded border hover:bg-muted"
                            title="Trigger a fresh re-analysis"
                        >
                            Run now
                        </button>
                        <button
                            onClick={onClose}
                            className="px-2 py-1 text-sm rounded border hover:bg-muted"
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {busy ? (
                        <div className="p-6 text-sm text-muted-foreground">Loading run history…</div>
                    ) : (
                        <div className="flex flex-col">
                            {/* Latest analysis */}
                            <section className="px-4 py-3 border-b">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Latest analysis
                                    {analysis?.swept_at && (
                                        <span className="ml-2 normal-case font-normal">swept {analysis.swept_at}</span>
                                    )}
                                </div>
                                {!analysis ? (
                                    <p className="text-sm text-muted-foreground">No analysis on record yet.</p>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {analysis.verdict && (
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs px-2 py-0.5 rounded-full border ${verdictClass(analysis.verdict)}`}>
                                                    {analysis.verdict}
                                                </span>
                                                {analysis.analysis_confidence && (
                                                    <span className="text-xs text-muted-foreground">
                                                        confidence: {analysis.analysis_confidence}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {analysis.headline && (
                                            <p className="text-sm leading-snug">{analysis.headline}</p>
                                        )}
                                        {analysis.moves.length > 0 && (
                                            <div className="mt-1">
                                                <div className="text-xs font-medium mb-1">Recommended moves</div>
                                                <ol className="flex flex-col gap-1.5">
                                                    {analysis.moves.map((m, i) => (
                                                        <li key={i} className="text-sm">
                                                            <span className="text-muted-foreground mr-1">
                                                                {m.rank != null ? `#${m.rank}` : "•"}
                                                            </span>
                                                            {m.action || "—"}
                                                            {(m.owner || m.trigger || m.expected_effect) && (
                                                                <div className="text-[11px] text-muted-foreground ml-4">
                                                                    {m.owner && <>Owner: {m.owner}. </>}
                                                                    {m.trigger && <>Trigger: {m.trigger}{m.trigger_date ? ` (${m.trigger_date})` : ""}. </>}
                                                                    {m.expected_effect && <>Effect: {m.expected_effect}.</>}
                                                                </div>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ol>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>

                            {/* Run history */}
                            <section className="px-4 py-3 border-b">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Run history ({runs.length})
                                </div>
                                {runs.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No runs recorded for this opp yet.</p>
                                ) : (
                                    <ul className="flex flex-col gap-1">
                                        {runs.map((r) => {
                                            const active = r.created_at === selRunId;
                                            return (
                                                <li key={r.created_at}>
                                                    <button
                                                        onClick={() => setSelRunId(active ? null : r.created_at)}
                                                        className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                                                            active ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-sm">{fmtDate(r.created_at)}</span>
                                                            {statusPill(r.status)}
                                                        </div>
                                                        <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                                                            <span>{r.source || "—"}</span>
                                                            <span>{fmtDur(r.duration_ms)}</span>
                                                            {r.model && <span>{r.model}</span>}
                                                            {r.total_tokens != null && <span>{Number(r.total_tokens).toLocaleString()} tok</span>}
                                                            {r.cost_usd != null && <span>{fmtMoney(r.cost_usd)}</span>}
                                                        </div>
                                                        {r.error && (
                                                            <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 line-clamp-2">
                                                                {r.error}
                                                            </div>
                                                        )}
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </section>

                            {/* Per-run changes */}
                            <section className="px-4 py-3">
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    {selRun ? `Changes in this run (${runDeltas.length})` : "What changed"}
                                </div>
                                {!selRun ? (
                                    <p className="text-sm text-muted-foreground">
                                        Select a run above to see exactly what that re-analysis changed.
                                    </p>
                                ) : runDeltas.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        This run recorded no tracked changes (re-confirmed existing facts).
                                    </p>
                                ) : (
                                    <DeltaList deltas={runDeltas} />
                                )}
                            </section>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

function DeltaList({ deltas }: { deltas: Delta[] }) {
    return (
        <ul className="flex flex-col gap-1.5">
            {deltas.map((d, i) => (
                <li key={i} className="text-sm border rounded-md px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${deltaKindClass(d.kind)}`}>
                            {d.kind || "changed"}
                        </span>
                        <span className="text-xs text-muted-foreground">{d.type || ""}</span>
                        <span className="font-medium truncate">{d.subject || ""}</span>
                    </div>
                    {(d.from || d.to) && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                            {d.from && d.to && d.from !== d.to ? (
                                <><span className="line-through">{d.from}</span> → {d.to}</>
                            ) : (
                                d.to || d.from
                            )}
                        </div>
                    )}
                </li>
            ))}
        </ul>
    );
}

function verdictClass(v: string | null) {
    const k = (v || "").toLowerCase();
    if (k.includes("off")) return "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30";
    if (k.includes("risk")) return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
    return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
}
function deltaKindClass(k: string | null) {
    const s = (k || "").toLowerCase();
    if (s === "added") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    if (s === "resolved") return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
    if (s === "dormant") return "bg-muted text-muted-foreground border-border";
    return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
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
