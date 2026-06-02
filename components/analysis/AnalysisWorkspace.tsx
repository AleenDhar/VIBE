"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ChevronLeft,
    LayoutGrid,
    Table2,
    AlertTriangle,
    PanelRightClose,
    PanelRightOpen,
    Pencil,
    Check,
    X,
    Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnalysisData } from "@/lib/analysis/useAnalysisData";
import * as api from "@/lib/analysis/api";
import { AnalysisApiError } from "@/lib/analysis/api";
import type { ModelOption } from "@/lib/analysis/types";
import { getActiveModels, getUserAllowedModels } from "@/lib/actions/models";
import { createClient } from "@/lib/supabase/client";
import { ChatPane } from "./ChatPane";
import { SheetView } from "./SheetView";
import { DashboardView } from "./DashboardView";

type View = "sheet" | "dashboard";

// Default model for the chat picker and AI columns. A valid Anthropic id
// (the analysis backend's own default — claude-sonnet-4-6-20260901 — is not).
const PREFERRED_DEFAULT_MODEL = "anthropic:claude-sonnet-4-6";

function viewStorageKey(analysisId: string) {
    return `analysis:view:${analysisId}`;
}

export function AnalysisWorkspace({ analysisId }: { analysisId: string }) {
    const data = useAnalysisData(analysisId);
    const [view, setView] = useState<View>("sheet");

    // Inline rename of the analysis title.
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [savingName, setSavingName] = useState(false);
    const [titleOverride, setTitleOverride] = useState<string | null>(null);
    const displayTitle = titleOverride ?? data.analysis?.title ?? "Analysis";

    const startEditName = () => {
        setNameDraft(displayTitle);
        setEditingName(true);
    };
    const saveName = async () => {
        const t = nameDraft.trim();
        if (!t) {
            setEditingName(false);
            return;
        }
        setSavingName(true);
        try {
            await api.updateAnalysis(analysisId, { title: t });
            setTitleOverride(t);
            setEditingName(false);
            data.refetch();
        } catch (err) {
            alert(err instanceof AnalysisApiError ? err.message : "Failed to rename.");
        } finally {
            setSavingName(false);
        }
    };
    const [models, setModels] = useState<ModelOption[]>([]);
    const [defaultModel, setDefaultModel] = useState<string | null>(null);

    // Remember the last view per analysis. Read AFTER mount (not via a lazy
    // initializer) so the first client render matches the server's default
    // ("sheet") and there's no hydration mismatch; we then adopt the stored
    // preference. The synchronous setState is intentional here.
    useEffect(() => {
        try {
            const saved = localStorage.getItem(viewStorageKey(analysisId));
            if (saved === "sheet" || saved === "dashboard") setView(saved);
        } catch {
            /* ignore */
        }
    }, [analysisId]);

    const changeView = (next: View) => {
        setView(next);
        try {
            localStorage.setItem(viewStorageKey(analysisId), next);
        } catch {
            /* ignore */
        }
    };

    // Collapse the right (analysis) pane → full-screen chat. Persisted per analysis.
    const [rightCollapsed, setRightCollapsed] = useState(false);
    useEffect(() => {
        try {
            setRightCollapsed(localStorage.getItem(`analysis:rightcollapsed:${analysisId}`) === "1");
        } catch {
            /* ignore */
        }
    }, [analysisId]);
    const toggleRight = () => {
        setRightCollapsed((c) => {
            const next = !c;
            try {
                localStorage.setItem(`analysis:rightcollapsed:${analysisId}`, next ? "1" : "0");
            } catch {
                /* ignore */
            }
            return next;
        });
    };

    // ── Resizable split between the chat pane and the analysis pane ──────────
    const containerRef = useRef<HTMLDivElement>(null);
    const [chatWidth, setChatWidth] = useState(380);
    const chatWidthRef = useRef(380);
    const MIN_CHAT = 300;
    const MIN_RIGHT = 360;

    useEffect(() => {
        try {
            const saved = Number(localStorage.getItem(`analysis:chatw:${analysisId}`));
            if (Number.isFinite(saved) && saved >= MIN_CHAT) {
                setChatWidth(saved);
                chatWidthRef.current = saved;
            }
        } catch {
            /* ignore */
        }
    }, [analysisId]);

    const startResize = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = chatWidthRef.current;
            const onMove = (ev: MouseEvent) => {
                const containerW = containerRef.current?.clientWidth ?? 1200;
                const max = Math.max(MIN_CHAT, containerW - MIN_RIGHT);
                const w = Math.max(MIN_CHAT, Math.min(startWidth + (ev.clientX - startX), max));
                chatWidthRef.current = w;
                setChatWidth(w);
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.body.style.userSelect = "";
                document.body.style.cursor = "";
                try {
                    localStorage.setItem(`analysis:chatw:${analysisId}`, String(Math.round(chatWidthRef.current)));
                } catch {
                    /* ignore */
                }
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
            document.body.style.userSelect = "none";
            document.body.style.cursor = "col-resize";
        },
        [analysisId]
    );

    // Models come from the app's own registry (ai_models table) — the same
    // source the main chat selector uses — NOT the analysis backend's /models
    // (whose default id is invalid on the provider). This guarantees valid,
    // user-permitted model ids for both the chat picker and AI columns.
    useEffect(() => {
        const supabase = createClient();
        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                const [models, allowed] = await Promise.all([
                    getActiveModels(),
                    user ? getUserAllowedModels(user.id) : Promise.resolve<string[]>([]),
                ]);
                const filtered = models.filter(
                    (m) => m.is_available_to_all || allowed.includes(m.id)
                );
                const opts: ModelOption[] = filtered.map((m) => ({
                    id: m.id,
                    label: m.name,
                    name: m.name,
                    provider: m.provider,
                }));
                setModels(opts);
                // Prefer Claude Sonnet 4.6 as the default when available; it's a
                // valid id (unlike the analysis backend's dated default). Fall
                // back to the first permitted model otherwise.
                const preferred = opts.find((o) => o.id === PREFERRED_DEFAULT_MODEL);
                setDefaultModel(preferred?.id ?? opts[0]?.id ?? null);
            } catch {
                /* picker falls back to a free-text input if this fails */
            }
        })();
    }, []);

    if (data.error && !data.analysis) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-3 px-4 text-center">
                <AlertTriangle className="h-8 w-8 text-rose-500" />
                <div className="text-sm text-muted-foreground max-w-md">{data.error}</div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => data.refetch()}>
                        Retry
                    </Button>
                    <Button variant="ghost" asChild>
                        <Link href="/analysis">Back to analyses</Link>
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
                        <Link href="/analysis" aria-label="Back to analyses">
                            <ChevronLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <div className="min-w-0">
                        {data.loading && !data.analysis ? (
                            <Skeleton className="h-5 w-48" />
                        ) : editingName ? (
                            <div className="flex items-center gap-1">
                                <input
                                    value={nameDraft}
                                    onChange={(e) => setNameDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") saveName();
                                        if (e.key === "Escape") setEditingName(false);
                                    }}
                                    autoFocus
                                    className="min-w-0 flex-1 border-b border-border bg-transparent font-medium text-foreground focus:border-primary focus:outline-none"
                                />
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-emerald-600"
                                    onClick={saveName}
                                    disabled={savingName}
                                >
                                    {savingName ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Check className="h-3.5 w-3.5" />
                                    )}
                                </Button>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-muted-foreground"
                                    onClick={() => setEditingName(false)}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        ) : (
                            <div className="group/name flex items-center gap-1">
                                <div className="font-medium text-foreground truncate">{displayTitle}</div>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-hover/name:opacity-100 transition-opacity"
                                    onClick={startEditName}
                                    title="Rename analysis"
                                >
                                    <Pencil className="h-3 w-3" />
                                </Button>
                            </div>
                        )}
                        {data.analysis?.description && !editingName && (
                            <div className="text-[11px] text-muted-foreground truncate">
                                {data.analysis.description}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {/* View toggle — only relevant when the panel is visible */}
                    {!rightCollapsed && (
                        <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
                            <button
                                onClick={() => changeView("sheet")}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                    view === "sheet"
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <Table2 className="h-3.5 w-3.5" />
                                Sheet
                            </button>
                            <button
                                onClick={() => changeView("dashboard")}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                    view === "dashboard"
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <LayoutGrid className="h-3.5 w-3.5" />
                                Dashboard
                                {data.dashboards.length > 0 && (
                                    <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
                                        {data.dashboards.length}
                                    </span>
                                )}
                            </button>
                        </div>
                    )}

                    {/* Collapse / expand the right pane (full-screen chat) */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={toggleRight}
                        title={rightCollapsed ? "Show analysis panel" : "Hide panel — full-screen chat"}
                    >
                        {rightCollapsed ? (
                            <PanelRightOpen className="h-4 w-4" />
                        ) : (
                            <PanelRightClose className="h-4 w-4" />
                        )}
                    </Button>
                </div>
            </div>

            {/* Two panes */}
            <div ref={containerRef} className="flex flex-1 min-h-0">
                {/* Left: chat. Full width when the right pane is collapsed;
                    otherwise a fixed (resizable) width on md+ and hidden on mobile. */}
                <div
                    className={cn(
                        "min-h-0 flex-col",
                        rightCollapsed ? "flex flex-1 min-w-0" : "hidden md:flex shrink-0"
                    )}
                    style={rightCollapsed ? undefined : { width: chatWidth }}
                >
                    <ChatPane
                        analysisId={analysisId}
                        data={data}
                        models={models}
                        defaultModel={defaultModel}
                    />
                </div>

                {!rightCollapsed && (
                    <>
                        {/* Drag handle */}
                        <div
                            onMouseDown={startResize}
                            onDoubleClick={() => {
                                setChatWidth(380);
                                chatWidthRef.current = 380;
                                try {
                                    localStorage.setItem(`analysis:chatw:${analysisId}`, "380");
                                } catch {
                                    /* ignore */
                                }
                            }}
                            title="Drag to resize · double-click to reset"
                            className="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 active:bg-primary/60 transition-colors"
                        />

                        {/* Right: sheet / dashboard */}
                        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
                            {view === "sheet" ? (
                                <SheetView
                                    analysisId={analysisId}
                                    data={data}
                                    models={models}
                                    defaultModel={defaultModel}
                                />
                            ) : (
                                <DashboardView analysisId={analysisId} data={data} />
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
