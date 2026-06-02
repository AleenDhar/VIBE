"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/Button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Database, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import * as api from "@/lib/analysis/api";
import { AnalysisApiError } from "@/lib/analysis/api";
import type { AnalysisColumn, ColumnType, ModelOption } from "@/lib/analysis/types";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    analysisId: string;
    /** Present = edit mode; absent = create mode. */
    column?: AnalysisColumn | null;
    allColumns: AnalysisColumn[];
    models: ModelOption[];
    defaultModel: string | null;
    onSaved: () => void;
}

export function ColumnDialog({
    open,
    onOpenChange,
    analysisId,
    column,
    allColumns,
    models,
    defaultModel,
    onSaved,
}: Props) {
    const editing = !!column;
    const [type, setType] = useState<ColumnType>("data");
    const [name, setName] = useState("");
    const [sourceField, setSourceField] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [instructions, setInstructions] = useState("");
    const [model, setModel] = useState<string>("");
    const [inputColumns, setInputColumns] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Seed from the column (edit) or defaults (create) whenever opened.
    useEffect(() => {
        if (!open) return;
        setError(null);
        if (column) {
            setType(column.type);
            setName(column.name);
            setSourceField(String(column.config?.source_field ?? ""));
            setSystemPrompt(String(column.config?.system_prompt ?? ""));
            setInstructions(String(column.config?.instructions ?? ""));
            setModel(String(column.config?.model ?? defaultModel ?? ""));
            setInputColumns(
                Array.isArray(column.config?.input_columns)
                    ? (column.config!.input_columns as string[])
                    : []
            );
        } else {
            setType("data");
            setName("");
            setSourceField("");
            setSystemPrompt("");
            setInstructions("");
            setModel(defaultModel ?? "");
            setInputColumns([]);
        }
    }, [open, column, defaultModel]);

    const candidateInputs = useMemo(
        () => allColumns.filter((c) => c.id !== column?.id),
        [allColumns, column]
    );

    const modelLabel = (id: string) => {
        const m = models.find((x) => x.id === id);
        return m?.label || m?.name || id || "Select a model";
    };

    const toggleInput = (id: string) => {
        setInputColumns((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const handleSave = async () => {
        if (!name.trim()) {
            setError("Name is required.");
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const config: Record<string, unknown> =
                type === "data"
                    ? { source_field: sourceField.trim() }
                    : {
                          system_prompt: systemPrompt,
                          model: model || defaultModel || "",
                          ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
                          ...(inputColumns.length ? { input_columns: inputColumns } : {}),
                      };

            if (editing && column) {
                // Type is immutable on edit; only name + config change.
                await api.updateColumn(column.id, { name: name.trim(), config });
            } else {
                await api.createColumn(analysisId, { name: name.trim(), type, config });
            }
            onSaved();
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof AnalysisApiError ? err.message : "Failed to save column.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{editing ? "Edit column" : "Add column"}</DialogTitle>
                    <DialogDescription>
                        {type === "data"
                            ? "A data column copies a raw Salesforce field from each row."
                            : "An AI column generates a value per row via an LLM."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Type selector (create only) */}
                    {!editing && (
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setType("data")}
                                className={cn(
                                    "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
                                    type === "data"
                                        ? "border-primary bg-primary/5"
                                        : "border-border hover:bg-muted/40"
                                )}
                            >
                                <Database className="h-4 w-4 text-sky-500" />
                                <div>
                                    <div className="font-medium">Data</div>
                                    <div className="text-[10px] text-muted-foreground">Raw SF field</div>
                                </div>
                            </button>
                            <button
                                onClick={() => setType("ai")}
                                className={cn(
                                    "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
                                    type === "ai"
                                        ? "border-primary bg-primary/5"
                                        : "border-border hover:bg-muted/40"
                                )}
                            >
                                <Sparkles className="h-4 w-4 text-violet-500" />
                                <div>
                                    <div className="font-medium">AI</div>
                                    <div className="text-[10px] text-muted-foreground">LLM-generated</div>
                                </div>
                            </button>
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Name</label>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={type === "data" ? "Amount" : "Risk assessment"}
                            className="mt-1 w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>

                    {type === "data" ? (
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">
                                Source field
                            </label>
                            <input
                                value={sourceField}
                                onChange={(e) => setSourceField(e.target.value)}
                                placeholder="amount"
                                className="mt-1 w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <p className="text-[10px] text-muted-foreground/70 mt-1">
                                Copies <code>row.source[field]</code> into each cell.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Model</label>
                                {models.length > 0 ? (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                className="mt-1 h-9 w-full justify-between border border-border bg-background font-normal"
                                            >
                                                <span className="truncate">{modelLabel(model)}</span>
                                                <ChevronDown className="h-3.5 w-3.5 ml-1 shrink-0" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="start"
                                            className="max-h-72 overflow-y-auto w-[var(--radix-dropdown-menu-trigger-width)]"
                                        >
                                            {models.map((m) => (
                                                <DropdownMenuItem key={m.id} onClick={() => setModel(m.id)}>
                                                    <span className="truncate">{m.label || m.name || m.id}</span>
                                                    <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono">
                                                        {m.id}
                                                    </span>
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                ) : (
                                    <input
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                        placeholder="provider:model"
                                        className="mt-1 w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                )}
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground">
                                    System prompt
                                </label>
                                <textarea
                                    value={systemPrompt}
                                    onChange={(e) => setSystemPrompt(e.target.value)}
                                    placeholder="You assess renewal risk for a Salesforce opportunity…"
                                    className="mt-1 w-full min-h-[100px] bg-background border border-border rounded-md px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-medium text-muted-foreground">
                                    Instructions (optional)
                                </label>
                                <textarea
                                    value={instructions}
                                    onChange={(e) => setInstructions(e.target.value)}
                                    placeholder="Answer in one short sentence."
                                    className="mt-1 w-full min-h-[48px] bg-background border border-border rounded-md px-3 py-2 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                            </div>

                            {candidateInputs.length > 0 && (
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">
                                        Input columns (optional)
                                    </label>
                                    <p className="text-[10px] text-muted-foreground/70 mb-1">
                                        Let this column read other columns&apos; values for the same row.
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {candidateInputs.map((c) => {
                                            const on = inputColumns.includes(c.id);
                                            return (
                                                <button
                                                    key={c.id}
                                                    onClick={() => toggleInput(c.id)}
                                                    className={cn(
                                                        "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                                                        on
                                                            ? "border-primary bg-primary/10 text-primary"
                                                            : "border-border text-muted-foreground hover:bg-muted/40"
                                                    )}
                                                >
                                                    {c.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {error && <div className="text-xs text-rose-500">{error}</div>}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} isLoading={saving}>
                        {editing ? "Save" : "Add column"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
