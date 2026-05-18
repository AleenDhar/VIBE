"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/Button";
import { Loader2, Upload, AlertTriangle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import {
    bulkCreateTasksFromCSV,
    type CsvUploadRow,
} from "@/lib/actions/automations";
import {
    CSV_UPLOAD_MAX_ROWS,
    extractPlaceholders,
} from "@/lib/automations/template";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    automationId: string;
    promptTemplate: string | null;
    onUploaded: (result: { inserted: number; skipped: number }) => void;
}

// Same normalization as the server uses for placeholder name matching, so
// "Account ID" / "account_id" / "accountId" all collapse to the same key.
function normalizeKey(s: string): string {
    return s.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function basenameWithoutExt(name: string): string {
    const cleaned = name.replace(/\\/g, "/").split("/").pop() || name;
    const dot = cleaned.lastIndexOf(".");
    return dot > 0 ? cleaned.slice(0, dot) : cleaned;
}

export function CsvUploadDialog({
    open,
    onOpenChange,
    automationId,
    promptTemplate,
    onUploaded,
}: Props) {
    const [file, setFile] = useState<File | null>(null);
    const [parsing, setParsing] = useState(false);
    const [headers, setHeaders] = useState<string[]>([]);
    // rows are arrays-of-strings keyed by header order from parsing (object form).
    const [rows, setRows] = useState<Record<string, string>[]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({}); // placeholder -> header
    const [submitting, setSubmitting] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const placeholders = useMemo(() => extractPlaceholders(promptTemplate), [promptTemplate]);
    const templateMissing = !promptTemplate || placeholders.length === 0;

    // Reset when the dialog closes so a re-open starts fresh.
    useEffect(() => {
        if (!open) {
            setFile(null);
            setHeaders([]);
            setRows([]);
            setMapping({});
            setParseError(null);
            setSubmitting(false);
            setParsing(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }, [open]);

    // Auto-map placeholders to headers by normalized name match when either
    // changes.
    useEffect(() => {
        if (placeholders.length === 0 || headers.length === 0) {
            setMapping({});
            return;
        }
        const headerByNorm = new Map<string, string>();
        for (const h of headers) headerByNorm.set(normalizeKey(h), h);
        const next: Record<string, string> = {};
        for (const p of placeholders) {
            const match = headerByNorm.get(normalizeKey(p));
            if (match) next[p] = match;
        }
        setMapping(next);
    }, [headers, placeholders]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f);
        setParsing(true);
        setParseError(null);
        setHeaders([]);
        setRows([]);
        try {
            const XLSX = await import("xlsx");
            const buf = await f.arrayBuffer();
            const wb = XLSX.read(buf, { type: "array" });
            const firstSheet = wb.Sheets[wb.SheetNames[0]];
            if (!firstSheet) throw new Error("File has no sheets.");
            // header: 1 to get array-of-arrays so we can grab the real header row.
            const raw = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
                header: 1,
                defval: "",
                blankrows: false,
            });
            if (raw.length === 0) throw new Error("File is empty.");
            const headerRow = (raw[0] as unknown[]).map((c) => String(c ?? "").trim());
            const cleanHeaders = headerRow.filter((h) => h.length > 0);
            if (cleanHeaders.length === 0) throw new Error("Header row is empty.");
            const dataRows: Record<string, string>[] = [];
            for (let i = 1; i < raw.length; i++) {
                const r = raw[i] as unknown[];
                const obj: Record<string, string> = {};
                let nonEmpty = false;
                for (let j = 0; j < cleanHeaders.length; j++) {
                    const v = String(r?.[j] ?? "").trim();
                    obj[cleanHeaders[j]] = v;
                    if (v) nonEmpty = true;
                }
                if (nonEmpty) dataRows.push(obj);
            }
            if (dataRows.length === 0) throw new Error("No data rows found.");
            setHeaders(cleanHeaders);
            setRows(dataRows);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to parse file.";
            setParseError(msg);
            setFile(null);
        } finally {
            setParsing(false);
        }
    };

    // Build the validation summary the user sees before submitting.
    const summary = useMemo(() => {
        if (rows.length === 0 || placeholders.length === 0) {
            return { willInsert: 0, willSkip: 0, missingMapping: [] as string[] };
        }
        const missingMapping = placeholders.filter((p) => !mapping[p]);
        if (missingMapping.length > 0) {
            return { willInsert: 0, willSkip: rows.length, missingMapping };
        }
        let insert = 0;
        let skip = 0;
        for (const row of rows) {
            const ok = placeholders.every((p) => {
                const header = mapping[p];
                const v = row[header];
                return v != null && String(v).trim() !== "";
            });
            if (ok) insert++;
            else skip++;
        }
        return { willInsert: insert, willSkip: skip, missingMapping };
    }, [rows, placeholders, mapping]);

    const previewPrompts = useMemo(() => {
        if (rows.length === 0 || placeholders.length === 0 || !promptTemplate) return [];
        return rows.slice(0, 3).map((row) => {
            const values: Record<string, string> = {};
            for (const p of placeholders) {
                const header = mapping[p];
                values[p] = header ? String(row[header] ?? "").trim() : "";
            }
            const rendered = promptTemplate.replace(
                /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
                (_, name: string) => values[name] ?? ""
            );
            return { rendered, values };
        });
    }, [rows, placeholders, mapping, promptTemplate]);

    const handleSubmit = async () => {
        if (summary.willInsert === 0) return;
        setSubmitting(true);
        try {
            const payload: CsvUploadRow[] = rows.map((row) => {
                const values: Record<string, string> = {};
                for (const p of placeholders) {
                    const header = mapping[p];
                    if (header) values[p] = String(row[header] ?? "").trim();
                }
                return { values };
            });
            const fallbackName = file ? basenameWithoutExt(file.name) : undefined;
            const result = await bulkCreateTasksFromCSV(automationId, payload, { fallbackName });
            if (!result.success) {
                alert(`Failed: ${result.error}`);
            } else {
                onUploaded({ inserted: result.inserted, skipped: result.skipped });
                onOpenChange(false);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            alert(`Failed: ${msg}`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4" />
                        Upload CSV
                    </DialogTitle>
                    <DialogDescription>
                        Each row becomes one automation task. Columns fill in the placeholders in the prompt template.
                    </DialogDescription>
                </DialogHeader>

                {templateMissing ? (
                    <div className="border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 rounded-md p-3 text-sm flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        <div>
                            <div className="font-medium">No prompt template yet.</div>
                            <div className="text-xs mt-1 opacity-90">
                                Add a template at the top of the page like
                                <code className="mx-1 px-1 py-0.5 rounded bg-amber-500/15">
                                    Diagnose account {"{{account_id}}"} for campaign {"{{campaign_id}}"}
                                </code>
                                then come back to upload.
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Step 1 — file picker */}
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                1. Pick a file
                            </label>
                            <div className="mt-1 flex items-center gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".csv,.tsv,.xlsx,.xls,text/csv,text/tab-separated-values"
                                    onChange={handleFileChange}
                                    className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/70 file:cursor-pointer"
                                />
                                {parsing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                            </div>
                            {parseError && (
                                <div className="mt-2 text-xs text-rose-500">{parseError}</div>
                            )}
                            {file && !parseError && rows.length > 0 && (
                                <div className="mt-2 text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">{file.name}</span> — {rows.length} data
                                    rows, {headers.length} columns
                                </div>
                            )}
                        </div>

                        {/* Step 2 — mapping */}
                        {headers.length > 0 && (
                            <div>
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                    2. Map placeholders to columns
                                </label>
                                <div className="mt-2 border border-border rounded-md divide-y divide-border/40">
                                    {placeholders.map((p) => (
                                        <div key={p} className="flex items-center gap-3 px-3 py-2 text-sm">
                                            <code className="text-xs px-1.5 py-0.5 rounded bg-muted text-foreground/90 shrink-0">
                                                {`{{${p}}}`}
                                            </code>
                                            <span className="text-muted-foreground">←</span>
                                            <select
                                                value={mapping[p] || ""}
                                                onChange={(e) =>
                                                    setMapping((prev) => ({ ...prev, [p]: e.target.value }))
                                                }
                                                className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                            >
                                                <option value="">— pick a column —</option>
                                                {headers.map((h) => (
                                                    <option key={h} value={h}>
                                                        {h}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Step 3 — preview */}
                        {rows.length > 0 && summary.missingMapping.length === 0 && (
                            <div>
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                    3. Preview
                                </label>
                                <div className="mt-2 space-y-2">
                                    {previewPrompts.map((p, i) => (
                                        <div
                                            key={i}
                                            className="border border-border/60 rounded-md px-3 py-2 text-xs bg-muted/20"
                                        >
                                            <div className="text-[10px] text-muted-foreground mb-1">Row {i + 1}</div>
                                            <div className="whitespace-pre-wrap text-foreground/90">{p.rendered}</div>
                                        </div>
                                    ))}
                                    {rows.length > 3 && (
                                        <div className="text-[11px] text-muted-foreground">
                                            … and {rows.length - 3} more
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Summary */}
                        {rows.length > 0 && (
                            <div className="border border-border rounded-md px-3 py-2 text-xs space-y-1 bg-muted/30">
                                {summary.missingMapping.length > 0 ? (
                                    <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                        <span>
                                            Map {summary.missingMapping.map((p) => `{{${p}}}`).join(", ")} to continue.
                                        </span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                            <span>
                                                {summary.willInsert} row{summary.willInsert === 1 ? "" : "s"} will be
                                                added.
                                            </span>
                                        </div>
                                        {summary.willSkip > 0 && (
                                            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                                                <AlertTriangle className="h-3.5 w-3.5" />
                                                <span>
                                                    {summary.willSkip} skipped (missing a value for one or more
                                                    placeholders).
                                                </span>
                                            </div>
                                        )}
                                        {rows.length > CSV_UPLOAD_MAX_ROWS && (
                                            <div className="flex items-center gap-2 text-rose-600">
                                                <AlertTriangle className="h-3.5 w-3.5" />
                                                <span>
                                                    File has {rows.length} rows — max is {CSV_UPLOAD_MAX_ROWS} per
                                                    upload.
                                                </span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={
                            templateMissing ||
                            submitting ||
                            summary.willInsert === 0 ||
                            summary.missingMapping.length > 0 ||
                            rows.length > CSV_UPLOAD_MAX_ROWS
                        }
                        className="gap-2"
                    >
                        {submitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Upload className="h-4 w-4" />
                        )}
                        Insert {summary.willInsert > 0 ? summary.willInsert : ""} rows
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
