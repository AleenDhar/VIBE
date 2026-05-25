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
    FileSpreadsheet,
    Download,
    Maximize2,
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import {
    createTask,
    deleteTask,
    getChatPhaseProgress,
    listTasks,
    renameAutomation,
    updateAutomation,
    updateTask,
    type AutomationTask,
    type AutomationTaskStatus,
    type LivePhaseRow,
    type ProjectAutomation,
} from "@/lib/actions/automations";
import type { ProjectPhase } from "@/lib/actions/phases";
import { updatePhase } from "@/lib/actions/phases";
import { getActiveModels, getUserAllowedModels, type AIModel } from "@/lib/actions/models";
import { formatModelName } from "@/lib/usage-utils";
import { createClient } from "@/lib/supabase/client";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { extractPlaceholders } from "@/lib/automations/template";
import { CsvUploadDialog } from "./CsvUploadDialog";
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
    // Local copy of phases so column-header edits can update in place
    // without a full page refresh. Initialized from server props.
    const [phases, setPhases] = useState<ProjectPhase[]>(initialPhases);
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
        () => [...phases].sort((a, b) => a.position - b.position),
        [phases]
    );

    // Phase-editor modal state. Click on a column header opens this; user
    // can rename the phase, change its model, and edit the system prompt
    // without leaving the automations page.
    const [editingPhase, setEditingPhase] = useState<ProjectPhase | null>(null);
    const [phaseDraft, setPhaseDraft] = useState<{
        name: string;
        model_id: string | null;
        system_prompt: string;
    }>({ name: "", model_id: null, system_prompt: "" });
    const [savingPhase, setSavingPhase] = useState(false);
    const [availableModels, setAvailableModels] = useState<AIModel[]>([]);

    // Load models the current user is allowed to use, same logic as PhasesCard.
    useEffect(() => {
        const supabase = createClient();
        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const [models, allowed] = await Promise.all([
                    getActiveModels(),
                    getUserAllowedModels(user.id),
                ]);
                setAvailableModels(
                    models.filter(m => m.is_available_to_all || allowed.includes(m.id))
                );
            } catch (e) {
                console.error("AutomationDetailClient: failed to load models", e);
            }
        })();
    }, []);

    const modelNameFor = (id: string | null) =>
        id ? (availableModels.find(m => m.id === id)?.name || id) : "No model";

    const openPhaseEditor = (phase: ProjectPhase) => {
        if (!canEdit) return;
        setEditingPhase(phase);
        setPhaseDraft({
            name: phase.name || "",
            model_id: phase.model_id,
            system_prompt: phase.system_prompt || "",
        });
    };

    const handleSavePhase = async () => {
        if (!editingPhase) return;
        setSavingPhase(true);
        try {
            const result = await updatePhase(editingPhase.id, {
                name: phaseDraft.name.trim() || null,
                model_id: phaseDraft.model_id,
                system_prompt: phaseDraft.system_prompt,
            });
            if (!result.success) {
                alert(`Failed: ${result.error}`);
                return;
            }
            // Mirror to local state so the column updates immediately.
            setPhases(prev => prev.map(p =>
                p.id === editingPhase.id
                    ? {
                        ...p,
                        name: phaseDraft.name.trim() || null,
                        model_id: phaseDraft.model_id,
                        system_prompt: phaseDraft.system_prompt,
                    }
                    : p
            ));
            setEditingPhase(null);
        } finally {
            setSavingPhase(false);
        }
    };
    const [tasks, setTasks] = useState<AutomationTask[]>(initialTasks);
    const [automationName, setAutomationName] = useState(automation.name || "");
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState(automation.name || "");
    const [promptTemplate, setPromptTemplate] = useState(automation.prompt_template || "");
    const [editingTemplate, setEditingTemplate] = useState(false);
    const [templateDraft, setTemplateDraft] = useState(automation.prompt_template || "");
    const [savingTemplate, setSavingTemplate] = useState(false);
    const [csvOpen, setCsvOpen] = useState(false);
    const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
    const [promptDraft, setPromptDraft] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [batchRunning, setBatchRunning] = useState(false);
    const [excludeAlreadyRan, setExcludeAlreadyRan] = useState(false);
    // Live progress for the active phase of each running task, keyed by task.id.
    const [liveProgress, setLiveProgress] = useState<Record<string, LivePhaseRow[]>>({});
    // When set, opens a modal showing the full phase output rendered through
    // the same markdown parser the chat uses (tables, headers, lists, etc.).
    const [openOutput, setOpenOutput] = useState<{
        taskPrompt: string;
        phaseTitle: string;
        phaseSubtitle: string | null;
        content: string;
    } | null>(null);
    // chatId -> total cost in USD. The agent server only tracks cost per
    // chat, not per phase or message, so we fetch the chat total and
    // allocate proportionally across phases by output content length.
    const [chatCosts, setChatCosts] = useState<Record<string, number>>({});
    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    // Fetch chat cost for every task that has a chat_id. Refetches when
    // tasks change (new chats appear / reruns happen). Batched to avoid
    // hammering the agent server.
    useEffect(() => {
        const chatIds = Array.from(new Set(
            tasks.filter(t => t.chat_id).map(t => t.chat_id as string)
        ));
        if (chatIds.length === 0) return;

        let cancelled = false;
        (async () => {
            const results = await Promise.all(chatIds.map(async (id) => {
                try {
                    const res = await fetch(`/api/usage/${id}`);
                    if (!res.ok) return [id, 0] as const;
                    const body = await res.json();
                    const cost = Number(body?.usage?.cost_usd) || 0;
                    return [id, cost] as const;
                } catch {
                    return [id, 0] as const;
                }
            }));
            if (cancelled) return;
            setChatCosts(prev => {
                const next = { ...prev };
                for (const [id, cost] of results) next[id] = cost;
                return next;
            });
        })();

        return () => { cancelled = true; };
        // Stringify chat_id + status so we refetch when a row completes /
        // gets a fresh chat. (status changes when a phase finishes.)
    }, [tasks.map(t => `${t.chat_id ?? ""}:${t.status}`).join("|")]);

    const templatePlaceholders = useMemo(
        () => extractPlaceholders(promptTemplate),
        [promptTemplate]
    );

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
            setAutomationName(nameDraft.trim() || "Untitled automation");
            setEditingName(false);
        }
    };

    // ── Prompt template ──────────────────────────────────────────────────
    const handleSaveTemplate = async () => {
        setSavingTemplate(true);
        try {
            const result = await updateAutomation(automation.id, {
                prompt_template: templateDraft,
            });
            if (!result.success) {
                alert(`Failed: ${result.error}`);
            } else {
                setPromptTemplate(templateDraft.trim());
                setEditingTemplate(false);
            }
        } finally {
            setSavingTemplate(false);
        }
    };

    const handleCsvUploaded = async ({ inserted, skipped }: { inserted: number; skipped: number }) => {
        await refresh();
        const msg =
            skipped > 0
                ? `Added ${inserted} rows (${skipped} skipped — missing placeholder values).`
                : `Added ${inserted} rows.`;
        // Lightweight non-blocking feedback. alert() is what the rest of this
        // component uses for status, so stay consistent.
        alert(msg);
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

    // Export every row's full run detail to CSV: prompt, per-row variable
    // values, the full output of each phase, plus status/timestamps and
    // per-phase + total cost/token metadata. Built entirely from the in-memory
    // `tasks` state — no extra fetch. xlsx's sheet_to_csv gives RFC-4180
    // quoting for free, so multi-line markdown outputs survive intact.
    const handleExport = async () => {
        if (tasks.length === 0) return;
        const XLSX = await import("xlsx");

        // Variable columns: prefer the template's placeholders (stable order);
        // fall back to the union of keys actually present on the rows.
        const varKeys =
            templatePlaceholders.length > 0
                ? templatePlaceholders
                : Array.from(new Set(tasks.flatMap(t => Object.keys(t.variables ?? {}))));

        const header = [
            "#",
            "Prompt",
            ...varKeys,
            ...orderedPhases.flatMap(p => {
                const label = p.name || `Phase ${p.position}`;
                return [label, `${label} — Cost (USD)`, `${label} — Tokens`];
            }),
            "Status",
            "Started",
            "Completed",
            "Total Cost (USD)",
            "Total Tokens",
            "Chat ID",
            "Error",
        ];

        const rows = tasks.map((t, i) => {
            const outs = t.phase_outputs ?? [];
            const totalCost = outs.reduce((s, o) => s + (o.cost_usd ?? 0), 0);
            const totalTokens = outs.reduce((s, o) => s + (o.total_tokens ?? 0), 0);
            return [
                i + 1,
                t.prompt ?? "",
                ...varKeys.map(k => t.variables?.[k] ?? ""),
                ...orderedPhases.flatMap(p => {
                    const o = outs.find(x => x.phase_position === p.position);
                    return [
                        o?.content ?? "",
                        o?.cost_usd != null ? o.cost_usd : "",
                        o?.total_tokens != null ? o.total_tokens : "",
                    ];
                }),
                t.status,
                t.started_at ?? "",
                t.completed_at ?? "",
                totalCost ? Number(totalCost.toFixed(6)) : "",
                totalTokens || "",
                t.chat_id ?? "",
                t.error ?? "",
            ];
        });

        const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
        const csv = XLSX.utils.sheet_to_csv(ws);
        // Prepend a UTF-8 BOM so Excel detects the encoding and renders
        // non-ASCII characters (em-dashes, accented names) correctly. Build it
        // from the code point at runtime — a literal U+FEFF in source gets
        // stripped by the bundler as insignificant whitespace.
        const bom = String.fromCharCode(0xfeff);
        const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const safeName = (automation.name || "automation").replace(/[^a-z0-9_-]+/gi, "_");
        const date = new Date().toISOString().slice(0, 10);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}-export-${date}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
        // The route polls the task row until chat_id appears, so the response
        // body's chatId lands within a few hundred ms of the click. Patch it
        // straight into local state so the Chat column's Open link shows up
        // immediately — don't wait for the next 2s poll tick.
        try {
            const res = await fetch(`/api/automations/tasks/${taskId}/run`, { method: "POST" });
            if (res.ok) {
                const body = await res.json();
                if (body?.chatId) {
                    setTasks(prev => prev.map(t =>
                        t.id === taskId ? { ...t, chat_id: body.chatId } : t
                    ));
                }
            }
        } finally {
            await refresh();
        }
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

    // Per-cell rerun. Reruns the target phase AND every phase after it,
    // reusing the task's existing chat. Outputs for phases < target stay;
    // outputs for phases >= target are wiped and regenerated. Optimistic
    // local update mirrors that — the column for the target and any later
    // phases reverts to running/empty until the rerun fills them in.
    const handleRerunPhase = async (task: AutomationTask, phasePosition: number) => {
        if (!task.chat_id) {
            alert("No chat associated with this row — run the full pipeline first.");
            return;
        }
        setTasks(prev => prev.map(t => {
            if (t.id !== task.id) return t;
            return {
                ...t,
                status: "running",
                last_phase_index: phasePosition,
                last_phase_name: null,
                error: null,
                phase_outputs: (t.phase_outputs || []).filter(
                    o => o.phase_position < phasePosition
                ),
            };
        }));
        try {
            await fetch(
                `/api/automations/tasks/${task.id}/phases/${phasePosition}/run`,
                { method: "POST" }
            );
        } finally {
            await refresh();
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
                                {automationName || "Untitled automation"}
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

            {/* Prompt template editor */}
            <div className="border border-border rounded-lg p-3 bg-muted/10">
                <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Prompt template
                    </div>
                    {canEdit && !editingTemplate && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs gap-1"
                            onClick={() => {
                                setTemplateDraft(promptTemplate);
                                setEditingTemplate(true);
                            }}
                        >
                            <Pencil className="h-3 w-3" />
                            {promptTemplate ? "Edit" : "Add"}
                        </Button>
                    )}
                </div>
                {editingTemplate ? (
                    <div className="space-y-2">
                        <textarea
                            value={templateDraft}
                            onChange={(e) => setTemplateDraft(e.target.value)}
                            placeholder={"e.g. Diagnose account {{account_id}} for campaign {{campaign_id}}, owned by BDR {{bdr_id}}."}
                            className="w-full min-h-[80px] bg-background border border-border rounded px-2 py-1.5 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                            autoFocus
                        />
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] text-muted-foreground">
                                Use{" "}
                                <code className="px-1 py-0.5 rounded bg-muted text-foreground/80">{"{{name}}"}</code>{" "}
                                for slots filled by CSV columns.
                            </div>
                            <div className="flex gap-1">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                        setEditingTemplate(false);
                                        setTemplateDraft(promptTemplate);
                                    }}
                                    disabled={savingTemplate}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    className="h-7 px-2 text-xs gap-1"
                                    onClick={handleSaveTemplate}
                                    disabled={savingTemplate}
                                >
                                    {savingTemplate ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                    Save
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : promptTemplate ? (
                    <div className="space-y-2">
                        <div className="text-sm whitespace-pre-wrap text-foreground/90">{promptTemplate}</div>
                        {templatePlaceholders.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {templatePlaceholders.map((p) => (
                                    <code
                                        key={p}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20"
                                    >
                                        {`{{${p}}}`}
                                    </code>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground italic">
                        No template set. Add one like{" "}
                        <code className="px-1 py-0.5 rounded bg-muted not-italic text-foreground/70">
                            Diagnose {"{{account_id}}"} for {"{{campaign_id}}"}
                        </code>{" "}
                        to enable CSV upload.
                    </div>
                )}
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
                {canEdit && (
                    <Button
                        onClick={() => setCsvOpen(true)}
                        variant="outline"
                        className="gap-2"
                        title={
                            templatePlaceholders.length === 0
                                ? "Set a prompt template first"
                                : "Upload a CSV to add rows"
                        }
                    >
                        <FileSpreadsheet className="h-4 w-4" />
                        Upload CSV
                    </Button>
                )}
                <Button
                    onClick={handleExport}
                    variant="outline"
                    className="gap-2"
                    disabled={tasks.length === 0}
                    title="Export all rows and their phase outputs to CSV"
                >
                    <Download className="h-4 w-4" />
                    Export
                </Button>
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
                                    <th key={p.id} className="px-3 py-2 text-left w-72">
                                        <button
                                            type="button"
                                            onClick={() => openPhaseEditor(p)}
                                            className="text-left hover:text-foreground transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-default"
                                            disabled={!canEdit}
                                            title={canEdit
                                                ? `Click to edit ${p.name || `Phase ${p.position}`}`
                                                : (p.model_id || undefined)}
                                        >
                                            {canEdit && <Pencil className="h-2.5 w-2.5 opacity-40" />}
                                            <span>{p.name || `Phase ${p.position}`}</span>
                                            {!p.enabled && (
                                                <span className="ml-1 text-[9px] text-muted-foreground/50">(off)</span>
                                            )}
                                        </button>
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
                                        {/* Total content length across the task's phase_outputs.
                                            Used to allocate the chat's total cost across phases
                                            proportionally (best estimate we can do without per-
                                            phase token billing from the agent server). */}
                                        {(() => null)()}
                                        {orderedPhases.map(phase => {
                                            const output = task.phase_outputs?.find(
                                                o => o.phase_position === phase.position
                                            );
                                            const isActivePhase =
                                                isRunning && task.last_phase_index === phase.position;
                                            const live = isActivePhase ? (liveProgress[task.id] || []) : [];
                                            // Per-cell rerun is allowed only when the row isn't
                                            // currently running AND the task has a chat (i.e., the
                                            // full pipeline has run at least once). Without a chat
                                            // there's nothing to rerun against.
                                            const canRerun = canEdit && !isRunning && !!task.chat_id;
                                            // Real per-phase cost + tokens from the Replit
                                            // orchestrator (chat_usage deltas, not an estimate).
                                            // Fall back to no badge if missing (old rows
                                            // pre-dating the backend change).
                                            const phaseCost = typeof output?.cost_usd === "number" ? output.cost_usd : null;
                                            const phaseTokens = typeof output?.total_tokens === "number" ? output.total_tokens : null;

                                            return (
                                                <td
                                                    key={phase.id}
                                                    className="px-3 py-2 align-top max-w-[280px] w-[280px] overflow-hidden"
                                                >
                                                    <div className="flex items-start gap-1.5">
                                                        <div className="flex-1 min-w-0">
                                                            {output ? (
                                                                <button
                                                                    type="button"
                                                                    className="text-left w-full group hover:bg-muted/30 rounded -mx-1 px-1 py-0.5 block"
                                                                    onClick={() => setOpenOutput({
                                                                        taskPrompt: task.prompt,
                                                                        phaseTitle: `Phase ${phase.position}${phase.name ? ` — ${phase.name}` : ""}`,
                                                                        phaseSubtitle: phase.model_id || null,
                                                                        content: output.content,
                                                                    })}
                                                                    title="Click to open full output"
                                                                >
                                                                    {output.content ? (
                                                                        <div className="text-xs text-foreground/90 leading-snug line-clamp-5 whitespace-pre-wrap break-words">
                                                                            {output.content}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-xs text-muted-foreground/50 italic">(empty response)</div>
                                                                    )}
                                                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                                        <div className="text-[10px] text-primary/70 inline-flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                                                            <Maximize2 className="h-2.5 w-2.5" />
                                                                            more
                                                                        </div>
                                                                        {output.phase_model_id && (
                                                                            <span
                                                                                className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                                                                                    output.phase_model_id === phase.model_id
                                                                                        ? "text-muted-foreground/70 bg-muted/50"
                                                                                        : "text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30"
                                                                                }`}
                                                                                title={
                                                                                    output.phase_model_id === phase.model_id
                                                                                        ? `Ran with ${output.phase_model_id}`
                                                                                        : `Ran with ${output.phase_model_id} (phase is now configured for ${phase.model_id || "no model"}). Re-run to use the current model.`
                                                                                }
                                                                            >
                                                                                {formatModelName(output.phase_model_id)}
                                                                            </span>
                                                                        )}
                                                                        {phaseCost !== null && (
                                                                            <span
                                                                                className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono"
                                                                                title={
                                                                                    phaseTokens !== null
                                                                                        ? `Real per-phase cost (chat_usage delta) — ${phaseTokens.toLocaleString()} tokens`
                                                                                        : "Real per-phase cost (chat_usage delta)"
                                                                                }
                                                                            >
                                                                                ${phaseCost.toFixed(4)}
                                                                            </span>
                                                                        )}
                                                                        {phaseTokens !== null && (
                                                                            <span
                                                                                className="text-[10px] text-muted-foreground/60 font-mono"
                                                                                title={`${phaseTokens.toLocaleString()} tokens (input + output) for this phase`}
                                                                            >
                                                                                {phaseTokens >= 1000
                                                                                    ? `${(phaseTokens / 1000).toFixed(1)}k tok`
                                                                                    : `${phaseTokens} tok`}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </button>
                                                            ) : isActivePhase ? (
                                                                <LivePhaseCell rows={live} />
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground/40">—</span>
                                                            )}
                                                        </div>
                                                        {canRerun && (
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-6 w-6 shrink-0 text-emerald-600 hover:text-emerald-700"
                                                                onClick={() => handleRerunPhase(task, phase.position)}
                                                                title={`Re-run ${phase.name || `Phase ${phase.position}`}`}
                                                            >
                                                                <Play className="h-3 w-3" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                        <td className="px-3 py-2 align-top">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLES[task.status]}`}>
                                                {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                                                {task.status}
                                            </span>
                                            {task.error && (
                                                <details className="mt-1 group">
                                                    <summary className="text-[10px] text-rose-500 cursor-pointer line-clamp-2 group-open:line-clamp-none whitespace-pre-wrap break-words">
                                                        {task.error}
                                                    </summary>
                                                    <pre className="text-[10px] text-rose-400/80 whitespace-pre-wrap break-words mt-1 bg-rose-500/5 border border-rose-500/20 rounded p-2 max-h-64 overflow-y-auto font-mono">
                                                        {task.error}
                                                    </pre>
                                                </details>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                                            <div>{whenLabel}</div>
                                            {/* Total run cost — the chat's real cost from the
                                                agent server, NOT an estimate. Per-cell numbers
                                                are estimates that should sum to roughly this. */}
                                            {task.chat_id && chatCosts[task.chat_id] !== undefined && (
                                                <div
                                                    className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono mt-0.5"
                                                    title="Total cost for this row (sum of all phase API calls)"
                                                >
                                                    ${chatCosts[task.chat_id].toFixed(4)}
                                                </div>
                                            )}
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
                                                        disabled={isBusy}
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

            <CsvUploadDialog
                open={csvOpen}
                onOpenChange={setCsvOpen}
                automationId={automation.id}
                promptTemplate={promptTemplate || null}
                onUploaded={handleCsvUploaded}
            />

            {/* Full-output dialog — renders a single phase's output through
                the chat's markdown parser so tables/headers/lists look
                identical to how they appear inside the chat itself. */}
            {/* Phase editor dialog — edits the project_phases row, so changes
                affect every chat that uses this project's pipeline. */}
            <Dialog open={!!editingPhase} onOpenChange={(open) => !open && setEditingPhase(null)}>
                <DialogContent className="!max-w-4xl w-[90vw] max-h-[90vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                            Edit {editingPhase ? `Phase ${editingPhase.position}` : "phase"}
                        </DialogTitle>
                    </DialogHeader>
                    {editingPhase && (
                        <div className="flex-1 overflow-y-auto space-y-4 px-1">
                            <div>
                                <label className="text-[10px] uppercase tracking-wide text-muted-foreground/60 block mb-1">
                                    Name
                                </label>
                                <input
                                    type="text"
                                    value={phaseDraft.name}
                                    onChange={(e) => setPhaseDraft(d => ({ ...d, name: e.target.value }))}
                                    placeholder={`Phase ${editingPhase.position}`}
                                    className="w-full bg-muted/40 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>

                            <div>
                                <label className="text-[10px] uppercase tracking-wide text-muted-foreground/60 block mb-1">
                                    Model
                                </label>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            className="h-9 w-full justify-between text-sm border border-border bg-muted/40 font-normal"
                                        >
                                            <span className="truncate">{modelNameFor(phaseDraft.model_id)}</span>
                                            <ChevronDown className="h-3.5 w-3.5 shrink-0 ml-1" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto w-[var(--radix-dropdown-menu-trigger-width)]">
                                        {availableModels.length === 0 ? (
                                            <DropdownMenuItem disabled>No models available</DropdownMenuItem>
                                        ) : (
                                            availableModels.map(m => (
                                                <DropdownMenuItem
                                                    key={m.id}
                                                    onClick={() => setPhaseDraft(d => ({ ...d, model_id: m.id }))}
                                                >
                                                    {m.name}
                                                    <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono">{m.id}</span>
                                                </DropdownMenuItem>
                                            ))
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>

                            <div>
                                <label className="text-[10px] uppercase tracking-wide text-muted-foreground/60 block mb-1">
                                    System prompt
                                </label>
                                <textarea
                                    value={phaseDraft.system_prompt}
                                    onChange={(e) => setPhaseDraft(d => ({ ...d, system_prompt: e.target.value }))}
                                    placeholder="Enter system instructions for this phase…"
                                    className="w-full min-h-[60vh] max-h-[75vh] bg-muted/40 border border-border rounded-md p-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y leading-relaxed"
                                />
                                <p className="text-[10px] text-muted-foreground/60 mt-1">
                                    Edits apply at the project level — every chat that runs this pipeline will use the updated prompt.
                                </p>
                            </div>
                        </div>
                    )}
                    <div className="flex gap-2 justify-end pt-2 border-t border-border/40">
                        <Button
                            variant="ghost"
                            onClick={() => setEditingPhase(null)}
                            disabled={savingPhase}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleSavePhase} disabled={savingPhase} className="gap-1.5">
                            {savingPhase ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={!!openOutput} onOpenChange={(open) => !open && setOpenOutput(null)}>
                {/*
                  Width via inline style instead of `w-[90vw] !max-w-[90vw]`
                  Tailwind utilities. Two reasons:
                    1. The base radix Dialog ships with `sm:max-w-lg` (32rem)
                       baked into its className. With Tailwind v4 + tailwind-merge
                       the `!max-w-[90vw]` override has a habit of getting locked
                       at the value computed when the dialog first mounted —
                       reproducible by mounting the modal at one viewport and
                       resizing, the modal stays at the old width.
                    2. Inline style is the highest-specificity escape hatch
                       short of !important — and it re-applies on every render,
                       so any future style war can be won here without touching
                       the radix primitive.

                  90vw with a 1600px ceiling keeps the modal comfortable on
                  ultrawides without leaving the content bare against the
                  viewport edge.
                */}
                <DialogContent
                    className="overflow-hidden flex flex-col"
                    style={{
                        width: "min(90vw, 1600px)",
                        maxWidth: "min(90vw, 1600px)",
                        maxHeight: "90vh",
                    }}
                >
                    <DialogHeader>
                        <DialogTitle className="flex flex-col gap-1">
                            <span>{openOutput?.phaseTitle}</span>
                            {openOutput?.phaseSubtitle && (
                                <span className="text-[11px] font-mono font-normal text-muted-foreground/70">
                                    {openOutput.phaseSubtitle}
                                </span>
                            )}
                        </DialogTitle>
                        {openOutput?.taskPrompt && (
                            <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                                Row prompt: {openOutput.taskPrompt}
                            </div>
                        )}
                    </DialogHeader>
                    {/*
                      min-h-0 / min-w-0: by default a flex item's min-{height,
                      width} is `auto`, which resolves to its content's min-
                      content size — that lets wide markdown tables push this
                      scroller (and the dialog) wider than max-width, bypassing
                      our cap. Setting both to 0 lets the scroller actually
                      shrink to the parent's available space; overflow-{x,y}-
                      auto then takes over and adds scrollbars only where
                      content overflows.
                    */}
                    <div className="overflow-y-auto overflow-x-auto flex-1 min-h-0 min-w-0 px-1 prose-sm">
                        {openOutput && <MarkdownContent content={openOutput.content} />}
                    </div>
                </DialogContent>
            </Dialog>
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
