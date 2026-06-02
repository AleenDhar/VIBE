"use client";

import { useEffect, useRef, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/Button";
import { Loader2, Upload, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import * as api from "@/lib/analysis/api";
import { AnalysisApiError } from "@/lib/analysis/api";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    analysisId: string;
    onAdded: (count: number) => void;
}

type Mode = "cache" | "csv" | "explicit";

export function AddRowsDialog({ open, onOpenChange, analysisId, onAdded }: Props) {
    const [mode, setMode] = useState<Mode>("cache");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // cache filters
    const [source, setSource] = useState<"opportunity_cache" | "opportunity_observatory">(
        "opportunity_cache"
    );
    const [limit, setLimit] = useState("25");
    const [stage, setStage] = useState("");
    const [momentum, setMomentum] = useState("");
    const [minAmount, setMinAmount] = useState("");
    const [maxAmount, setMaxAmount] = useState("");
    const [accountContains, setAccountContains] = useState("");
    const [nameContains, setNameContains] = useState("");

    // explicit
    const [explicitJson, setExplicitJson] = useState(
        '[\n  { "entity_ref": "006...", "label": "Acme – Renewal", "source": { "amount": 120000 } }\n]'
    );

    // csv
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
    const [csvName, setCsvName] = useState<string | null>(null);
    const [labelCol, setLabelCol] = useState("");
    const [entityCol, setEntityCol] = useState("");
    const [parsing, setParsing] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    // Reset everything when the dialog closes so a re-open is clean.
    useEffect(() => {
        if (!open) {
            setError(null);
            setCsvHeaders([]);
            setCsvRows([]);
            setCsvName(null);
            setLabelCol("");
            setEntityCol("");
            if (fileRef.current) fileRef.current.value = "";
        }
    }, [open]);

    const num = (s: string) => {
        const n = Number(s.trim());
        return s.trim() !== "" && Number.isFinite(n) ? n : undefined;
    };

    const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setParsing(true);
        setError(null);
        setCsvHeaders([]);
        setCsvRows([]);
        try {
            const XLSX = await import("xlsx");
            const buf = await f.arrayBuffer();
            const wb = XLSX.read(buf, { type: "array" });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            if (!sheet) throw new Error("File has no sheets.");
            const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
                header: 1,
                defval: "",
                blankrows: false,
            });
            if (raw.length === 0) throw new Error("File is empty.");
            const headers = (raw[0] as unknown[]).map((c) => String(c ?? "").trim()).filter(Boolean);
            if (headers.length === 0) throw new Error("Header row is empty.");
            const rows: Record<string, string>[] = [];
            for (let i = 1; i < raw.length; i++) {
                const r = raw[i] as unknown[];
                const obj: Record<string, string> = {};
                let nonEmpty = false;
                headers.forEach((h, j) => {
                    const v = String(r?.[j] ?? "").trim();
                    obj[h] = v;
                    if (v) nonEmpty = true;
                });
                if (nonEmpty) rows.push(obj);
            }
            if (rows.length === 0) throw new Error("No data rows found.");
            setCsvHeaders(headers);
            setCsvRows(rows);
            setCsvName(f.name);
            // Best-effort default mapping for the label column.
            const guess =
                headers.find((h) => /name|label|opp|account/i.test(h)) ?? headers[0];
            setLabelCol(guess);
            const idGuess = headers.find((h) => /id|ref|sfdc|006/i.test(h));
            if (idGuess) setEntityCol(idGuess);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to parse file.");
        } finally {
            setParsing(false);
        }
    };

    const handleSubmit = async () => {
        setSaving(true);
        setError(null);
        try {
            if (mode === "cache") {
                const res = await api.addRows(analysisId, {
                    source,
                    limit: num(limit) ?? 25,
                    stage: stage.trim() || undefined,
                    momentum: momentum.trim() || undefined,
                    min_amount: num(minAmount),
                    max_amount: num(maxAmount),
                    account_contains: accountContains.trim() || undefined,
                    name_contains: nameContains.trim() || undefined,
                });
                onAdded(res.added ?? 0);
            } else if (mode === "csv") {
                if (csvRows.length === 0) {
                    setError("Pick a CSV/Excel file first.");
                    setSaving(false);
                    return;
                }
                if (!labelCol) {
                    setError("Choose which column is the row label.");
                    setSaving(false);
                    return;
                }
                // Each CSV row → one analysis row. All columns go into `source`
                // (so data columns can reference them by source_field); the
                // chosen columns also fill label + entity_ref.
                const rows = csvRows.map((r) => ({
                    label: r[labelCol] || "(unnamed)",
                    entity_ref: entityCol ? r[entityCol] || undefined : undefined,
                    source: { ...r },
                }));
                const res = await api.addRows(analysisId, { rows });
                onAdded(res.added ?? rows.length);
            } else {
                let rows: unknown;
                try {
                    rows = JSON.parse(explicitJson);
                } catch {
                    setError("Explicit rows must be valid JSON (an array of row objects).");
                    setSaving(false);
                    return;
                }
                if (!Array.isArray(rows)) {
                    setError("Explicit rows must be a JSON array.");
                    setSaving(false);
                    return;
                }
                const res = await api.addRows(analysisId, { rows: rows as never });
                onAdded(res.added ?? rows.length);
            }
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof AnalysisApiError ? err.message : "Failed to add rows.");
        } finally {
            setSaving(false);
        }
    };

    const field =
        "mt-1 w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Add rows</DialogTitle>
                    <DialogDescription>Add opportunities as rows to this analysis.</DialogDescription>
                </DialogHeader>

                <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
                    {(["cache", "csv", "explicit"] as Mode[]).map((m) => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={cn(
                                "rounded-md px-3 py-1.5 font-medium transition-colors capitalize",
                                mode === m
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {m === "cache" ? "From cache" : m === "csv" ? "Upload CSV" : "Explicit"}
                        </button>
                    ))}
                </div>

                {mode === "cache" ? (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Source</label>
                                <select
                                    value={source}
                                    onChange={(e) => setSource(e.target.value as typeof source)}
                                    className={field}
                                >
                                    <option value="opportunity_cache">opportunity_cache</option>
                                    <option value="opportunity_observatory">opportunity_observatory</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Limit</label>
                                <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" className={field} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Stage</label>
                                <input value={stage} onChange={(e) => setStage(e.target.value)} className={field} placeholder="any" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Momentum</label>
                                <input value={momentum} onChange={(e) => setMomentum(e.target.value)} className={field} placeholder="any" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Min amount</label>
                                <input value={minAmount} onChange={(e) => setMinAmount(e.target.value)} inputMode="numeric" className={field} placeholder="—" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Max amount</label>
                                <input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} inputMode="numeric" className={field} placeholder="—" />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Account contains</label>
                            <input value={accountContains} onChange={(e) => setAccountContains(e.target.value)} className={field} placeholder="—" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Name contains</label>
                            <input value={nameContains} onChange={(e) => setNameContains(e.target.value)} className={field} placeholder="—" />
                        </div>
                    </div>
                ) : mode === "csv" ? (
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                1. Pick a file
                            </label>
                            <div className="mt-1 flex items-center gap-2">
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".csv,.tsv,.xlsx,.xls,text/csv"
                                    onChange={handleCsvFile}
                                    className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/70 file:cursor-pointer"
                                />
                                {parsing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                            </div>
                            {csvName && csvRows.length > 0 && (
                                <div className="mt-1 text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">{csvName}</span> — {csvRows.length}{" "}
                                    rows, {csvHeaders.length} columns
                                </div>
                            )}
                        </div>

                        {csvHeaders.length > 0 && (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">
                                            Label column
                                        </label>
                                        <select value={labelCol} onChange={(e) => setLabelCol(e.target.value)} className={field}>
                                            {csvHeaders.map((h) => (
                                                <option key={h} value={h}>
                                                    {h}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">
                                            Entity ref (optional)
                                        </label>
                                        <select value={entityCol} onChange={(e) => setEntityCol(e.target.value)} className={field}>
                                            <option value="">— none —</option>
                                            {csvHeaders.map((h) => (
                                                <option key={h} value={h}>
                                                    {h}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground/70">
                                    Every column is stored on each row&apos;s <code>source</code>, so a data column can
                                    pull any of them via its source field.
                                </p>
                            </>
                        )}
                    </div>
                ) : (
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Rows (JSON array)</label>
                        <textarea
                            value={explicitJson}
                            onChange={(e) => setExplicitJson(e.target.value)}
                            spellCheck={false}
                            className="mt-1 w-full min-h-[180px] bg-background border border-border rounded-md px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>
                )}

                {error && <div className="text-xs text-rose-500">{error}</div>}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} isLoading={saving} className="gap-2">
                        {mode === "csv" ? <FileSpreadsheet className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                        {mode === "csv" && csvRows.length > 0 ? `Add ${csvRows.length} rows` : "Add rows"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
