"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Send, Loader2, Sparkles, ChevronDown, ChevronRight, ChevronsUpDown, Wrench } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { addJarvisChat } from "@/lib/jarvis/history";
import * as jarvis from "@/lib/jarvis/api";
import { AnalysisApiError, postUserMessage } from "@/lib/analysis/api";
import type { ModelOption } from "@/lib/analysis/types";

interface ChatRow {
    id: string;
    role: string;
    kind: string | null;
    content: string | null;
    created_at: string;
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
        created_at: String(m.created_at ?? new Date().toISOString()),
        tool: (meta.tool as string) || (meta.name as string) || (meta.tool_name as string) || null,
        args: meta.args ?? null,
    };
}

interface Props {
    chatId: string;
    userId: string | null;
    models: ModelOption[];
    defaultModel: string | null;
    initialMessage?: string;
    loading?: boolean;
}

export function JarvisChat({ chatId, userId, models, defaultModel, initialMessage, loading }: Props) {
    const supabase = useMemo(() => createClient(), []);
    const [serverRows, setServerRows] = useState<ChatRow[]>([]);
    const [localRows, setLocalRows] = useState<ChatRow[]>([]);
    const [awaiting, setAwaiting] = useState(false);
    const [input, setInput] = useState("");
    const [model, setModel] = useState<string>("");
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [hasOlder, setHasOlder] = useState(true);
    const threadRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const sentInitial = useRef(false);
    const atBottomRef = useRef(true);
    // Newest created_at at send time, so we clear the spinner only on a terminal
    // row that arrives after it (robust to the recent-window load).
    const baselineAt = useRef("");
    const maxCreatedAt = (rows: ChatRow[]) => rows.reduce((m, r) => (r.created_at > m ? r.created_at : m), "");
    const PAGE = 400;
    const mergeServerRows = (incoming: ChatRow[]) =>
        setServerRows((prev) => {
            const map = new Map(prev.map((r) => [r.id, r]));
            for (const r of incoming) map.set(r.id, r);
            return Array.from(map.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
        });

    useEffect(() => {
        if (!model && (defaultModel || models[0])) setModel(defaultModel || models[0]?.id || "");
    }, [defaultModel, models, model]);

    useEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }, [input]);

    // Realtime on chat_messages for this chat. Load the most recent window
    // (newest-first + cap, then reverse) since a chat can exceed PostgREST's
    // 1000-row default and the recent part is what matters.
    useEffect(() => {
        let active = true;
        setHasOlder(true);
        (async () => {
            const { data } = await supabase
                .from("chat_messages")
                .select("id, role, type, content, metadata, created_at")
                .eq("chat_id", chatId)
                .order("created_at", { ascending: false })
                .limit(PAGE);
            if (!active || !data) return;
            setServerRows(data.map((r) => toRow(r as Record<string, unknown>)).reverse());
            if (data.length < PAGE) setHasOlder(false);
        })();

        const upsert = (m: Record<string, unknown>) => {
            mergeServerRows([toRow(m)]);
            // awaiting is cleared centrally (see effect below).
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

    // Polling fallback while a turn is in progress. Realtime postgres_changes
    // can be flaky (the main app chat uses the same fallback), so this guarantees
    // the conversation streams in without a manual reload.
    useEffect(() => {
        if (!awaiting) return;
        let cancelled = false;
        const tick = async () => {
            const { data } = await supabase
                .from("chat_messages")
                .select("id, role, type, content, metadata, created_at")
                .eq("chat_id", chatId)
                .order("created_at", { ascending: false })
                .limit(PAGE);
            if (cancelled || !data) return;
            mergeServerRows(data.map((r) => toRow(r as Record<string, unknown>)));
        };
        const interval = setInterval(tick, 2500);
        tick();
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [awaiting, chatId, supabase]);

    // Clear the spinner only when a terminal row arrives after we sent.
    useEffect(() => {
        if (
            awaiting &&
            serverRows.some(
                (r) =>
                    r.role === "assistant" &&
                    (r.kind === "final" || r.kind === "error") &&
                    r.created_at > baselineAt.current
            )
        ) {
            setAwaiting(false);
        }
    }, [serverRows, awaiting]);

    const timeline = useMemo(() => {
        const serverUser = new Set(
            serverRows.filter((r) => r.role === "user").map((r) => (r.content ?? "").trim())
        );
        const locals = localRows.filter(
            (r) => !(r.role === "user" && serverUser.has((r.content ?? "").trim()))
        );
        return [...serverRows, ...locals].sort((a, b) => a.created_at.localeCompare(b.created_at));
    }, [serverRows, localRows]);

    const groups = useMemo(() => {
        const out: Array<{ type: "user"; row: ChatRow } | { type: "agent"; events: ChatRow[] }> = [];
        let current: { type: "agent"; events: ChatRow[] } | null = null;
        for (const row of timeline) {
            if (row.role === "user") {
                current = null;
                out.push({ type: "user", row });
            } else {
                if (!current) {
                    current = { type: "agent", events: [] };
                    out.push(current);
                }
                current.events.push(row);
                // A terminal row ends the turn so the NEXT assistant rows form a
                // new block — otherwise back-to-back turns merge and earlier
                // answers (their `final`) get hidden.
                if (row.kind === "final" || row.kind === "error") current = null;
            }
        }
        return out;
    }, [timeline]);

    useEffect(() => {
        if (atBottomRef.current) {
            threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
        }
    }, [timeline, awaiting]);

    const loadOlder = async () => {
        if (loadingOlder || !hasOlder) return;
        const oldest = serverRows.reduce((m, r) => (!m || r.created_at < m ? r.created_at : m), "");
        if (!oldest) return;
        setLoadingOlder(true);
        try {
            const { data } = await supabase
                .from("chat_messages")
                .select("id, role, type, content, metadata, created_at")
                .eq("chat_id", chatId)
                .lt("created_at", oldest)
                .order("created_at", { ascending: false })
                .limit(PAGE);
            const older = (data ?? []).map((r) => toRow(r as Record<string, unknown>));
            if (older.length < PAGE) setHasOlder(false);
            if (older.length) {
                const el = threadRef.current;
                const prevHeight = el?.scrollHeight ?? 0;
                mergeServerRows(older);
                requestAnimationFrame(() => {
                    if (el) el.scrollTop += el.scrollHeight - prevHeight;
                });
            }
        } finally {
            setLoadingOlder(false);
        }
    };

    const onThreadScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (el.scrollTop < 80 && hasOlder && !loadingOlder) loadOlder();
    };

    const modelLabel = useMemo(() => {
        const m = models.find((x) => x.id === model);
        return m?.label || m?.name || model || "Model";
    }, [models, model]);

    const send = async (text: string) => {
        const q = text.trim();
        if (!q || awaiting) return;
        // First turn registers the conversation in the DB (jarvis_chats).
        if (userId && timeline.length === 0) {
            addJarvisChat(supabase, userId, { id: chatId, title: q.slice(0, 80) }).catch(() => {});
        }
        const localId = `local-${Date.now()}`;
        setLocalRows((prev) => [
            ...prev,
            { id: localId, role: "user", kind: "message", content: q, created_at: new Date().toISOString() },
        ]);
        setInput("");
        baselineAt.current = maxCreatedAt(serverRows);
        setAwaiting(true);
        // Persist the user turn to chat_messages, then fire the agent.
        await postUserMessage(chatId, q);

        // Send the prior conversation (user turns + final answers) + the new
        // message — the backend doesn't reconstruct it from chat_id. `timeline`
        // is still the pre-send value here.
        const history = timeline
            .filter(
                (r) =>
                    (r.role === "user" && r.content?.trim()) ||
                    (r.role === "assistant" && r.kind === "final" && r.content?.trim())
            )
            .slice(-40)
            .map((r) => ({ role: r.role === "user" ? "user" : "assistant", content: r.content as string }));

        try {
            await jarvis.sendJarvisChat({
                messages: [...history, { role: "user", content: q }],
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
                {
                    id: `local-err-${Date.now()}`,
                    role: "assistant",
                    kind: "error",
                    content: msg,
                    created_at: new Date().toISOString(),
                },
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
            {/* Thread */}
            <div ref={threadRef} onScroll={onThreadScroll} className="flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto w-full max-w-2xl p-3 space-y-2">
                    {loadingOlder && (
                        <div className="flex justify-center py-1 text-[11px] text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        </div>
                    )}
                    {loading && timeline.length === 0 ? (
                        <div className="space-y-3 pt-2">
                            <Skeleton className="h-16 w-3/4" />
                            <Skeleton className="ml-auto h-10 w-1/2" />
                            <Skeleton className="h-24 w-3/4" />
                        </div>
                    ) : (
                        groups.map((g, i) =>
                            g.type === "user" ? (
                                <UserRow key={g.row.id} row={g.row} />
                            ) : (
                                <AgentBlock
                                    key={`agent-${i}`}
                                    events={g.events}
                                    live={awaiting && i === groups.length - 1}
                                />
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

function AgentBlock({ events, live }: { events: ChatRow[]; live?: boolean }) {
    const [open, setOpen] = useState(false);
    const showSteps = open || !!live;
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
                        {live ? (
                            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-500" />
                        ) : (
                            <ChevronsUpDown className="h-3 w-3 shrink-0" />
                        )}
                        <span>{label}</span>
                    </button>
                    {showSteps && (
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
            {finalEvent && <FinalAnswer key={finalEvent.id} row={finalEvent} />}
        </div>
    );
}

// Collapsible final answer, collapsed by default (answers can be long).
function FinalAnswer({ row }: { row: ChatRow }) {
    const [open, setOpen] = useState(false);
    const preview = (row.content || "")
        .replace(/[#*`_>~]|\[|\]|\(.*?\)/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 90);
    return (
        <div className="mr-6 overflow-hidden rounded-lg border border-border/60 bg-muted/40">
            <button
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60"
            >
                {open ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="shrink-0 font-medium text-foreground/90">Final answer</span>
                {!open && preview && (
                    <span className="truncate text-muted-foreground">— {preview}…</span>
                )}
            </button>
            {open && (
                <div className="break-words px-3 pb-3 text-sm prose-sm max-w-none overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
                    <MarkdownContent content={row.content || ""} compact />
                </div>
            )}
        </div>
    );
}
