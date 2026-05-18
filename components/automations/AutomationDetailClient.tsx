"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/switch";
import {
    Play,
    Square,
    Plus,
    Trash2,
    Loader2,
    Pencil,
    Save,
    X,
    MessageSquare,
} from "lucide-react";
import {
    createTask,
    deleteTask,
    getChatPhaseProgress,
    listTasks,
    renameAutomation,
    updateTask,
    type AutomationTask,
    type AutomationTaskStatus,
    type LivePhaseRow,
    type ProjectAutomation,
} from "@/lib/actions/automations";
import type { ProjectPhase } from "@/lib/actions/phases";
import { formatDistanceToNow } from "date-fns";

interface Props {
    projectId: string;
    automation: ProjectAutomation;
    initialTasks: AutomationTask[];
    initialPhases: ProjectPhase[];
    canEdit: boolean;
}

const STATUS_STYLES: Record<AutomationTaskStatus, string> = {
    pending: "bg-muted text-muted-foreground border-border",
    running: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    failed: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
    stopped: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
};

export function AutomationDetailClient({ projectId, automation, initialTasks, initialPhases, canEdit }: Props) {
    // Phases drive the per-phase columns. Sorted by position so columns line
    // up left-to-right with the pipeline execution order. Includes disabled
    // phases too — disabled phases don't run, so their cells will stay empty,
    // and that empty cell is itself meaningful signal.
    //
    // useMemo here is load-bearing: a fresh-array-every-render version of this
    // would invalidate the polling useEffect's deps on every render, which —
    // combined with the effect calling setState — caused an infinite render
    // loop (Maximum update depth exceeded).
    const orderedPhases = useMemo(
        () => [...initialPhases].sort((a, b) => a.position - b.position),
        [initialPhases]
    );
    const [tasks, setTasks] = useState<AutomationTask[]>(initialTasks);
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(automation.name || "");
    const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
    const [promptDraft, setPromptDraft] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [batchRunning, setBatchRunning] = useState(false);
    const [excludeAlreadyRan, setExcludeAlreadyRan] = useState(false);
    // Live progress for the active phase of each running task, keyed by task.id.
    const [liveProgress, setLiveProgress] = useState<Record<string, LivePhaseRow[]>>({});
    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const anyRunning = tasks.some(t => t.status === "running");

    // Poll for task status updates while any row is running. On each tick we
    // also fetch live progress (tool calls + streamed text) for the currently-
    // running phase of each running task so the active column updates live.
    useEffect(() => {
        if (!anyRunning) {
            if (pollTimer.current) {
                clearInterval(pollTimer.current);
                pollTimer.current = null;
            }
            // Drop stale live state once nothing is running anymore.
            // Guarded so we don't queue a re-render every time this branch
            // runs — an unconditional setState would re-trigger the effect
            // (since each {} is a new reference) and loop forever.
            setLiveProgress(prev => (Object.keys(prev).length === 0 ? prev : {}));
            return;
        }
        if (pollTimer.current) return;
        pollTimer.current = setInterval(async () => {
            const fresh = await listTasks(automation.id);
            setTasks(fresh);

            // For each task that's still running and has a chat + an active
            // phase, fetch that phase's progress in parallel.
            const running = fresh.filter(t => t.status === "running" && t.chat_id && t.last_phase_index);
            if (running.length === 0) {
                setLiveProgress({});
                return;
            }
            const entries = await Promise.all(running.map(async t => {
                // last_phase_index from the runner is the 1-based index; we
                // tag chat_messages with phase.position, which equals the
                // phase's slot. Pull from initialPhases to translate.
                const activePhase = orderedPhases[(t.last_phase_index ?? 1) - 1];
                if (!activePhase) return [t.id, []] as const;
                const rows = await getChatPhaseProgress(t.chat_id!, activePhase.position);
                return [t.id, rows] as const;
            }));
            setLiveProgress(Object.fromEntries(entries));
        }, 2000);
        return () => {
            if (pollTimer.current) {
                clearInterval(pollTimer.current);
                pollTimer.current = null;
            }
        };
    }, [anyRunning, automation.id, orderedPhases]);

    const refresh = async () => {
        const fresh = await listTasks(automation.id);
        setTasks(fresh);
    };

    // ── Name editing ──────────────────────────────────────────────────────
    const handleSaveName = async () => {
        const result = await renameAutomation(automation.id, nameDraft);
        if (!result.success) {
            alert(`Failed: ${result.error}`);
        } else {
            setEditingName(false);
        }
    };

    // ── Row CRUD ──────────────────────────────────────────────────────────
    const handleAddRow = async () => {
        const result = await createTask(automation.id, "");
        if (!result.success) {
            alert(`Failed: ${result.error}`);
            return;
        }
        // Use the row returned by the server action directly instead of
        // re-fetching the whole list — saves a roundtrip and the UI feels
        // instant.
        if (result.task) {
            setTasks(prev => [...prev, result.task!]);
            setEditingPromptId(result.task.id);
            setPromptDraft("");
        }
    };

    const handleDeleteRow = async (task: AutomationTask) => {
        if (!confirm("Delete this row?")) return;
        setBusyId(task.id);
        try {
            const result = await deleteTask(task.id);
            if (!result.success) alert(`Failed: ${result.error}`);
            await refresh();
        } finally {
            setBusyId(null);
        }
    };

    const handleToggleEnabled = async (task: AutomationTask, enabled: boolean) => {
        setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, enabled } : t)));
        const result = await updateTask(task.id, { enabled });
        if (!result.success) {
            alert(`Failed: ${result.error}`);
            await refresh();
        }
    };

    const handleEditPrompt = (task: AutomationTask) => {
        setEditingPromptId(task.id);
        setPromptDraft(task.prompt);
    };

    const handleSavePrompt = async (task: AutomationTask) => {
        const result = await updateTask(task.id, { prompt: promptDraft });
        if (!result.success) {
            alert(`Failed: ${result.error}`);
        } else {
            setEditingPromptId(null);
            await refresh();
        }
    };

    // ── Run / Stop ────────────────────────────────────────────────────────
    const runOne = async (taskId: string) => {
        await fetch(`/api/automations/tasks/${taskId}/run`, { method: "POST" });
        await refresh();
    };

    const stopOne = async (taskId: string) => {
        await fetch(`/api/automations/tasks/${taskId}/stop`, { method: "POST" });
        // Status flips to 'stopped' once the runner notices on its next poll.
        await refresh();
    };

    const handleRunRow = async (task: AutomationTask) => {
        if (!task.enabled) return;
        setBusyId(task.id);
        // Optimistic flip to 'running' so the button immediately becomes
        // Stop and the polling effect (gated on anyRunning) kicks in. The
        // server flips status='running' early too, so the next poll either
        // confirms our optimistic state or replaces it with real data.
        setTasks(prev => prev.map(t =>
            t.id === task.id
                ? { ...t, status: "running", last_phase_index: null, last_phase_total: null, last_phase_name: null, error: null }
                : t
        ));
        try {
            await runOne(task.id);
        } finally {
            setBusyId(null);
        }
    };

    const handleStopRow = async (task: AutomationTask) => {
        setBusyId(task.id);
        try {
            await stopOne(task.id);
        } finally {
            setBusyId(null);
        }
    };

    // Run all enabled rows one by one. Skips disabled rows always; skips
    // already-completed rows when the 'Exclude already-ran' toggle is on.
    const handleRunAll = async () => {
        if (batchRunning) return;
        const eligible = tasks.filter(t => {
            if (!t.enabled) return false;
            if (excludeAlreadyRan && t.status === "completed") return false;
            return true;
        });
        if (eligible.length === 0) {
            alert("No eligible rows to run. Check enabled rows and the exclude toggle.");
            return;
        }

        setBatchRunning(true);
        try {
            for (const task of eligible) {
                // Optimistic flip — see handleRunRow rationale.
                setTasks(prev => prev.map(t =>
                    t.id === task.id
                        ? { ...t, status: "running", last_phase_index: null, last_phase_total: null, last_phase_name: null, error: null }
                        : t
                ));
                // Fire run, then poll until the task is no longer 'running'
                // before moving to the next. This gives users sequential
                // execution as requested.
                await fetch(`/api/automations/tasks/${task.id}/run`, { method: "POST" });
                // Wait for status to flip from running to a terminal state.
                let settled = false;
                while (!settled) {
                    await new Promise(r => setTimeout(r, 2000));
                    const fresh = await listTasks(automation.id);
                    setTasks(fresh);
                    const current = fresh.find(t => t.id === task.id);
                    if (!current) { settled = true; break; }
                    if (current.status !== "running" && current.status !== "pending") {
                        settled = true;
                    }
                }
            }
        } finally {
            setBatchRunning(false);
            await refresh();
        }
    };

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    {editingName ? (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={nameDraft}
                                onChange={e => setNameDraft(e.target.value)}
                                className="text-2xl md:text-3xl font-serif font-medium bg-transparent border-b border-border focus:outline-none focus:border-primary flex-1"
                                autoFocus
                            />
                            <Button size="icon" variant="ghost" onClick={handleSaveName}><Save className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => { setEditingName(false); setNameDraft(automation.name || ""); }}><X className="h-4 w-4" /></Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl md:text-3xl font-serif font-medium tracking-tight text-foreground truncate">
                                {automation.name || "Untitled automation"}
                            </h1>
                            {canEdit && (
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => setEditingName(true)}>
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </div>
                    )}
                    {automation.description && (
                        <p className="text-sm text-muted-foreground mt-1">{automation.description}</p>
                    )}
                </div>
            </div>

            {/* Top controls */}
            <div className="flex flex-wrap items-center gap-3 border border-border rounded-lg p-3 bg-muted/20">
                <Button
                    onClick={handleRunAll}
                    disabled={!canEdit || batchRunning || tasks.length === 0}
                    className="gap-2"
                >
                    {batchRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Run all
                </Button>
                {canEdit && (
                    <Button onClick={handleAddRow} variant="outline" className="gap-2">
                        <Plus className="h-4 w-4" />
                        Add row
                    </Button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                    <Switch
                        size="sm"
                        checked={excludeAlreadyRan}
                        onCheckedChange={setExcludeAlreadyRan}
                    />
                    <label
                        className="text-xs text-muted-foreground cursor-pointer select-none"
                        onClick={() => setExcludeAlreadyRan(v => !v)}
                    >
                        Exclude already-ran rows
                    </label>
                </div>
            </div>

            {/* Tasks table */}
            {tasks.length === 0 ? (
                <div className="border border-dashed border-border/50 rounded-xl p-10 text-center text-muted-foreground">
                    No rows yet. {canEdit && "Click Add row to start."}
                </div>
            ) : (
                <div className="border border-border rounded-lg overflow-x-auto">
                    <table className="w-full text-sm min-w-[1200px]">
                        <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="px-2 py-2 w-10 text-center">On</th>
                                <th className="px-3 py-2 text-left w-64">Prompt</th>
                                {orderedPhases.map(p => (
                                    <th
                                        key={p.id}
                                        className="px-3 py-2 text-left w-72"
                                        title={p.model_id || undefined}
                                    >
                                        {p.name || `Phase ${p.position}`}
                                        {!p.enabled && (
                                            <span className="ml-1 text-[9px] text-muted-foreground/50">(off)</span>
                                        )}
                                    </th>
                                ))}
                                <th className="px-3 py-2 text-left w-28">Status</th>
                                <th className="px-3 py-2 text-left w-40">When</th>
                                <th className="px-3 py-2 text-left w-20">Chat</th>
                                <th className="px-3 py-2 text-right w-32">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                            {tasks.map(task => {
                                const isEditing = editingPromptId === task.id;
                                const isBusy = busyId === task.id;
                                const isRunning = task.status === "running";
                                const whenLabel = task.completed_at
                                    ? `${formatDistanceToNow(new Date(task.completed_at))} ago`
                                    : task.started_at
                                        ? `started ${formatDistanceToNow(new Date(task.started_at))} ago`
                                        : "—";

                                return (
                                    <tr key={task.id} className={!task.enabled ? "opacity-50" : ""}>
                                        <td className="px-2 py-2 text-center">
                                            <Switch
                                                size="sm"
                                                checked={task.enabled}
                                                onCheckedChange={(checked) => handleToggleEnabled(task, checked)}
                                                disabled={!canEdit || isRunning}
                                            />
                                        </td>
                                        <td className="px-3 py-2 align-top">
                                            {isEditing ? (
                                                <div className="flex flex-col gap-1">
                                                    <textarea
                                                        value={promptDraft}
                                                        onChange={e => setPromptDraft(e.target.value)}
                                                        className="w-full min-h-[60px] bg-muted/40 border border-border rounded px-2 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                                                        autoFocus
                                                    />
                                                    <div className="flex gap-1 justify-end">
                                                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setEditingPromptId(null)}>Cancel</Button>
                                                        <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => handleSavePrompt(task)}>Save</Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="text-left w-full hover:bg-muted/30 rounded px-1 py-1 -mx-1"
                                                    onClick={() => canEdit && handleEditPrompt(task)}
                                                >
                                                    {task.prompt
                                                        ? <span className="text-foreground/90 whitespace-pre-wrap">{task.prompt}</span>
                                                        : <span className="text-muted-foreground/50 italic">Click to add prompt…</span>}
                                                </button>
                                            )}
                                        </td>
                                        {orderedPhases.map(phase => {
                                            const output = task.phase_outputs?.find(
                                                o => o.phase_position === phase.position
                                            );
                                            const isActivePhase =
                                                isRunning && task.last_phase_index === phase.position;
                                            const live = isActivePhase ? (liveProgress[task.id] || []) : [];

                                            return (
                                                <td key={phase.id} className="px-3 py-2 align-top">
                                                    {output ? (
                                                        <details className="group max-w-[280px]">
                                                            <summary className="cursor-pointer text-xs text-foreground/90 leading-snug list-none">
                                                                <span className="line-clamp-3 group-open:line-clamp-none whitespace-pre-wrap">
                                                                    {output.content || <span className="text-muted-foreground/50 italic">(empty response)</span>}
                                                                </span>
                                                                {output.content && output.content.length > 140 && (
                                                                    <span className="text-[10px] text-primary/70 group-open:hidden ml-1">…more</span>
                                                                )}
                                                            </summary>
                                                        </details>
                                                    ) : isActivePhase ? (
                                                        <LivePhaseCell rows={live} />
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground/40">—</span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                        <td className="px-3 py-2 align-top">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLES[task.status]}`}>
                                                {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                                                {task.status}
                                            </span>
                                            {task.error && (
                                                <div className="text-[10px] text-rose-500 mt-1 line-clamp-2" title={task.error}>
                                                    {task.error}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                                            {whenLabel}
                                        </td>
                                        <td className="px-3 py-2 align-top">
                                            {task.chat_id ? (
                                                <Link
                                                    href={`/projects/${projectId}/chat/${task.chat_id}`}
                                                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                                    title="Open chat"
                                                >
                                                    <MessageSquare className="h-3 w-3" />
                                                    Open
                                                </Link>
                                            ) : (
                                                <span className="text-xs text-muted-foreground/40">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 align-top text-right">
                                            <div className="inline-flex items-center gap-1">
                                                {isRunning ? (
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-7 w-7 text-amber-600 hover:text-amber-700"
                                                        onClick={() => handleStopRow(task)}
                                                        disabled={isBusy}
                                                        title="Stop"
                                                    >
                                                        {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                                                        onClick={() => handleRunRow(task)}
                                                        disabled={!canEdit || isBusy || !task.enabled || batchRunning}
                                                        title={!task.enabled ? "Row disabled" : "Run this row"}
                                                    >
                                                        {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                                                    </Button>
                                                )}
                                                {canEdit && (
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                                        onClick={() => handleDeleteRow(task)}
                                                        disabled={isBusy || isRunning}
                                                        title="Delete row"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// Live preview for the actively-running phase column. Renders a compact
// stream of what's happened so far: tool calls, tool results, and any partial
// final/thinking text. Updated by the 2-second polling loop, so it'll feel
// slightly chunky but conveys progress clearly without us holding open a
// per-row SSE stream.
function LivePhaseCell({ rows }: { rows: LivePhaseRow[] }) {
    // Pull out the latest non-empty assistant text so we can show streamed
    // content as it grows. Skip "processing" placeholders.
    const latestText = [...rows]
        .reverse()
        .find(r =>
            (r.type === "final" || r.type === "message" || r.type === "thinking") &&
            r.content && r.content.trim() && r.content.trim() !== "processing"
        );
    const toolEvents = rows.filter(r => r.type === "tool_call" || r.type === "tool_result");

    return (
        <div className="space-y-1 max-w-[280px]">
            <div className="inline-flex items-center gap-1 text-[10px] text-sky-700 dark:text-sky-300">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                running…
            </div>

            {toolEvents.length > 0 && (
                <div className="space-y-0.5">
                    {toolEvents.slice(-4).map((ev, i) => (
                        <div key={`${ev.id}-${i}`} className="text-[10px] font-mono text-muted-foreground/80 leading-tight">
                            {ev.type === "tool_call" ? (
                                <span>
                                    <span className="text-emerald-700 dark:text-emerald-400">→</span>{" "}
                                    <span className="text-foreground/80">{ev.tool || "tool"}</span>
                                    {ev.args && (
                                        <span className="text-muted-foreground/60">
                                            ({(() => {
                                                try {
                                                    const s = typeof ev.args === "string" ? ev.args : JSON.stringify(ev.args);
                                                    return s.length > 50 ? s.slice(0, 50) + "…" : s;
                                                } catch { return ""; }
                                            })()})
                                        </span>
                                    )}
                                </span>
                            ) : (
                                <span>
                                    <span className="text-amber-700 dark:text-amber-400">←</span>{" "}
                                    <span className="text-muted-foreground/70 line-clamp-1">
                                        {(ev.content || "").slice(0, 80)}
                                    </span>
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {latestText?.content && (
                <div className="text-[11px] text-foreground/70 leading-snug line-clamp-3 whitespace-pre-wrap mt-1">
                    {latestText.content}
                </div>
            )}
        </div>
    );
}
