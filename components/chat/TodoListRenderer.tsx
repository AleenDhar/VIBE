"use client";

// Detects the agent's `write_todos` output and renders it as a small card
// with a progress bar + checklist instead of raw text. The agent emits two
// kinds of messages we care about:
//   1. "todos: 4 items (1 pending / 1 in_progress / 2 completed)" — summary
//   2. "Updated todo list to [{'content': '...', 'status': '...'}, ...]" — full list
//
// We render either / both into a single styled block.

import { Check, Circle, CircleDot, Loader2 } from "lucide-react";

interface TodoItem {
    content: string;
    status: "pending" | "in_progress" | "completed";
}

interface Parsed {
    pending: number;
    in_progress: number;
    completed: number;
    total: number;
    items: TodoItem[] | null;
}

// Matches: "todos: 4 items (1 pending / 1 in_progress / 2 completed)"
const SUMMARY_RE = /^todos:\s*(\d+)\s*items?\s*\(\s*(\d+)\s*pending\s*\/\s*(\d+)\s*in_progress\s*\/\s*(\d+)\s*completed\s*\)/i;

// Matches: "Updated todo list to [...]" — value may use single or double quotes
const UPDATED_RE = /^Updated todo list to\s*(\[.*\])/i;

export function isTodoMessage(content: string): boolean {
    const trimmed = (content || "").trim();
    return SUMMARY_RE.test(trimmed) || UPDATED_RE.test(trimmed);
}

function parseTodoContent(content: string): Parsed | null {
    const trimmed = (content || "").trim();

    // Summary form
    const sm = trimmed.match(SUMMARY_RE);
    if (sm) {
        return {
            total: parseInt(sm[1], 10),
            pending: parseInt(sm[2], 10),
            in_progress: parseInt(sm[3], 10),
            completed: parseInt(sm[4], 10),
            items: null,
        };
    }

    // Full list form — content is a Python repr or JSON-ish list. Try
    // JSON.parse after normalising single quotes to double quotes (lossy
    // but good enough for typical agent output).
    const um = trimmed.match(UPDATED_RE);
    if (um) {
        const rawArr = um[1];
        let items: TodoItem[] | null = null;
        try {
            const jsonLike = rawArr.replace(/'/g, '"');
            const parsed = JSON.parse(jsonLike);
            if (Array.isArray(parsed)) {
                items = parsed
                    .map((p: any) => ({
                        content: String(p?.content ?? "").trim(),
                        status: (p?.status === "completed" || p?.status === "in_progress" || p?.status === "pending")
                            ? p.status
                            : "pending",
                    }))
                    .filter((t: TodoItem) => t.content.length > 0);
            }
        } catch {
            /* fall through — we still show a list-style placeholder */
        }
        const completed = items?.filter(i => i.status === "completed").length ?? 0;
        const in_progress = items?.filter(i => i.status === "in_progress").length ?? 0;
        const pending = items?.filter(i => i.status === "pending").length ?? 0;
        return {
            total: items?.length ?? 0,
            pending,
            in_progress,
            completed,
            items,
        };
    }

    return null;
}

export function TodoListRenderer({ content }: { content: string }) {
    const parsed = parseTodoContent(content);
    if (!parsed) return null;

    const pct = parsed.total > 0
        ? Math.round((parsed.completed / parsed.total) * 100)
        : 0;

    return (
        <div className="my-2 rounded-lg border border-border bg-muted/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border/40">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <CircleDot className="h-3.5 w-3.5 text-primary" />
                    Todos
                    <span className="text-muted-foreground/70 font-normal">
                        {parsed.completed} / {parsed.total}
                    </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    {parsed.in_progress > 0 && (
                        <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            {parsed.in_progress} running
                        </span>
                    )}
                    {parsed.pending > 0 && (
                        <span>{parsed.pending} pending</span>
                    )}
                </div>
            </div>

            {/* progress bar */}
            <div className="h-1 bg-muted/60 relative">
                <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${pct}%` }}
                />
                {parsed.in_progress > 0 && (
                    <div
                        className="h-full bg-sky-500 absolute top-0 transition-all"
                        style={{
                            left: `${pct}%`,
                            width: `${(parsed.in_progress / Math.max(parsed.total, 1)) * 100}%`,
                        }}
                    />
                )}
            </div>

            {/* item list — only if we managed to parse the full array */}
            {parsed.items && parsed.items.length > 0 && (
                <ul className="px-3 py-2 space-y-1.5">
                    {parsed.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                            {item.status === "completed" && (
                                <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                            )}
                            {item.status === "in_progress" && (
                                <Loader2 className="h-3.5 w-3.5 text-sky-500 shrink-0 mt-0.5 animate-spin" />
                            )}
                            {item.status === "pending" && (
                                <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
                            )}
                            <span className={
                                item.status === "completed"
                                    ? "text-muted-foreground/70 line-through"
                                    : item.status === "in_progress"
                                        ? "text-foreground font-medium"
                                        : "text-foreground/80"
                            }>
                                {item.content}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
