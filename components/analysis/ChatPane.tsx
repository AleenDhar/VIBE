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
    ChevronRight,
    ChevronsUpDown,
    Paperclip,
    X,
    FileText,
    Wrench,
    SquarePen,
} from "lucide-react";
import { uuid } from "@/lib/utils";
import * as api from "@/lib/analysis/api";
import { AnalysisApiError } from "@/lib/analysis/api";
import { createClient } from "@/lib/supabase/client";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { extractFileContent } from "@/lib/extract-file-content";
import type { AnalysisData } from "@/lib/analysis/useAnalysisData";
import type { ModelOption } from "@/lib/analysis/types";

interface Props {
    analysisId: string;
    data: AnalysisData;
    models: ModelOption[];
    defaultModel: string | null;
}

interface ChatRow {
    id: string;
    role: string;
    kind: string | null; // status | tool_call | tool_result | thinking | token | final | message | error
    content: string | null;
    created_at: string;
    tool?: string | null;
    args?: unknown;
    images?: string[]; // data URLs (user-pasted)
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
        images: Array.isArray(meta.images) ? (meta.images as string[]) : undefined,
    };
}

export function ChatPane({ analysisId, data, models, defaultModel }: Props) {
    const supabase = useMemo(() => createClient(), []);
    const projectId = data.analysis?.project_id ?? undefined;

    const [chatId, setChatId] = useState<string>("");
    const [serverRows, setServerRows] = useState<ChatRow[]>([]);
    const [localRows, setLocalRows] = useState<ChatRow[]>([]); // optimistic user msgs + local errors
    const [awaiting, setAwaiting] = useState(false);

    const [input, setInput] = useState("");
    const [model, setModel] = useState<string>("");
    const [attachments, setAttachments] = useState<string[]>([]);
    const [uploading, setUploading] = useState(false);
    const [attachError, setAttachError] = useState<string | null>(null);
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [hasOlder, setHasOlder] = useState(true);

    const threadRef = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const atBottomRef = useRef(true);
    // Newest created_at when we send, so we only clear the spinner when a
    // terminal row arrives AFTER that (works even though we load a recent
    // window, where the old-final COUNT can shift).
    const baselineAt = useRef("");
    const maxCreatedAt = (rows: ChatRow[]) => rows.reduce((m, r) => (r.created_at > m ? r.created_at : m), "");
    const PAGE = 400;
    // Merge incoming rows by id (sorted chrono) so loading older history isn't
    // wiped by the poll/realtime — they extend the same set.
    const mergeServerRows = (incoming: ChatRow[]) =>
        setServerRows((prev) => {
            const map = new Map(prev.map((r) => [r.id, r]));
            for (const r of incoming) map.set(r.id, r);
            return Array.from(map.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
        });

    // Auto-grow the editor up to a cap.
    useEffect(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    }, [input]);

    // Conversation id for the analysis chat. DEFAULT is the analysis id itself —
    // deterministic, so the conversation is the SAME across browsers / devices /
    // prod (localStorage is per-origin, which is why history was missing in
    // production). "New chat" stores a per-browser override under a separate key.
    useEffect(() => {
        let id = "";
        try {
            id = localStorage.getItem(`analysis:chatx:${analysisId}`) || "";
        } catch {
            /* ignore */
        }
        setChatId(id || analysisId);
    }, [analysisId]);

    // Seed the model picker once models load.
    useEffect(() => {
        if (!model && (defaultModel || models[0])) setModel(defaultModel || models[0]?.id || "");
    }, [defaultModel, models, model]);


    // Load history + subscribe to live agent events on chat_messages.
    useEffect(() => {
        if (!chatId) return;
        let active = true;

        setHasOlder(true);
        (async () => {
            // Load the most RECENT window (PostgREST caps at ~1000 rows, and a
            // chat can have thousands), newest-first then reversed to chrono.
            const { data: rows } = await supabase
                .from("chat_messages")
                .select("id, role, type, content, metadata, created_at")
                .eq("chat_id", chatId)
                .order("created_at", { ascending: false })
                .limit(PAGE);
            if (!active || !rows) return;
            setServerRows(rows.map((r) => toRow(r as Record<string, unknown>)).reverse());
            if (rows.length < PAGE) setHasOlder(false);
        })();

        const upsert = (m: Record<string, unknown>) => {
            mergeServerRows([toRow(m)]);
            // awaiting is cleared centrally (see effect below).
        };

        const channel = supabase.channel(`analysis-chat:${chatId}`);
        // supabase-js's postgres_changes overload is awkward to satisfy; cast
        // `.on` to a permissive signature (same approach as lib/analysis/realtime).
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

    // Polling fallback while a turn is in progress — realtime can be flaky, so
    // this guarantees the agent's events stream in without a manual reload.
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

    // Clear the spinner only when a NEW terminal row arrives after we sent —
    // counts against the baseline so old answers in history don't end it early.
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

    // Merge server + optimistic rows; drop optimistic user rows once the server
    // echoes the same content.
    const timeline = useMemo(() => {
        const serverUserContent = new Set(
            serverRows.filter((r) => r.role === "user").map((r) => (r.content ?? "").trim())
        );
        const locals = localRows.filter(
            (r) => !(r.role === "user" && serverUserContent.has((r.content ?? "").trim()))
        );
        return [...serverRows, ...locals].sort((a, b) => a.created_at.localeCompare(b.created_at));
    }, [serverRows, localRows]);

    // Group the flat timeline into turns: each user message is its own row;
    // every contiguous run of assistant events becomes one collapsible block
    // (intermediate thinking/tool-calls hidden, final answer shown).
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
                // A terminal row ends the turn so back-to-back agent turns don't
                // merge into one block (which would hide earlier answers).
                if (row.kind === "final" || row.kind === "error") current = null;
            }
        }
        return out;
    }, [timeline]);

    // Auto-scroll to the latest only when the user is already near the bottom —
    // don't yank them down while they're reading older history.
    useEffect(() => {
        if (atBottomRef.current) {
            threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
        }
    }, [timeline, awaiting]);

    // Load an older page of history, preserving the scroll position.
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

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (fileRef.current) fileRef.current.value = "";
        if (!f || !chatId) return;
        setAttachError(null);
        // The documents table requires a project_id; ingestion can't work for a
        // project-less analysis. Fail fast with a clear message.
        if (!projectId) {
            setAttachError("File ingestion needs this analysis to belong to a project.");
            return;
        }
        setUploading(true);
        try {
            const content = await extractFileContent(f);
            if (!content.trim()) throw new Error("No text could be extracted from this file.");
            await api.uploadDocument({ content, name: f.name, chat_id: chatId, project_id: projectId });
            setAttachments((prev) => [...prev, f.name]);
        } catch (err) {
            setAttachError(
                err instanceof AnalysisApiError || err instanceof Error
                    ? err.message
                    : "Couldn't ingest that file."
            );
        } finally {
            setUploading(false);
        }
    };

    // Paste images straight into the composer (Ctrl/Cmd+V). Read each as a data
    // URL so it can be passed inline to the agent (messages[].images).
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const imageItems = Array.from(items).filter((it) => it.type.startsWith("image/"));
        if (imageItems.length === 0) return;
        e.preventDefault(); // don't also paste a file path/text
        for (const it of imageItems) {
            const file = it.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = () => {
                const url = reader.result as string;
                if (url) setPendingImages((prev) => [...prev, url]);
            };
            reader.readAsDataURL(file);
        }
    };

    const send = async () => {
        const text = input.trim();
        const images = pendingImages;
        if ((!text && images.length === 0) || awaiting || !chatId) return;

        const localId = `local-${Date.now()}`;
        const ts = Date.now();
        setLocalRows((prev) => [
            ...prev,
            {
                id: localId,
                role: "user",
                kind: "message",
                content: text,
                images: images.length ? images : undefined,
                created_at: new Date(ts).toISOString(),
            },
        ]);
        setPendingImages([]);
        setInput("");
        baselineAt.current = maxCreatedAt(serverRows);
        setAwaiting(true);

        // Persist the user turn to chat_messages (DB history, not localStorage).
        await api.postUserMessage(chatId, text);

        // The backend doesn't reconstruct history from chat_id, so we send the
        // prior conversation (each turn's user message + final answer) plus the
        // new message. `timeline` here is still the pre-send value (state update
        // is async), so it holds the prior turns only.
        const history = timeline
            .filter(
                (r) =>
                    (r.role === "user" && r.content?.trim()) ||
                    (r.role === "assistant" && r.kind === "final" && r.content?.trim())
            )
            .slice(-40)
            .map((r) => ({ role: r.role === "user" ? "user" : "assistant", content: r.content as string }));

        // Tools take an analysis_id arg, so tell the agent which analysis to act
        // on (system prompt is the cleanest place — keeps the user message clean).
        const systemPrompt =
            `You are operating inside an Analysis workspace. The current analysis_id is "${analysisId}". ` +
            `When the user asks to add or edit rows/columns/dashboards, run the analysis, or otherwise change it, ` +
            `call the appropriate analysis tools with analysis_id="${analysisId}". Operate on this analysis unless told otherwise.`;

        try {
            await api.sendAgentChat({
                messages: [
                    ...history,
                    {
                        role: "user",
                        content: text,
                        ...(images.length ? { images } : {}),
                    },
                ],
                model: model || undefined,
                chat_id: chatId,
                project_id: projectId,
                system_prompt: systemPrompt,
                stream: true,
                headless: true,
            });
        } catch (err) {
            const msg =
                err instanceof AnalysisApiError && err.status === 409
                    ? "A run is already in progress for this conversation — wait for it to finish."
                    : err instanceof AnalysisApiError
                      ? err.message
                      : "Couldn't reach the agent.";
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

    // Start a fresh conversation: new chat_id, clear the thread, drop the old
    // persisted user turns.
    const newChat = () => {
        const id = uuid();
        try {
            localStorage.setItem(`analysis:chatx:${analysisId}`, id);
        } catch {
            /* ignore */
        }
        setServerRows([]);
        setLocalRows([]);
        setAwaiting(false);
        setInput("");
        setPendingImages([]);
        setChatId(id);
    };

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
                {timeline.length === 0 ? (
                    <div className="text-xs text-muted-foreground/70 leading-relaxed">
                        Ask the agent to build or analyze this sheet — e.g.{" "}
                        <span className="text-foreground/80">
                            &ldquo;Add 25 opps in stage Negotiation with amount &gt; 50k&rdquo;
                        </span>
                        ,{" "}
                        <span className="text-foreground/80">
                            &ldquo;Add an AI column &lsquo;Risk&rsquo; using GPT-4o that rates renewal risk&rdquo;
                        </span>
                        , or{" "}
                        <span className="text-foreground/80">&ldquo;Which opps are at risk and why?&rdquo;</span>
                    </div>
                ) : (
                    groups.map((g, i) =>
                        g.type === "user" ? (
                            <Row key={g.row.id} row={g.row} />
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

            {/* Composer — single unified box: editor on top, toolbar below */}
            <div className="border-t border-border p-2 shrink-0">
                <div className="mx-auto w-full max-w-2xl">
                {attachError && <div className="px-1 pb-1 text-[11px] text-rose-500">{attachError}</div>}

                <div className="rounded-2xl border border-border bg-background transition-shadow focus-within:ring-1 focus-within:ring-primary/40">
                    {/* Attachment chips */}
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                            {attachments.map((name, i) => (
                                <div
                                    key={`${name}-${i}`}
                                    className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] max-w-full"
                                    title="Ingested — the agent can retrieve this"
                                >
                                    <FileText className="h-3 w-3 shrink-0 text-emerald-600" />
                                    <span className="truncate">{name}</span>
                                    <button
                                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                                        className="text-muted-foreground hover:text-foreground shrink-0"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Pasted image previews */}
                    {pendingImages.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-3 pt-2.5">
                            {pendingImages.map((src, i) => (
                                <div key={i} className="relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={src}
                                        alt="pasted"
                                        className="h-16 w-16 rounded-md border border-border object-cover"
                                    />
                                    <button
                                        onClick={() =>
                                            setPendingImages((prev) => prev.filter((_, j) => j !== i))
                                        }
                                        className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5 text-muted-foreground shadow hover:text-foreground"
                                        title="Remove image"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Editor */}
                    <textarea
                        ref={taRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                send();
                            }
                        }}
                        rows={1}
                        placeholder="Message the agent… (paste an image with Ctrl/Cmd+V)"
                        className="block w-full resize-none bg-transparent px-3 pt-3 pb-1.5 text-sm leading-relaxed focus:outline-none placeholder:text-muted-foreground/60"
                    />

                    {/* Toolbar */}
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

                        <input
                            ref={fileRef}
                            type="file"
                            accept=".pdf,.docx,.doc,.txt,.md,.csv,.xlsx,.xls"
                            onChange={handleFile}
                            className="hidden"
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading}
                            title="Attach a document (PDF, DOCX, CSV, TXT…) for the agent to reference"
                        >
                            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                        </Button>

                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                            onClick={newChat}
                            title="New chat"
                        >
                            <SquarePen className="h-3.5 w-3.5" />
                        </Button>

                        <Button
                            size="icon"
                            onClick={send}
                            disabled={(!input.trim() && pendingImages.length === 0) || awaiting}
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

function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `worked for ${s}s`;
    return `worked for ${Math.round(s / 60)} min`;
}

// One contiguous run of agent events. Intermediate thinking / tool-calls /
// interim messages collapse under a "N messages & M actions" toggle; the final
// answer (and any errors) render expanded below.
function AgentBlock({ events, live }: { events: ChatRow[]; live?: boolean }) {
    const [open, setOpen] = useState(false);
    // While the turn is in progress, auto-expand so the tool calls / thinking
    // stream live; once it finishes it collapses (unless the user opened it).
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

    const durMs =
        events.length > 1
            ? new Date(events[events.length - 1].created_at).getTime() -
              new Date(events[0].created_at).getTime()
            : 0;

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
                        {durMs > 1500 && (
                            <span className="text-muted-foreground/50">· {formatDuration(durMs)}</span>
                        )}
                    </button>
                    {showSteps && (
                        <div className="ml-2 border-l border-border/50 pl-2.5 space-y-1">
                            {intermediate.map((e) => (
                                <Row key={e.id} row={e} />
                            ))}
                        </div>
                    )}
                </>
            )}
            {errors.map((e) => (
                <Row key={e.id} row={e} />
            ))}
            {finalEvent && <FinalAnswer key={finalEvent.id} row={finalEvent} />}
        </div>
    );
}

// The agent's final answer — collapsible, collapsed by default (answers can be
// long). Shows a one-line preview when collapsed.
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

// Render one chat_messages event by kind.
function Row({ row }: { row: ChatRow }) {
    // The backend emits a "processing" placeholder while a turn spins up — it's
    // noise, not content.
    if (row.role !== "user" && row.content?.trim() === "processing") return null;

    if (row.role === "user") {
        return (
            <div className="bg-primary/10 ml-6 rounded-lg px-3 py-2 text-sm break-words">
                {row.images && row.images.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {row.images.map((src, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                key={i}
                                src={src}
                                alt="attachment"
                                className="max-h-40 rounded-md border border-border object-contain"
                            />
                        ))}
                    </div>
                )}
                {row.content && <div className="whitespace-pre-wrap">{row.content}</div>}
            </div>
        );
    }

    // assistant variants
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
        return (
            <div className="mr-6 text-[11px] italic text-muted-foreground/60 line-clamp-2">{row.content}</div>
        );
    }
    // final / message / plain text — render markdown (parsed), not raw syntax.
    if ((row.kind === "final" || row.kind === "message" || !row.kind) && row.content?.trim()) {
        return (
            <div className="bg-muted/50 mr-6 rounded-lg px-3 py-2 text-sm break-words prose-sm max-w-none overflow-x-auto [&_table]:block [&_table]:overflow-x-auto">
                <MarkdownContent content={row.content} compact />
            </div>
        );
    }
    return null; // token / tool_result / empty — skip
}
