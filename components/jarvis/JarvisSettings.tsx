"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, AlertTriangle, Globe, Check, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import * as jarvis from "@/lib/jarvis/api";
import { AnalysisApiError } from "@/lib/analysis/api";
import type { JarvisAnalysisItem } from "@/lib/jarvis/api";

const STATUS_STYLES: Record<string, string> = {
    draft: "bg-muted text-muted-foreground border-border",
    running: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    error: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

export function JarvisSettings({ onChange }: { onChange?: (enabledCount: number) => void }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [analyses, setAnalyses] = useState<JarvisAnalysisItem[]>([]);
    const [enabled, setEnabled] = useState<Set<string>>(new Set());
    const [defaultPrompt, setDefaultPrompt] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [promptDirty, setPromptDirty] = useState(false);
    const [savingToggles, setSavingToggles] = useState(false);
    const [savingPrompt, setSavingPrompt] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const flash = (msg: string) => {
        setNotice(msg);
        window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3000);
    };

    useEffect(() => {
        (async () => {
            try {
                const s = await jarvis.getJarvisSettings();
                setAnalyses(s.analyses ?? []);
                setEnabled(new Set(s.enabled_analysis_ids ?? []));
                setDefaultPrompt(s.default_system_prompt ?? "");
                setSystemPrompt(s.system_prompt ?? "");
                onChange?.((s.enabled_analysis_ids ?? []).length);
            } catch (err) {
                setError(err instanceof AnalysisApiError ? err.message : "Failed to load Jarvis settings.");
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggle = async (id: string) => {
        const next = new Set(enabled);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setEnabled(next); // optimistic
        setSavingToggles(true);
        setError(null);
        try {
            const res = await jarvis.putJarvisSettings({ enabled_analysis_ids: Array.from(next) });
            const cleaned = new Set(res.enabled_analysis_ids ?? []);
            setEnabled(cleaned); // backend de-dupes/validates — trust the response
            onChange?.(cleaned.size);
            flash("Saved");
        } catch (err) {
            setError(err instanceof AnalysisApiError ? err.message : "Failed to save.");
            // revert optimistic change
            setEnabled((prev) => {
                const r = new Set(prev);
                if (r.has(id)) r.delete(id);
                else r.add(id);
                return r;
            });
        } finally {
            setSavingToggles(false);
        }
    };

    const savePrompt = async () => {
        setSavingPrompt(true);
        setError(null);
        try {
            const res = await jarvis.putJarvisSettings({ system_prompt: systemPrompt });
            setSystemPrompt(res.system_prompt ?? "");
            setPromptDirty(false);
            flash("Prompt saved");
        } catch (err) {
            setError(err instanceof AnalysisApiError ? err.message : "Failed to save prompt.");
            // keep the user's edits (don't revert)
        } finally {
            setSavingPrompt(false);
        }
    };

    const resetPrompt = async () => {
        setSavingPrompt(true);
        setError(null);
        try {
            const res = await jarvis.putJarvisSettings({ system_prompt: "" });
            setSystemPrompt(res.system_prompt ?? "");
            setPromptDirty(false);
            flash("Reset to default");
        } catch (err) {
            setError(err instanceof AnalysisApiError ? err.message : "Failed to reset.");
        } finally {
            setSavingPrompt(false);
        }
    };

    return (
        <div className="mx-auto w-full max-w-2xl p-4 space-y-6 overflow-y-auto">
            {/* Global-scope warning */}
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <Globe className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                    Jarvis settings are <strong>global</strong> — a single shared configuration. Changing the
                    enabled analyses or system prompt affects Jarvis for everyone.
                </span>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-300">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Analyses checklist */}
            <section className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-foreground">Analyses Jarvis can read</h3>
                    {savingToggles ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> saving…
                        </span>
                    ) : notice ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                            <Check className="h-3 w-3" /> {notice}
                        </span>
                    ) : null}
                </div>

                {loading ? (
                    <div className="space-y-2">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </div>
                ) : analyses.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
                        No analyses yet — create one first.
                    </div>
                ) : (
                    <div className="rounded-lg border border-border divide-y divide-border/50">
                        {analyses.map((a) => (
                            <label
                                key={a.id}
                                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/30"
                            >
                                <Switch
                                    size="sm"
                                    checked={enabled.has(a.id)}
                                    onCheckedChange={() => toggle(a.id)}
                                />
                                <span className="flex-1 min-w-0 truncate text-sm text-foreground/90">{a.title}</span>
                                <span
                                    className={cn(
                                        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                        STATUS_STYLES[a.status] ?? STATUS_STYLES.draft
                                    )}
                                >
                                    {a.status}
                                </span>
                            </label>
                        ))}
                    </div>
                )}
            </section>

            {/* System-prompt editor */}
            <section className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">System prompt (persona)</h3>
                <p className="text-[11px] text-muted-foreground">
                    This sets Jarvis&apos;s persona only. Jarvis always searches the enabled analyses first and stays
                    read-only — you don&apos;t need to list the analyses here.
                </p>
                <textarea
                    value={systemPrompt}
                    onChange={(e) => {
                        setSystemPrompt(e.target.value);
                        setPromptDirty(true);
                    }}
                    placeholder={defaultPrompt}
                    className="w-full min-h-[160px] rounded-md border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                />
                <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground/70">
                        {systemPrompt.trim() === "" ? "Empty → Jarvis uses the default prompt shown above." : ""}
                    </span>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={resetPrompt}
                            disabled={savingPrompt || (systemPrompt === "" && !promptDirty)}
                            className="gap-1.5"
                        >
                            <RotateCcw className="h-3.5 w-3.5" /> Reset to default
                        </Button>
                        <Button size="sm" onClick={savePrompt} disabled={savingPrompt || !promptDirty} className="gap-1.5">
                            {savingPrompt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save
                        </Button>
                    </div>
                </div>
            </section>
        </div>
    );
}
