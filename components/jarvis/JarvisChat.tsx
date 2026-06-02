"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Send,
    Loader2,
    Sparkles,
    ChevronDown,
    ChevronsUpDown,
    Wrench,
    AlertTriangle,
    Settings2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { addJarvisChat } from "@/lib/jarvis/history";
import * as jarvis from "@/lib/jarvis/api";
import { AnalysisApiError } from "@/lib/analysis/api";
import type { ModelOption } from "@/lib/analysis/types";

interface ChatRow {
    id: string;
    role: string;
    kind: string | null;
    content: string | null;
    seq: number;
    tool?: string | null;
    args?: unknown;
}

function parseMeta(m: unknown): Record<string, unknown> {
    if (!m) return {};
    if (typeof m === "string") {
        try {
            return (JSON.parse(m) as Record<string, unknown>) || {};
        } catch {
            return {};
        }
    }
    return m as Record<string, unknown>;
}

function toRow(m: Record<string, unknown>): ChatRow {
    const meta = parseMeta(m.metadata);
    return {
        id: String(m.id),
        role: String(m.role ?? "assistant"),
        kind: (m.type as string) ?? (meta.type as string) ?? null,
        content: (m.content as string) ?? null,
        seq: typeof m.sequence === "number" ? (m.sequence as number) : 0,
        tool: (meta.tool as string) || (meta.name as string) || (meta.tool_name as string) || null,
        args: meta.args ?? null,
    };
}

interface Props {
    chatId: string;
    userId: string | null;
    models: ModelOption[];
    defaultModel: string | null;
    enabledCount: number;
    initialMessage?: string;
    onOpenSettings: () => void;
}

export function JarvisChat({
    chatId,
    userId,
    models,
    defaultModel,
    enabledCount,
    initialMessage,
    onOpenSettings,
}: Props) {
    const supabase = useMemo(() => createClient(), []);
    const [serverRows, setServerRows] = useState<ChatRow[]>([]);
    const [localRows, setLocalRows] = useState<ChatRow[]>([]);
    const [awaiting, setAwaiting] = useState(false);
    const [input, setInput] = useState("");
    const [model, setModel] = useState<string>("");
    const threadRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const sentInitial = useRef(false);

    useEffect(() => {
        if (!model && (defaultModel || models[0])) setModel(defaultModel || models[0]?.id || "");
    }, [defaultModel, models, model]);

    useEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }, [input]);

    // Realtime on chat_messages for this chat, ordered by sequence.
    useEffect(() => {
        let active = true;
        (async () => {
            const { data } = await supabase
                .from("chat_messages")
                .select("id, role, type, content, metadata, sequence, created_at")
                .eq("chat_id", chatId)
                .order("sequence", { ascending: true });
            if (active && data) setServerRows(data.map((r) => toRow(r as Record<string, unknown>)));
        })();

        const upsert = (m: Record<string, unknown>) => {
            const row = toRow(m);
            setServerRows((prev) => {
                const i = prev.findIndex((r) => r.id === row.id);
                if (i === -1) return [...prev, row];
                const next = [...prev];
                next[i] = row;
                return next;
            });
            if (row.role === "assistant" && (row.kind === "final" || row.kind === "error")) {
                setAwaiting(false);
            }
        };

        const channel = supabase.channel(`jarvis-chat:${chatId}`);
        const on = channel.on.bind(channel) as (
            type: "postgres_changes",
            filter: { event: string; schema: string; table: string; filter: string },
            cb: (payload: { new: Record<string, unknown> }) => void
        ) => typeof channel;
        on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chatId}` },
            (p) => upsert(p.new)
        );
        on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chatId}` },
            (p) => upsert(p.new)
        );
        channel.subscribe();
        return () => {
            active = false;
            supabase.removeChannel(channel);
        };
    }, [chatId, supabase]);

    const timeline = useMemo(() => {
        const serverUser = new Set(
            serverRows.filter((r) => r.role === "user").map((r) => (r.content ?? "").trim())
        );
        const locals = localRows.filter(
            (r) => !(r.role === "user" && serverUser.has((r.content ?? "").trim()))
        );
        // local rows sort after server rows of the same time; give them a high seq.
        return [...serverRows, ...locals].sort((a, b) => a.seq - b.seq);
    }, [serverRows, localRows]);

    const groups = useMemo(() => {
        const out: Array<{ type: "user"; row: ChatRow } | { type: "agent"; events: ChatRow[] }> = [];
        for (const row of timeline) {
            if (row.role === "user") out.push({ type: "user", row });
            else {
                const last = out[out.length - 1];
                if (last && last.type === "agent") last.events.push(row);
                else out.push({ type: "agent", events: [row] });
            }
        }
        return out;
    }, [timeline]);

    useEffect(() => {
        threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
    }, [timeline, awaiting]);

    const modelLabel = useMemo(() => {
        const m = models.find((x) => x.id === model);
        return m?.label || m?.name || model || "Model";
    }, [models, model]);

    const send = async (text: string) => {
        const q = text.trim();
        if (!q || awaiting) return;
        // First turn defines the conversation's history entry (title = first msg).
        if (userId && timeline.length === 0) {
            addJarvisChat(userId, { id: chatId, title: q.slice(0, 80), ts: Date.now() });
        }
        const localSeq = 1e9 + localRows.length;
        setLocalRows((prev) => [
            ...prev,
            { id: `local-${Date.now()}`, role: "user", kind: "message", content: q, seq: localSeq },
        ]);
        setInput("");
        setAwaiting(true);
        try {
            await jarvis.sendJarvisChat({
                messages: [{ role: "user", content: q }],
                chat_id: chatId,
                model: model || undefined,
                headless: true,
            });
        } catch (err) {
            const msg =
                err instanceof AnalysisApiError && err.status === 503
                    ? "Jarvis is busy right now — try again shortly."
                    : err instanceof AnalysisApiError
                      ? err.message
                      : "Couldn't reach Jarvis.";
            setLocalRows((prev) => [
                ...prev,
                { id: `local-err-${Date.now()}`, role: "assistant", kind: "error", content: msg, seq: localSeq + 1 },
            ]);
            setAwaiting(false);
        }
    };

    // Auto-send the message passed from the landing hero, once.
    useEffect(() => {
        if (initialMessage && !sentInitial.current && model) {
            sentInitial.current = true;
            send(initialMessage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialMessage, model]);

    return (
        <div className="flex h-full flex-col min-h-0">
            {enabledCount === 0 && (
                <div className="mx-auto mt-3 flex w-full max-w-2xl items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>No analyses are enabled for Jarvis yet.</span>
                    <button onClick={onOpenSettings} className="ml-auto inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
                        <Settings2 className="h-3.5 w-3.5" /> Open settings
                    </button>
                </div>
            )}

            {/* Thread */}
            <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto w-full max-w-2xl p-3 space-y-2">
                    {timeline.length === 0 ? (
                        <div className="text-sm text-muted-foreground/70 leading-relaxed pt-6 text-center">
                            Ask Jarvis anything across your enabled analyses — e.g.{" "}
                            <span className="text-foreground/80">&ldquo;Which open opps mention Snowflake?&rdquo;</span>
                        </div>
                    ) : (
                        groups.map((g, i) =>
                            g.type === "user" ? (
                                <UserRow key={g.row.id} row={g.row} />
                            ) : (
                                <AgentBlock key={`agent-${i}`} events={g.events} />
                            )
                        )
                    )}
                    {awaiting && (
                        <div className="bg-muted/50 mr-6 rounded-lg px-3 py-2 text-sm inline-flex items-center gap-1.5 text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…
                        </div>
                    )}
                </div>
            </div>

            {/* Composer */}
            <div className="border-t border-border p-2 shrink-0">
                <div className="mx-auto w-full max-w-2xl">
                    <div className="rounded-2xl border border-border bg-background transition-shadow focus-within:ring-1 focus-within:ring-primary/40">
                        <textarea
                            ref={taRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    send(input);
                                }
                            }}
                            rows={1}
                            placeholder="Ask Jarvis…"
                            className="block w-full resize-none bg-transparent px-3 pt-3 pb-1.5 text-sm leading-relaxed focus:outline-none placeholder:text-muted-foreground/60"
                        />
                        <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 gap-1 rounded-full px-2.5 text-[11px] font-normal text-muted-foreground hover:text-foreground max-w-[200px]"
                                    >
                                        <Sparkles className="h-3 w-3 text-violet-500 shrink-0" />
                                        <span className="truncate">{modelLabel}</span>
                                        <ChevronDown className="h-3 w-3 shrink-0" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                                    {models.length === 0 ? (
                                        <DropdownMenuItem disabled>No models available</DropdownMenuItem>
                                    ) : (
                                        models.map((m) => (
                                            <DropdownMenuItem key={m.id} onClick={() => setModel(m.id)}>
                                                <span className="truncate">{m.label || m.name || m.id}</span>
                                                <span className="ml-auto pl-2 text-[10px] text-muted-foreground/60 font-mono">
                                                    {m.provider}
                                                </span>
                                            </DropdownMenuItem>
                                        ))
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                                size="icon"
                                onClick={() => send(input)}
                                disabled={!input.trim() || awaiting}
                                className="ml-auto h-8 w-8 rounded-full"
                            >
                                {awaiting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function UserRow({ row }: { row: ChatRow }) {
    return (
        <div className="bg-primary/10 ml-6 rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap">
            {row.content}
        </div>
    );
}

function EventRow({ row }: { row: ChatRow }) {
    if (row.role !== "user" && row.content?.trim() === "processing") return null;
    if (row.kind === "error") {
        return (
            <div className="bg-rose-500/10 text-rose-600 dark:text-rose-300 mr-6 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words">
                {row.content || "Error"}
            </div>
        );
    }
    if (row.kind === "tool_call") {
        let argsPreview = "";
        if (row.args != null) {
            try {
                const s = typeof row.args === "string" ? row.args : JSON.stringify(row.args);
                argsPreview = s.length > 60 ? `${s.slice(0, 60)}…` : s;
            } catch {
                /* ignore */
            }
        }
        return (
            <div className="mr-6 flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground/80">
                <Wrench className="h-3 w-3 text-emerald-600 shrink-0" />
                <span className="text-foreground/80">{row.tool || "tool"}</span>
                {argsPreview && <span className="text-muted-foreground/60 truncate">({argsPreview})</span>}
            </div>
        );
    }
    if (row.kind === "thinking" || row.kind === "status") {
        if (!row.content?.trim()) return null;
        return <div className="mr-6 text-[11px] italic text-muted-foreground/60 line-clamp-2">{row.content}</div>;
    }
    if ((row.kind === "final" || row.kind === "message" || row.kind === "token" || !row.kind) && row.content?.trim()) {
        return (
            <div className="bg-muted/50 mr-6 rounded-lg px-3 py-2 text-sm break-words prose-sm max-w-none overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
                <MarkdownContent content={row.content} compact />
            </div>
        );
    }
    return null;
}

function AgentBlock({ events }: { events: ChatRow[] }) {
    const [open, setOpen] = useState(false);
    const textual = events.filter(
        (e) =>
            (e.kind === "final" || e.kind === "message" || !e.kind) &&
            e.content?.trim() &&
            e.content.trim() !== "processing"
    );
    const finalEvent = textual[textual.length - 1];
    const errors = events.filter((e) => e.kind === "error" && e.content?.trim());
    const intermediate = events.filter(
        (e) =>
            e !== finalEvent &&
            (e.kind === "tool_call" ||
                ((e.kind === "message" || e.kind === "thinking" || e.kind === "status") &&
                    !!e.content?.trim() &&
                    e.content.trim() !== "processing"))
    );
    const actions = intermediate.filter((e) => e.kind === "tool_call").length;
    const msgs = intermediate.length - actions;
    const hasIntermediate = intermediate.length > 0;

    const parts: string[] = [];
    if (msgs > 0) parts.push(`${msgs} message${msgs === 1 ? "" : "s"}`);
    if (actions > 0) parts.push(`${actions} action${actions === 1 ? "" : "s"}`);
    const label = parts.join(" & ") || "details";

    return (
        <div className="mr-6 space-y-1">
            {hasIntermediate && (
                <>
                    <button
                        onClick={() => setOpen((o) => !o)}
                        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 -mx-1.5 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                    >
                        <ChevronsUpDown className="h-3 w-3 shrink-0" />
                        <span>{label}</span>
                    </button>
                    {open && (
                        <div className="ml-2 border-l border-border/50 pl-2.5 space-y-1">
                            {intermediate.map((e) => (
                                <EventRow key={e.id} row={e} />
                            ))}
                        </div>
                    )}
                </>
            )}
            {errors.map((e) => (
                <EventRow key={e.id} row={e} />
            ))}
            {finalEvent && <EventRow key={finalEvent.id} row={finalEvent} />}
        </div>
    );
}
