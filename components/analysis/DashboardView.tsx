"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Trash2, Loader2, MessageSquarePlus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import * as api from "@/lib/analysis/api";
import { AnalysisApiError } from "@/lib/analysis/api";
import type { AnalysisData } from "@/lib/analysis/useAnalysisData";
import type { WidgetContext } from "@/lib/analysis/aggregate";
import { WidgetRenderer } from "./WidgetRenderer";

// Small media query hook so we can honor x/y placement on desktop and stack
// on mobile without a layout library.
function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(true);
    useEffect(() => {
        const mq = window.matchMedia("(min-width: 768px)");
        const update = () => setIsDesktop(mq.matches);
        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, []);
    return isDesktop;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

interface Props {
    analysisId: string;
    data: AnalysisData;
}

export function DashboardView({ analysisId, data }: Props) {
    const { dashboards, columns, rows, valueOf, isRunning, loading } = data;
    const [activeId, setActiveId] = useState<string | null>(null);
    const [suggesting, setSuggesting] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const isDesktop = useIsDesktop();

    // Keep a valid active tab as dashboards arrive / change.
    useEffect(() => {
        if (dashboards.length === 0) {
            setActiveId(null);
            return;
        }
        if (!activeId || !dashboards.some((d) => d.id === activeId)) {
            setActiveId(dashboards[0].id);
        }
    }, [dashboards, activeId]);

    const active = dashboards.find((d) => d.id === activeId) ?? null;

    // Widget context is shared across all widgets; rebuild only when the
    // underlying data identity changes.
    const ctx: WidgetContext = useMemo(
        () => ({ columns, rows, valueOf }),
        [columns, rows, valueOf]
    );

    const handleSuggest = async () => {
        setSuggesting(true);
        setActionError(null);
        try {
            await api.suggestDashboard(analysisId, { persist: true });
            await data.refetchDashboards();
        } catch (err) {
            setActionError(err instanceof AnalysisApiError ? err.message : "Failed to suggest a dashboard.");
        } finally {
            setSuggesting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this dashboard?")) return;
        setDeletingId(id);
        setActionError(null);
        try {
            await api.deleteDashboard(id);
            await data.refetchDashboards();
        } catch (err) {
            setActionError(err instanceof AnalysisApiError ? err.message : "Failed to delete dashboard.");
        } finally {
            setDeletingId(null);
        }
    };

    if (loading && dashboards.length === 0) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
                {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-48 w-full" />
                ))}
            </div>
        );
    }

    if (dashboards.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
                <div className="rounded-full bg-primary/10 p-4">
                    <MessageSquarePlus className="h-7 w-7 text-primary" />
                </div>
                <div className="max-w-sm">
                    <div className="font-medium text-foreground">No dashboards yet</div>
                    <p className="text-sm text-muted-foreground mt-1">
                        Ask the assistant to build a dashboard — or generate a starter from your columns.
                    </p>
                </div>
                <Button onClick={handleSuggest} isLoading={suggesting} leftIcon={Sparkles}>
                    Suggest a starter dashboard
                </Button>
                {actionError && (
                    <div className="text-xs text-rose-500 flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> {actionError}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col min-h-0">
            {/* Dashboard tabs */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 overflow-x-auto shrink-0">
                {dashboards.map((d) => (
                    <button
                        key={d.id}
                        onClick={() => setActiveId(d.id)}
                        className={cn(
                            "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                            d.id === activeId
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        )}
                    >
                        {d.title || "Untitled dashboard"}
                    </button>
                ))}
                <div className="ml-auto flex items-center gap-1 pl-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={handleSuggest}
                        disabled={suggesting}
                    >
                        {suggesting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                        )}
                        Suggest
                    </Button>
                </div>
            </div>

            {actionError && (
                <div className="px-4 py-2 text-xs text-rose-500 flex items-center gap-1 shrink-0">
                    <AlertTriangle className="h-3.5 w-3.5" /> {actionError}
                </div>
            )}

            {/* Active dashboard */}
            {active && (
                <div className="flex-1 min-h-0 overflow-auto p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="font-medium text-foreground truncate">
                                {active.title || "Untitled dashboard"}
                            </div>
                            {active.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {active.description}
                                </p>
                            )}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(active.id)}
                            disabled={deletingId === active.id}
                            title="Delete dashboard"
                        >
                            {deletingId === active.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                            )}
                        </Button>
                    </div>

                    {active.spec.widgets.length === 0 ? (
                        <div className="border border-dashed border-border/50 rounded-xl p-10 text-center text-sm text-muted-foreground">
                            This dashboard has no widgets.
                        </div>
                    ) : (
                        <div
                            style={
                                isDesktop
                                    ? {
                                          display: "grid",
                                          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                                          gridAutoRows: "88px",
                                          gridAutoFlow: "row dense",
                                          gap: "12px",
                                      }
                                    : { display: "flex", flexDirection: "column", gap: "12px" }
                            }
                        >
                            {active.spec.widgets.map((widget) => {
                                const layout = widget.layout;
                                const desktopStyle: React.CSSProperties = layout
                                    ? {
                                          gridColumn: `${clamp((layout.x ?? 0) + 1, 1, 12)} / span ${clamp(
                                              layout.w || 6,
                                              1,
                                              12
                                          )}`,
                                          gridRow: `${(layout.y ?? 0) + 1} / span ${Math.max(layout.h || 4, 1)}`,
                                      }
                                    : { gridColumn: "span 6", gridRow: "span 4" };
                                const mobileStyle: React.CSSProperties = {
                                    height: `${Math.max(layout?.h || 4, 2) * 72}px`,
                                };
                                return (
                                    <div
                                        key={widget.id}
                                        style={isDesktop ? desktopStyle : mobileStyle}
                                        className="rounded-xl border border-border bg-card shadow-sm overflow-hidden min-w-0"
                                    >
                                        <WidgetRenderer widget={widget} ctx={ctx} isRunning={isRunning} />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
