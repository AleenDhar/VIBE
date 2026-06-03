"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Plus,
    Loader2,
    Trash2,
    Sparkles,
    AlertTriangle,
    Copy,
    Send,
    Table2,
    SquarePen,
} from "lucide-react";
import { cn, uuid } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import * as api from "@/lib/analysis/api";
import { AnalysisApiError } from "@/lib/analysis/api";
import type { Analysis } from "@/lib/analysis/types";
import { JarvisHistoryMenu } from "@/components/jarvis/JarvisHistoryMenu";
import { formatDistanceToNow } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
    draft: "bg-muted text-muted-foreground border-border",
    running: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
    done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    error: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

export function AnalysisListClient() {
    const router = useRouter();
    const [analyses, setAnalyses] = useState<Analysis[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [copyingId, setCopyingId] = useState<string | null>(null);
    const [greeting, setGreeting] = useState("Ask Jarvis");
    const [jarvisInput, setJarvisInput] = useState("");
    const taRef = useRef<HTMLTextAreaElement>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.listAnalyses({ limit: 100 });
            setAnalyses(res.analyses ?? []);
        } catch (err) {
            setError(err instanceof AnalysisApiError ? err.message : "Failed to load analyses.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // Personalize the greeting if we can get a name.
        const supabase = createClient();
        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
                const name = (data?.full_name || "").trim().split(" ")[0];
                if (name) setGreeting(`Ready to dig in, ${name}?`);
            } catch {
                /* keep default */
            }
        })();
    }, []);

    useEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }, [jarvisInput]);

    const askJarvis = () => {
        const msg = jarvisInput.trim();
        try {
            if (msg) sessionStorage.setItem("jarvis:initial", msg);
        } catch {
            /* ignore */
        }
        router.push(`/analysis/jarvis/${uuid()}`);
    };

    const handleCreate = async () => {
        if (!title.trim() || creating) return;
        setCreating(true);
        try {
            const created = await api.createAnalysis({
                title: title.trim(),
                description: description.trim() || undefined,
            });
            router.push(`/analysis/${created.id}`);
        } catch (err) {
            alert(err instanceof AnalysisApiError ? err.message : "Failed to create analysis.");
            setCreating(false);
        }
    };

    const handleCopy = async (a: Analysis) => {
        setCopyingId(a.id);
        try {
            const created = await api.duplicateAnalysis(a);
            setAnalyses((prev) => [created, ...prev]);
        } catch (err) {
            alert(err instanceof AnalysisApiError ? err.message : "Failed to copy analysis.");
        } finally {
            setCopyingId(null);
        }
    };

    const handleDelete = async (a: Analysis) => {
        if (!confirm(`Delete "${a.title}" and all its data?`)) return;
        setDeletingId(a.id);
        try {
            await api.deleteAnalysis(a.id);
            setAnalyses((prev) => prev.filter((x) => x.id !== a.id));
        } catch (err) {
            alert(err instanceof AnalysisApiError ? err.message : "Failed to delete.");
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="flex flex-col w-full max-w-screen-xl mx-auto px-4 py-6 gap-8">
            {/* Top bar (navbar is hidden on this page) */}
            <div className="flex items-center justify-between gap-2">
                <Link href="/analysis" className="inline-flex items-center gap-2 font-medium text-foreground">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    Analysis
                </Link>
                <div className="flex items-center gap-2">
                    <JarvisHistoryMenu />
                    <Button size="sm" className="gap-1.5" onClick={() => router.push(`/analysis/jarvis/${uuid()}`)}>
                        <SquarePen className="h-4 w-4" />
                        New chat
                    </Button>
                </div>
            </div>

            {/* Hero — Jarvis composer */}
            <div className="flex flex-col items-center text-center gap-5 pt-2">
                <h1 className="text-2xl md:text-3xl font-serif font-medium tracking-tight text-foreground">
                    {greeting}
                </h1>
                <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-sm transition-shadow focus-within:ring-1 focus-within:ring-primary/40">
                    <textarea
                        ref={taRef}
                        value={jarvisInput}
                        onChange={(e) => setJarvisInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                askJarvis();
                            }
                        }}
                        rows={1}
                        placeholder="Ask Jarvis across your analyses…"
                        className="block w-full resize-none bg-transparent px-4 pt-4 pb-1.5 text-sm leading-relaxed focus:outline-none placeholder:text-muted-foreground/60"
                    />
                    <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-0.5">
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Sparkles className="h-3.5 w-3.5 text-violet-500" /> Jarvis
                        </span>
                        <Button
                            size="icon"
                            onClick={askJarvis}
                            className="ml-auto h-8 w-8 rounded-full"
                            title="Ask Jarvis"
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground/70 max-w-md">
                    Jarvis searches across your enabled analyses (read-only). Tune which ones in its settings.
                </p>
            </div>

            {/* Analyses */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-medium text-foreground">Analyses</h2>
                    <Button onClick={() => setCreateOpen(true)} leftIcon={Plus} size="sm">
                        New analysis
                    </Button>
                </div>

                {error && (
                    <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                            <Skeleton key={i} className="h-32 w-full" />
                        ))}
                    </div>
                ) : analyses.length === 0 ? (
                    <div className="border border-dashed border-border/50 rounded-xl p-12 text-center">
                        <Table2 className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                        <div className="text-muted-foreground">
                            No analyses yet. Create one and chat with the agent to build it.
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {analyses.map((a) => (
                            <div
                                key={a.id}
                                className="group relative rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/30"
                            >
                                <Link href={`/analysis/${a.id}`} className="block">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <span className="font-medium text-foreground truncate flex-1 min-w-0">
                                            {a.title}
                                        </span>
                                        {a.status && (
                                            <span
                                                className={cn(
                                                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                                    STATUS_STYLES[a.status] ?? STATUS_STYLES.draft
                                                )}
                                            >
                                                {a.status}
                                            </span>
                                        )}
                                    </div>
                                    {a.description ? (
                                        <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                                            {a.description}
                                        </p>
                                    ) : (
                                        <p className="text-xs text-muted-foreground/40 italic min-h-[2rem]">
                                            No description
                                        </p>
                                    )}
                                    <div className="text-[10px] text-muted-foreground/60 mt-3">
                                        Created {formatDistanceToNow(new Date(a.created_at))} ago
                                    </div>
                                </Link>

                                {/* Hover actions */}
                                <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 bg-background/80 text-muted-foreground hover:text-foreground"
                                        onClick={() => handleCopy(a)}
                                        disabled={copyingId === a.id}
                                        title="Duplicate (columns only)"
                                    >
                                        {copyingId === a.id ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Copy className="h-3.5 w-3.5" />
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 bg-background/80 text-muted-foreground hover:text-destructive"
                                        onClick={() => handleDelete(a)}
                                        disabled={deletingId === a.id}
                                        title="Delete"
                                    >
                                        {deletingId === a.id ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-3.5 w-3.5" />
                                        )}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New analysis</DialogTitle>
                        <DialogDescription>
                            Give it a title. You&apos;ll build rows and columns by chatting with the agent.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Title</label>
                            <input
                                autoFocus
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                                placeholder="Q3 at-risk renewals"
                                className="mt-1 w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">
                                Description (optional)
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="What are we analyzing and why?"
                                className="mt-1 w-full min-h-[60px] bg-background border border-border rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={!title.trim() || creating} isLoading={creating}>
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
