"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Play,
    Square,
    Plus,
    Database,
    Sparkles,
    Loader2,
    Clock,
    AlertCircle,
    RotateCw,
    Trash2,
    Pencil,
    Check,
    X,
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { cn } from "@/lib/utils";
import * as api from "@/lib/analysis/api";
import { AnalysisApiError } from "@/lib/analysis/api";
import type { AnalysisData } from "@/lib/analysis/useAnalysisData";
import type { AnalysisCell, AnalysisColumn, AnalysisRow, CellStatus, ModelOption } from "@/lib/analysis/types";
import { ColumnDialog } from "./ColumnDialog";
import { AddRowsDialog } from "./AddRowsDialog";

const CELL_STATUS_STYLES: Record<CellStatus, string> = {
    empty: "bg-muted text-muted-foreground border-border",
    pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    running: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    error: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

interface Props {
    analysisId: string;
    data: AnalysisData;
    models: ModelOption[];
    defaultModel: string | null;
}

export function SheetView({ analysisId, data, models, defaultModel }: Props) {
    const { columns, rows, cellFor, latestRun, isRunning, loading } = data;
    const [runBusy, setRunBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [columnDialog, setColumnDialog] = useState<{ open: boolean; column: AnalysisColumn | null }>({
        open: false,
        column: null,
    });
    const [addRowsOpen, setAddRowsOpen] = useState(false);
    const [rowRunningId, setRowRunningId] = useState<string | null>(null);
    const hasAiColumns = columns.some((c) => c.type === "ai");
    // Live in-memory run flag from GET /runs. The persisted latest_run.status
    // can freeze on a server restart, so is_running is the truthier signal.
    const [liveRunning, setLiveRunning] = useState<boolean | null>(null);

    // Cell-detail modal. The cell is looked up live from `cellFor` so its
    // content updates in place while a re-run streams in.
    const [openCell, setOpenCell] = useState<{ row: AnalysisRow; col: AnalysisColumn } | null>(null);
    const [cellEditing, setCellEditing] = useState(false);
    const [cellDraft, setCellDraft] = useState("");
    const [cellBusy, setCellBusy] = useState(false);
    const liveCell = openCell ? cellFor(openCell.row.id, openCell.col.id) : undefined;

    const openCellModal = (row: AnalysisRow, col: AnalysisColumn) => {
        setOpenCell({ row, col });
        setCellEditing(false);
        setCellDraft("");
    };

    const saveCellEdit = async () => {
        if (!liveCell) {
            flash("Run the analysis first to create this cell.");
            setCellEditing(false);
            return;
        }
        setCellBusy(true);
        try {
            await api.editCell(liveCell.id, cellDraft);
            setCellEditing(false);
        } catch (err) {
            flash(err instanceof AnalysisApiError ? err.message : "Failed to save cell.");
        } finally {
            setCellBusy(false);
        }
    };

    const rerunCellModal = async () => {
        if (!openCell) return;
        setCellBusy(true);
        try {
            await api.rerunCell(analysisId, { row_id: openCell.row.id, column_id: openCell.col.id });
        } catch (err) {
            if (err instanceof AnalysisApiError && err.status === 409) {
                flash("A run is active — try again once it finishes.");
            } else {
                flash(err instanceof AnalysisApiError ? err.message : "Failed to re-run cell.");
            }
        } finally {
            setCellBusy(false);
        }
    };

    const flash = (msg: string) => {
        setNotice(msg);
        window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000);
    };

    const handleRunAll = async () => {
        setRunBusy(true);
        try {
            await api.runAll(analysisId);
        } catch (err) {
            if (err instanceof AnalysisApiError && err.status === 409) {
                flash("A run is already in progress.");
            } else {
                flash(err instanceof AnalysisApiError ? err.message : "Failed to start run.");
            }
        } finally {
            setRunBusy(false);
        }
    };

    const handleStop = async () => {
        setRunBusy(true);
        try {
            await api.stopRun(analysisId);
        } catch (err) {
            flash(err instanceof AnalysisApiError ? err.message : "Failed to stop run.");
        } finally {
            setRunBusy(false);
        }
    };

    const handleResume = async () => {
        setRunBusy(true);
        try {
            await api.resumeRun(analysisId);
            setLiveRunning(null); // re-detect on the next poll
        } catch (err) {
            flash(err instanceof AnalysisApiError ? err.message : "Failed to resume run.");
        } finally {
            setRunBusy(false);
        }
    };

    // Poll GET /runs for the live is_running flag while the analysis status says
    // a run is in progress. Lets us tell "genuinely working" from "stuck".
    const runStatus = latestRun?.status;
    useEffect(() => {
        if (runStatus !== "running") {
            setLiveRunning(null);
            return;
        }
        let cancelled = false;
        const tick = async () => {
            try {
                const res = await api.listRuns(analysisId, 1);
                if (!cancelled) setLiveRunning(!!res.is_running);
            } catch {
                /* ignore */
            }
        };
        const interval = setInterval(tick, 3000);
        tick();
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [runStatus, analysisId]);

    const handleDeleteColumn = async (col: AnalysisColumn) => {
        if (!confirm(`Delete column "${col.name}"?`)) return;
        try {
            await api.deleteColumn(col.id);
        } catch (err) {
            flash(err instanceof AnalysisApiError ? err.message : "Failed to delete column.");
        }
    };

    const handleDeleteRow = async (row: AnalysisRow) => {
        if (!confirm(`Delete row "${row.label}"?`)) return;
        try {
            await api.deleteRow(row.id);
        } catch (err) {
            flash(err instanceof AnalysisApiError ? err.message : "Failed to delete row.");
        }
    };

    // Run every AI cell in a single row, left-to-right. There's no per-row
    // endpoint, so we re-run each AI cell in order; the engine allows one
    // re-run at a time (409 while busy), so we wait out 409s to serialize.
    const handleRunRow = async (row: AnalysisRow) => {
        const aiCols = columns.filter((c) => c.type === "ai").sort((a, b) => a.position - b.position);
        if (aiCols.length === 0) {
            flash("No AI columns to run in this row.");
            return;
        }
        setRowRunningId(row.id);
        try {
            for (const col of aiCols) {
                let queued = false;
                for (let attempt = 0; attempt < 60 && !queued; attempt++) {
                    try {
                        await api.rerunCell(analysisId, { row_id: row.id, column_id: col.id });
                        queued = true;
                    } catch (err) {
                        // 409 = another (re-)run still active; wait and retry so
                        // the row's cells run one after another.
                        if (err instanceof AnalysisApiError && err.status === 409) {
                            await new Promise((r) => setTimeout(r, 1500));
                        } else {
                            throw err;
                        }
                    }
                }
            }
            flash("Running this row…");
        } catch (err) {
            flash(err instanceof AnalysisApiError ? err.message : "Failed to run row.");
        } finally {
            setRowRunningId(null);
        }
    };

    // Run progress (source of truth = latest_run, not cell counts).
    const done = latestRun?.cells_done ?? 0;
    const total = latestRun?.cells_total ?? null;
    const errors = latestRun?.cells_error ?? 0;

    // statusRunning = persisted DB status; liveRunning = in-memory is_running.
    const statusRunning = latestRun?.status === "running";
    const genuinelyRunning = statusRunning && liveRunning !== false; // working (or not yet polled)
    const stalled = statusRunning && liveRunning === false; // status says running but the engine isn't

    return (
        <div className="flex h-full flex-col min-h-0">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 shrink-0">
                {genuinelyRunning ? (
                    <Button size="sm" variant="destructive" onClick={handleStop} disabled={runBusy} leftIcon={Square}>
                        Stop
                    </Button>
                ) : stalled ? (
                    <Button size="sm" onClick={handleResume} disabled={runBusy} leftIcon={RotateCw}>
                        Resume
                    </Button>
                ) : (
                    <Button
                        size="sm"
                        onClick={handleRunAll}
                        disabled={runBusy || rows.length === 0 || columns.length === 0}
                        leftIcon={Play}
                    >
                        Run all
                    </Button>
                )}

                {genuinelyRunning && (
                    <div className="flex items-center gap-2 text-xs text-sky-600 dark:text-sky-300">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>
                            computing… {done}
                            {total != null ? `/${total}` : ""} cells
                            {errors > 0 && <span className="text-rose-500"> · {errors} errors</span>}
                        </span>
                    </div>
                )}
                {stalled && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <AlertCircle className="h-3.5 w-3.5" />
                        <span>
                            run stalled at {done}
                            {total != null ? `/${total}` : ""} — resume to continue
                        </span>
                    </div>
                )}
                {!statusRunning && latestRun?.status === "done" && total != null && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">
                        last run done · {done}/{total}
                        {errors > 0 && <span className="text-rose-500"> · {errors} errors</span>}
                    </span>
                )}

                <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setAddRowsOpen(true)} leftIcon={Plus}>
                        Rows
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setColumnDialog({ open: true, column: null })}
                        leftIcon={Plus}
                    >
                        Column
                    </Button>
                </div>
            </div>

            {notice && (
                <div className="px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
                    {notice}
                </div>
            )}

            {/* Grid */}
            <div className="flex-1 min-h-0 overflow-auto">
                {loading && rows.length === 0 ? (
                    <div className="p-4 space-y-2">
                        {[0, 1, 2, 3, 4].map((i) => (
                            <Skeleton key={i} className="h-8 w-full" />
                        ))}
                    </div>
                ) : columns.length === 0 && rows.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-4">
                        <Sparkles className="h-7 w-7 text-muted-foreground/40" />
                        <div className="text-sm text-muted-foreground max-w-sm">
                            This analysis is empty. Ask the agent to add opportunities and columns — or use
                            the Rows / Column buttons above.
                        </div>
                    </div>
                ) : (
                    <table className="border-collapse text-sm">
                        <thead className="sticky top-0 z-20 bg-muted/80 backdrop-blur">
                            <tr>
                                <th className="sticky left-0 z-30 bg-muted/95 border-b border-r border-border px-3 py-2 text-left text-[10px] uppercase tracking-wide text-muted-foreground min-w-[200px]">
                                    Opportunity
                                </th>
                                {columns.map((col) => (
                                    <ColumnHeader
                                        key={col.id}
                                        col={col}
                                        onEdit={() => setColumnDialog({ open: true, column: col })}
                                        onDelete={() => handleDeleteColumn(col)}
                                    />
                                ))}
                                <th className="border-b border-border px-2 w-10" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id} className="group hover:bg-muted/20">
                                    <td className="sticky left-0 z-10 bg-background group-hover:bg-muted/20 border-b border-r border-border px-3 py-1.5 align-top min-w-[200px] max-w-[280px]">
                                        <div className="font-medium text-foreground/90 truncate" title={row.label}>
                                            {row.label}
                                        </div>
                                        {row.entity_ref && (
                                            <div className="text-[10px] text-muted-foreground/60 font-mono truncate">
                                                {row.entity_ref}
                                            </div>
                                        )}
                                    </td>
                                    {columns.map((col) => (
                                        <CellView
                                            key={col.id}
                                            analysisId={analysisId}
                                            row={row}
                                            col={col}
                                            cell={cellFor(row.id, col.id)}
                                            onNotice={flash}
                                            onOpen={() => openCellModal(row, col)}
                                        />
                                    ))}
                                    <td className="border-b border-border px-1 align-top">
                                        <div className="flex items-center gap-0.5">
                                            {hasAiColumns && (
                                                <button
                                                    onClick={() => handleRunRow(row)}
                                                    disabled={rowRunningId === row.id || isRunning}
                                                    className="opacity-0 group-hover:opacity-100 text-emerald-600 hover:text-emerald-700 transition-opacity p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                                                    title="Run all AI cells in this row"
                                                >
                                                    {rowRunningId === row.id ? (
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <Play className="h-3.5 w-3.5" />
                                                    )}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDeleteRow(row)}
                                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-1"
                                                title="Delete row"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <ColumnDialog
                open={columnDialog.open}
                onOpenChange={(open) => setColumnDialog((s) => ({ ...s, open }))}
                analysisId={analysisId}
                column={columnDialog.column}
                allColumns={columns}
                models={models}
                defaultModel={defaultModel}
                onSaved={() => {
                    /* realtime applies the column change; nothing to do */
                }}
            />
            <AddRowsDialog
                open={addRowsOpen}
                onOpenChange={setAddRowsOpen}
                analysisId={analysisId}
                onAdded={(n) => flash(`Added ${n} row${n === 1 ? "" : "s"}.`)}
            />

            {/* Cell detail modal */}
            <Dialog
                open={!!openCell}
                onOpenChange={(o) => {
                    if (!o) {
                        setOpenCell(null);
                        setCellEditing(false);
                    }
                }}
            >
                <DialogContent
                    className="overflow-hidden flex flex-col"
                    style={{ width: "min(92vw, 1100px)", maxWidth: "min(92vw, 1100px)", maxHeight: "90vh" }}
                >
                    {openCell && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    {openCell.col.type === "ai" ? (
                                        <Sparkles className="h-4 w-4 text-violet-500" />
                                    ) : (
                                        <Database className="h-4 w-4 text-sky-500" />
                                    )}
                                    <span className="truncate">{openCell.col.name}</span>
                                </DialogTitle>
                                <div className="text-xs text-muted-foreground truncate">
                                    {openCell.row.label}
                                    {openCell.row.entity_ref && (
                                        <span className="font-mono text-muted-foreground/60">
                                            {" "}
                                            · {openCell.row.entity_ref}
                                        </span>
                                    )}
                                </div>
                            </DialogHeader>

                            {/* status + metadata */}
                            <div className="flex items-center gap-2 flex-wrap text-[11px] shrink-0">
                                <span
                                    className={cn(
                                        "inline-flex items-center rounded-full border px-2 py-0.5 font-medium",
                                        CELL_STATUS_STYLES[liveCell?.status ?? "empty"]
                                    )}
                                >
                                    {liveCell?.status ?? "empty"}
                                </span>
                                {liveCell?.model_used && (
                                    <span className="font-mono text-muted-foreground/70">{liveCell.model_used}</span>
                                )}
                                {liveCell?.tokens_used != null && (
                                    <span className="font-mono text-muted-foreground/60">
                                        {liveCell.tokens_used.toLocaleString()} tok
                                    </span>
                                )}
                            </div>

                            {/* body */}
                            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-auto px-0.5">
                                {cellEditing ? (
                                    <textarea
                                        value={cellDraft}
                                        onChange={(e) => setCellDraft(e.target.value)}
                                        autoFocus
                                        className="w-full min-h-[40vh] bg-background border border-border rounded-md p-3 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                ) : liveCell?.status === "error" ? (
                                    <pre className="text-xs text-rose-500 whitespace-pre-wrap break-words bg-rose-500/5 border border-rose-500/20 rounded p-3 font-mono">
                                        {liveCell.error || "Error"}
                                    </pre>
                                ) : liveCell?.status === "running" ? (
                                    <div className="flex items-center gap-2 text-sm text-sky-600 dark:text-sky-300 p-4">
                                        <Loader2 className="h-4 w-4 animate-spin" /> running…
                                    </div>
                                ) : liveCell?.value ? (
                                    openCell.col.type === "ai" ? (
                                        <div className="prose-sm">
                                            <MarkdownContent content={liveCell.value} />
                                        </div>
                                    ) : (
                                        <div className="text-sm whitespace-pre-wrap break-words text-foreground/90">
                                            {liveCell.value}
                                        </div>
                                    )
                                ) : (
                                    <div className="text-sm text-muted-foreground/50 italic p-4">No value yet.</div>
                                )}
                            </div>

                            {/* actions */}
                            <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-3 shrink-0">
                                {cellEditing ? (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setCellEditing(false)}
                                            disabled={cellBusy}
                                            className="gap-1"
                                        >
                                            <X className="h-3.5 w-3.5" /> Cancel
                                        </Button>
                                        <Button size="sm" onClick={saveCellEdit} isLoading={cellBusy} className="gap-1">
                                            <Check className="h-3.5 w-3.5" /> Save
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        {openCell.col.type === "ai" && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={rerunCellModal}
                                                disabled={cellBusy || liveCell?.status === "running"}
                                                className="gap-1"
                                            >
                                                {cellBusy ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <RotateCw className="h-3.5 w-3.5" />
                                                )}
                                                Re-run
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            onClick={() => {
                                                setCellDraft(liveCell?.value ?? "");
                                                setCellEditing(true);
                                            }}
                                            className="gap-1"
                                        >
                                            <Pencil className="h-3.5 w-3.5" /> Edit
                                        </Button>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ColumnHeader({
    col,
    onEdit,
    onDelete,
}: {
    col: AnalysisColumn;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const isAi = col.type === "ai";
    return (
        <th className="border-b border-r border-border px-3 py-2 text-left align-top min-w-[200px] max-w-[260px]">
            <div className="flex items-start justify-between gap-1.5 group/col">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        {isAi ? (
                            <Sparkles className="h-3 w-3 text-violet-500 shrink-0" />
                        ) : (
                            <Database className="h-3 w-3 text-sky-500 shrink-0" />
                        )}
                        <span className="font-medium text-foreground/90 truncate" title={col.name}>
                            {col.name}
                        </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 font-mono truncate mt-0.5">
                        {isAi
                            ? String(col.config?.model ?? "ai")
                            : col.config?.source_field
                              ? `source: ${col.config.source_field}`
                              : "data"}
                    </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/col:opacity-100 transition-opacity shrink-0">
                    <button onClick={onEdit} className="p-0.5 text-muted-foreground hover:text-foreground" title="Edit column">
                        <Pencil className="h-3 w-3" />
                    </button>
                    <button onClick={onDelete} className="p-0.5 text-muted-foreground hover:text-destructive" title="Delete column">
                        <Trash2 className="h-3 w-3" />
                    </button>
                </div>
            </div>
        </th>
    );
}

function CellView({
    analysisId,
    row,
    col,
    cell,
    onNotice,
    onOpen,
}: {
    analysisId: string;
    row: AnalysisRow;
    col: AnalysisColumn;
    cell: AnalysisCell | undefined;
    onNotice: (msg: string) => void;
    onOpen: () => void;
}) {
    const [busy, setBusy] = useState(false);

    const status = cell?.status ?? "empty";
    const isAi = col.type === "ai";

    const rerun = async (e: React.MouseEvent) => {
        e.stopPropagation(); // don't open the modal
        setBusy(true);
        try {
            await api.rerunCell(analysisId, { row_id: row.id, column_id: col.id });
        } catch (err) {
            if (err instanceof AnalysisApiError && err.status === 409) {
                onNotice("A run is active — try again once it finishes.");
            } else {
                onNotice(err instanceof AnalysisApiError ? err.message : "Failed to re-run cell.");
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <td className="border-b border-r border-border px-2 py-1.5 align-top min-w-[200px] max-w-[260px]">
            <div className="flex items-start gap-1 group/cell max-h-24 overflow-hidden">
                <div
                    onClick={onOpen}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpen();
                        }
                    }}
                    role="button"
                    tabIndex={0}
                    className="text-left flex-1 min-w-0 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 py-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    title="Click to view cell"
                >
                    {status === "running" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-300">
                            <Loader2 className="h-3 w-3 animate-spin" /> running…
                        </span>
                    ) : status === "pending" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                            <Clock className="h-3 w-3" /> pending
                        </span>
                    ) : status === "error" ? (
                        <span className="inline-flex items-start gap-1 text-[11px] text-rose-500">
                            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span className="line-clamp-2">{cell?.error || "error"}</span>
                        </span>
                    ) : cell?.value ? (
                        // Markdown preview — pointer-events-none so any links don't
                        // swallow the click; the whole cell opens the modal.
                        <div className="pointer-events-none text-xs text-foreground/90 break-words [&_p]:my-0 [&_p]:leading-snug [&_ul]:my-0.5 [&_ul]:pl-4 [&_ol]:my-0.5 [&_ol]:pl-4 [&_li]:my-0 [&_li]:leading-snug [&_h1]:text-xs [&_h2]:text-xs [&_h3]:text-xs [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:my-0.5 [&_h2]:my-0.5 [&_h3]:my-0.5 [&_table]:text-[10px] [&_pre]:text-[10px] [&_pre]:my-1 [&_pre]:p-2 [&_hr]:my-1">
                            <MarkdownContent content={cell.value} compact />
                        </div>
                    ) : (
                        <span className="text-[11px] text-muted-foreground/40 italic">
                            {status === "empty" ? "—" : status}
                        </span>
                    )}
                    {cell?.model_used && status === "done" && (
                        <span className="block text-[9px] text-muted-foreground/40 font-mono mt-0.5 truncate">
                            {cell.model_used}
                            {cell.tokens_used ? ` · ${cell.tokens_used} tok` : ""}
                        </span>
                    )}
                </div>
                {isAi && (
                    <button
                        onClick={rerun}
                        disabled={busy}
                        className="opacity-0 group-hover/cell:opacity-100 text-violet-500 hover:text-violet-600 transition-opacity p-0.5 shrink-0"
                        title="Re-run this cell"
                    >
                        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                    </button>
                )}
            </div>
        </td>
    );
}
