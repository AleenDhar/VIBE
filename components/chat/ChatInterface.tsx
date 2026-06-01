"use client";

import { createElement, Fragment, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Send, Upload, RotateCcw, Copy, Check, ThumbsUp, ThumbsDown, Paperclip, Mic, FileText as FileIcon, Loader2, Bot, User, MicOff, Square, ChevronDown, ChevronRight, Plus, Download, Image as ImageIcon, X, Brain } from "lucide-react";
import { cn, uuid } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { isTodoMessage } from "@/components/chat/TodoListRenderer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createNewChat } from "@/lib/actions/chat";
import { extractFileContent } from "@/lib/extract-file-content";
import { addDocument } from "@/lib/actions/documents";
import { exportToPDF, exportToDocx } from "@/lib/export-utils";
import { extractBehavioralInstructions } from "@/lib/actions/instructions";
import { getActiveModels, getUserAllowedModels, AIModel } from "@/lib/actions/models";
import { getCurrentUserRole } from "@/lib/actions/admin";
import { UsagePill } from "@/components/chat/UsagePill";
import { ToolTimeline } from "@/components/chat/ToolTimeline";

interface ChatProps {
    projectId: string | null;
    chatId: string;
    initialMessages: any[];
    initialInput?: string;
    initialModel?: string;
    initialImages?: string[];
    // Optional — passed when this chat was created by an automation task.
    // Enables the per-phase rerun button beside each phase divider.
    automationTaskId?: string | null;
    // When the chat is backed by an automation task, the chat page passes
    // pre-computed phase boundaries (position/name/model_id + after_ms
    // cutoff timestamp). Used to assign each message to its phase by
    // created_at rather than relying on chat_messages.metadata.phase,
    // which Replit only tags at phase END. This makes the divider render
    // correctly DURING streaming, not just after a phase completes.
    phaseBoundaries?: Array<{
        position: number;
        name: string | null;
        model_id: string | null;
        after_ms: number;
    }>;
}

export function ChatInterface({ projectId, chatId, initialMessages, initialInput, initialModel, initialImages, automationTaskId, phaseBoundaries }: ChatProps) {
    // Process initial messages - group thinking/tool steps with final messages.
    // Extracted as a reusable transform so the polling fallback can rebuild the
    // FULL timeline from the DB (not just the latest row) when Realtime is down.
    const buildUiMessages = (rawMessages: any[]) => (rawMessages || []).reduce((acc: any[], msg: any) => {
        const type = msg.type || 'message';
        const meta = typeof msg.metadata === 'string'
            ? (() => { try { return JSON.parse(msg.metadata) || {}; } catch { return {}; } })()
            : (msg.metadata || {});

        // ── DEDUPLICATION ────────────────────────────────────────────────
        // The backend writes each tool_call / tool_result twice:
        //   1) Without "source" field (the numbered step record)
        //   2) With source = "tool_wrapper" (the canonical record with full metadata)
        // We keep only the tool_wrapper version for tools. For thinking messages
        // that have no source field we still keep them.
        if ((type === 'tool_call' || type === 'tool_result') && msg.role === 'assistant') {
            // If this is the numbered-step duplicate (has a "step" key but no "source"),
            // skip it — the tool_wrapper record will carry the same info plus more.
            if (meta.step !== undefined && meta.source !== 'tool_wrapper') {
                return acc;
            }
        }
        // ─────────────────────────────────────────────────────────────────

        if (msg.role === 'user') {
            // verifier_remediation is a server-written user-role row that should render
            // as a left-aligned "system follow-up" bubble. Pass the type through so the
            // JSX layer can branch on it; metadata is preserved by the spread.
            acc.push({ ...msg, images: meta.images || msg.images || [] });
        } else if (msg.role === 'assistant') {
            const lastMsg = acc[acc.length - 1];

            if (type === 'verifier_report') {
                // Standalone verdict bubble — never merge into the previous assistant message.
                acc.push({
                    ...msg,
                    metadata: meta,
                    thinkingSteps: [],
                    isProcessing: false,
                    content: msg.content || "",
                });
            } else if (type === 'thinking' || type === 'tool_call' || type === 'tool_result') {
                if (lastMsg && lastMsg.role === 'assistant') {
                    if (type === 'thinking') {
                        lastMsg.thinkingSteps = [...(lastMsg.thinkingSteps || []), {
                            type: 'thinking',
                            content: msg.content,
                            metadata: meta
                        }];
                    } else if (type === 'tool_call') {
                        // Args come from metadata.args, tool name from metadata.tool
                        const rawArgs = meta.args || msg.args || {};
                        let args = "";
                        try {
                            args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs, null, 2);
                        } catch { args = JSON.stringify(rawArgs); }

                        const toolName = meta.tool || meta.name || meta.tool_name || msg.tool || "Unknown Tool";
                        lastMsg.thinkingSteps = [...(lastMsg.thinkingSteps || []), {
                            type: 'tool_call',
                            tool: toolName,
                            args: args
                        }];
                    } else if (type === 'tool_result') {
                        lastMsg.thinkingSteps = [...(lastMsg.thinkingSteps || []), {
                            type: 'tool_result',
                            content: msg.content
                        }];
                    }
                } else {
                    // No assistant message yet — create a placeholder bubble
                    const newMsg: any = {
                        ...msg,
                        thinkingSteps: [],
                        isProcessing: true,
                        content: ""
                    };
                    if (type === 'thinking') {
                        newMsg.thinkingSteps = [{ type: 'thinking', content: msg.content, metadata: meta }];
                    }
                    acc.push(newMsg);
                }
            } else if (type === 'status' || type === 'cancelled') {
                if (type === 'cancelled' || msg.content === 'cancelled') {
                    if (lastMsg && lastMsg.role === 'assistant') {
                        lastMsg.content = (lastMsg.content || "") + "\n\n*[Task Cancelled]*";
                        lastMsg.isProcessing = false;
                    }
                    return acc;
                }
                // Phase markers from Replit (phase_start, pipeline_complete)
                // are intentionally dropped here — the client-side
                // phaseBoundaries logic (in the renderer) positions dividers
                // by content created_at, which is more accurate than the
                // marker timing AND avoids stacking duplicates.
                return acc;
            } else if (type === 'final' || type === 'message') {
                if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
                    lastMsg.content = msg.content || "";
                    lastMsg.id = msg.id;
                    lastMsg.created_at = msg.created_at;
                    lastMsg.isProcessing = false;
                    // Merge metadata (so phase-tagged final messages carry their
                    // phase info onto the placeholder bubble created earlier by
                    // a preceding thinking/tool step).
                    lastMsg.metadata = { ...(lastMsg.metadata || {}), ...meta };
                } else {
                    acc.push({
                        ...msg,
                        metadata: meta,
                        thinkingSteps: [],
                        isProcessing: false,
                        content: msg.content || ""
                    });
                }
            } else {
                // Unknown type — render as a plain content bubble rather than silently dropping it.
                // Prevents future server-side message types from disappearing without warning.
                console.warn(`[ChatInterface] Unknown assistant message type "${type}" — rendering as generic bubble`);
                acc.push({
                    ...msg,
                    metadata: meta,
                    thinkingSteps: [],
                    isProcessing: false,
                    content: msg.content || "",
                });
            }
        }
        return acc;
    }, []);

    const processedInitialMessages = buildUiMessages(initialMessages);

    // State definitions
    const [messages, setMessages] = useState<any[]>(processedInitialMessages);
    // Per-phase collapse state. Set holds the phase positions that are
    // currently collapsed (everything below the divider is hidden). Default:
    // all expanded.
    const [collapsedPhases, setCollapsedPhases] = useState<Set<number>>(new Set());
    // Per-phase rerun busy state — used to show a spinner on the row's
    // rerun button while the POST is in flight.
    const [rerunningPhase, setRerunningPhase] = useState<number | null>(null);

    const togglePhase = (position: number) => {
        setCollapsedPhases(prev => {
            const next = new Set(prev);
            if (next.has(position)) next.delete(position);
            else next.add(position);
            return next;
        });
    };

    // Triggers a rerun of the given phase + all phases after it via the
    // automation runner. Reuses the existing task's chat. Only available
    // when the chat was created by an automation task.
    const handleRerunFromPhase = async (position: number) => {
        if (!automationTaskId) return;
        if (rerunningPhase !== null) return;
        if (!confirm(`Re-run phase ${position} and every phase after it?`)) return;
        setRerunningPhase(position);
        try {
            const res = await fetch(
                `/api/automations/tasks/${automationTaskId}/phases/${position}/run`,
                { method: "POST" }
            );
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                alert(`Failed to start rerun: ${body.error || res.statusText}`);
            } else {
                // Reload the page so the chat refetches messages with the
                // newly-tagged phase rows. Simpler than threading rerun
                // streaming into ChatInterface.
                window.location.reload();
            }
        } finally {
            setRerunningPhase(null);
        }
    };
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [thinkingText, setThinkingText] = useState("");
    const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
    const [isRecording, setIsRecording] = useState(false);
    const [model, setModel] = useState(initialModel || "openai:gpt-5-mini");
    const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
    const [creatingNewChat, setCreatingNewChat] = useState(false);
    const [pendingImages, setPendingImages] = useState<string[]>(initialImages || []);
    const [pendingDocuments, setPendingDocuments] = useState<{ name: string, url: string, extractedContent: string }[]>([]);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [extractingMemory, setExtractingMemory] = useState(false);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [showUsage, setShowUsage] = useState(false);
    const userScrolledUp = useRef(false);
    const router = useRouter();
    // Refs
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<any>(null);
    const supabase = createClient();

    // Mirror `messages` into a ref so the polling fallback can read the latest
    // timeline without listing `messages` as an effect dependency — that
    // dependency tore down and recreated the 3s interval on every new row,
    // which produced the observed "stopping/starting polling" churn and
    // duplicate concurrent loops.
    const messagesRef = useRef<any[]>(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // True while handleSend is actively reading the SSE stream for THIS client.
    // The polling fallback must not rebuild from the DB during an active local
    // stream (single-call mode streams tokens straight into the bubble), or it
    // would fight those optimistic token-by-token updates.
    const isStreamingRef = useRef(false);
    // Handle creating a new chat in the same project
    const handleNewChat = async () => {
        if (!projectId || creatingNewChat) return;
        setCreatingNewChat(true);
        try {
            const result = await createNewChat(projectId);
            if (result.id) {
                router.push(`/projects/${projectId}/chat/${result.id}`);
            } else if (result.error) {
                console.error("Failed to create chat:", result.error);
            }
        } catch (e) {
            console.error("Error creating new chat:", e);
        } finally {
            setCreatingNewChat(false);
        }
    };

    const handleExtractMemory = async () => {
        if (!chatId || extractingMemory) return;
        setExtractingMemory(true);
        try {
            const result = await extractBehavioralInstructions(chatId);
            if (result.success) {
                alert(`Successfully extracted ${result.count} behavioral instructions from this chat.`);
            } else {
                alert(`Extraction failed: ${result.error}`);
            }
        } catch (e) {
            console.error("Error extracting memory:", e);
            alert("An error occurred during memory extraction.");
        } finally {
            setExtractingMemory(false);
        }
    };

    // Fetch permitted models
    useEffect(() => {
        const fetchModels = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                const [models, allowed, role] = await Promise.all([
                    getActiveModels(),
                    getUserAllowedModels(user.id),
                    getCurrentUserRole()
                ]);

                // Filter based on access
                const filtered = models.filter(m =>
                    m.is_available_to_all || allowed.includes(m.id)
                );

                setAvailableModels(filtered);
            } catch (error) {
                console.error("Error fetching models:", error);
            }
        };

        fetchModels();
    }, [supabase]);

    // Check if user has scrolled up
    const handleScroll = () => {
        if (!scrollRef.current) return;
        
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        // Make the threshold bigger to be more forgiving for dynamic content
        const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 150; 
        
        // Use synchronous ref to prevent race conditions with rapidly streaming messages
        userScrolledUp.current = !isAtBottom;
        
        // Show/hide floating button
        if (!isAtBottom && !showScrollButton) {
            setShowScrollButton(true);
        } else if (isAtBottom && showScrollButton) {
            setShowScrollButton(false);
        }
    };
    
    // Explicit scroll to bottom handler
    const scrollToBottomAndResume = () => {
        if (scrollRef.current) {
            userScrolledUp.current = false;
            setShowScrollButton(false);
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    };

    // Scroll to bottom on messages change
    useEffect(() => {
        if (scrollRef.current && !userScrolledUp.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, loading]);

    // Sync initial images and model if they are provided later (e.g. from StandaloneChatClient)
    useEffect(() => {
        if (initialImages && initialImages.length > 0 && pendingImages.length === 0) {
            setPendingImages(initialImages);
        }
    }, [initialImages]);

    useEffect(() => {
        if (initialModel && model !== initialModel) {
            setModel(initialModel);
        }
    }, [initialModel]);

    // Check if there's a pending message on initial load yes
    useEffect(() => {
        // Find the last user message
        let lastUserIndex = -1;
        for (let i = initialMessages.length - 1; i >= 0; i--) {
            if (initialMessages[i].role === 'user') {
                lastUserIndex = i;
                break;
            }
        }

        if (lastUserIndex === -1) return; // No user messages

        // Check if there's a final response OR CANCELLATION after this user message
        const hasFinalResponse = initialMessages
            .slice(lastUserIndex + 1)
            .some(m => {
                if (m.role === 'assistant') {
                    if (m.type === 'final' || m.type === 'message') return true;
                    // Check for cancellation
                    if ((m.type === 'status' && m.content === 'cancelled') || m.type === 'cancelled' || m.content === 'cancelled') return true;
                }
                return false;
            });

        // If no final response and not cancelled, agent is still thinking
        if (!hasFinalResponse) {
            setLoading(true);
            setThinkingText("Thinking...");
        }
    }, []); // Only run on mount

    // Auto-send initial input if provided (e.g. from project page textarea)
    const initialInputSentRef = useRef(false);
    useEffect(() => {
        if (initialInput && !initialInputSentRef.current && initialMessages.length === 0) {
            initialInputSentRef.current = true;
            // Sync states for UI consistency
            if (initialModel) setModel(initialModel);
            if (initialImages && initialImages.length > 0) setPendingImages(initialImages);

            // Send with explicit overrides because state updates are async
            handleSend(initialInput, initialImages, initialModel);
        }
    }, [initialInput, initialImages, initialModel, initialMessages.length]);

    // Realtime Subscription
    useEffect(() => {
        if (!chatId) {
            console.warn("[Realtime] No chatId provided, skipping subscription.");
            return;
        }
        console.log(`[Realtime] Setting up subscription for chat:${chatId}`);

        const channel = supabase
            .channel(`chat:${chatId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `chat_id=eq.${chatId}`
                },
                (payload: any) => {
                    const newMsg = payload.new;
                    if (!newMsg) return;

                    setMessages(prev => {
                        const newMessages = [...prev];
                        const lastMsgIndex = newMessages.length - 1;
                        const lastMsg = newMessages[lastMsgIndex];

                        // 1. Handle user-role rows.
                        //    - Real user messages (type='message' or unset) are already added
                        //      optimistically by handleSend, so skip them.
                        //    - verifier_remediation is server-written with role='user' and must
                        //      be appended. After it, push a fresh assistant placeholder so the
                        //      remediation re-run's thinking/tool_call/tool_result rows attach
                        //      to a NEW bubble instead of mutating the verifier_report above.
                        if (newMsg.role === 'user') {
                            const userType = newMsg.type || 'message';

                            if (userType === 'message') {
                                console.log('[Realtime] Ignoring user message from DB (already added optimistically)');
                                return prev;
                            }

                            if (userType === 'verifier_remediation') {
                                if (prev.some(m => m.id === newMsg.id)) return prev; // idempotent
                                console.log('[Realtime] Appending verifier_remediation + assistant placeholder');
                                return [
                                    ...prev,
                                    { ...newMsg, images: [] },
                                    {
                                        id: `placeholder-${newMsg.id}`,
                                        role: 'assistant',
                                        content: '',
                                        thinkingSteps: [],
                                        isProcessing: true,
                                    },
                                ];
                            }

                            // Unknown user-role type — append rather than silently drop.
                            console.warn(`[Realtime] Unknown user-role type "${userType}" — appending generically`);
                            if (prev.some(m => m.id === newMsg.id)) return prev;
                            return [...prev, { ...newMsg, images: [] }];
                        }

                        // 2. Handle Assistant Messages - Update UI when DB is updated
                        if (newMsg.role === 'assistant') {
                            console.log("[Realtime] Received assistant message from DB:", { id: newMsg.id, contentLen: newMsg.content?.length, type: newMsg.type });

                            const messageType = newMsg.type || 'message';

                            // Finds the last assistant message to update
                            const findLastAssistantIndex = (msgs: any[]) => {
                                for (let i = msgs.length - 1; i >= 0; i--) {
                                    if (msgs[i].role === 'assistant') return i;
                                }
                                return -1;
                            };

                            // Handle intermediate types by updating the last assistant message
                            if (messageType === 'thinking' || messageType === 'tool_call' || messageType === 'tool_result') {
                                // Deduplicate: skip the numbered-step record (has 'step', no 'source')
                                // The canonical tool_wrapper record arrives right after with full metadata.
                                const rtMeta = typeof newMsg.metadata === 'string'
                                    ? (() => { try { return JSON.parse(newMsg.metadata) || {}; } catch { return {}; } })()
                                    : (newMsg.metadata || {});
                                if ((messageType === 'tool_call' || messageType === 'tool_result')
                                    && rtMeta.step !== undefined
                                    && rtMeta.source !== 'tool_wrapper') {
                                    return prev; // skip — tool_wrapper version is coming
                                }

                                return prev.map((msg, index, array) => {
                                    if (index !== findLastAssistantIndex(array)) return msg;

                                    let newStep: any = null;
                                    if (messageType === 'thinking') {
                                        newStep = { type: 'thinking', content: newMsg.content, metadata: rtMeta };
                                    } else if (messageType === 'tool_call') {
                                        const rawArgs = rtMeta.args || newMsg.args || {};
                                        let args = "";
                                        try {
                                            args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs, null, 2);
                                        } catch { args = JSON.stringify(rawArgs); }
                                        const toolName = rtMeta.tool || rtMeta.name || rtMeta.tool_name || newMsg.tool || "Unknown Tool";
                                        newStep = { type: 'tool_call', tool: toolName, args: args };
                                    } else if (messageType === 'tool_result') {
                                        newStep = { type: 'tool_result', content: newMsg.content };
                                    }

                                    return {
                                        ...msg,
                                        thinkingSteps: [...(msg.thinkingSteps || []), newStep],
                                        isProcessing: true,
                                    };
                                });
                            } else if (messageType === 'status') {
                                if (newMsg.content === 'cancelled') {
                                    setLoading(false);
                                    setThinkingText("");
                                    return prev.map((msg, index, array) => {
                                        if (index !== findLastAssistantIndex(array)) return msg;
                                        return {
                                            ...msg,
                                            content: (msg.content || "") + "\n\n*[Task Cancelled]*",
                                            isProcessing: false
                                        };
                                    });
                                }
                                // Replit phase markers are dropped — the
                                // client-side phaseBoundaries logic handles
                                // divider positioning more accurately by
                                // content timing. We still listen for
                                // pipeline_complete to stop the spinner.
                                const rtStatusMeta = typeof newMsg.metadata === 'string'
                                    ? (() => { try { return JSON.parse(newMsg.metadata) || {}; } catch { return {}; } })()
                                    : (newMsg.metadata || {});
                                if (rtStatusMeta?.kind === 'pipeline_complete') {
                                    setLoading(false);
                                    setThinkingText("");
                                    return prev;
                                }
                                // Suppress generic phase_start markers — no UI side-effect needed.
                                if (rtStatusMeta?.kind === 'phase_start') {
                                    return prev;
                                }
                                // Legacy generic status — just update the thinking text.
                                setThinkingText(newMsg.content || "Processing...");
                                return prev;
                            } else if (messageType === 'cancelled') {
                                setLoading(false);
                                setThinkingText("");
                                return prev.map((msg, index, array) => {
                                    if (index !== findLastAssistantIndex(array)) return msg;
                                    return {
                                        ...msg,
                                        content: (msg.content || "") + "\n\n*[Task Cancelled]*",
                                        isProcessing: false
                                    };
                                });
                            } else if (messageType === 'verifier_report') {
                                // Verdict bubble — never overwrite the previous assistant message.
                                if (prev.some(m => m.id === newMsg.id)) return prev; // idempotent
                                const rtMeta = typeof newMsg.metadata === 'string'
                                    ? (() => { try { return JSON.parse(newMsg.metadata) || {}; } catch { return {}; } })()
                                    : (newMsg.metadata || {});
                                console.log('[Realtime] Appending verifier_report bubble', { passed: rtMeta.passed });
                                return [...prev, {
                                    ...newMsg,
                                    metadata: rtMeta,
                                    thinkingSteps: [],
                                    isProcessing: false,
                                }];
                            } else if (messageType !== 'final' && messageType !== 'message') {
                                // Unknown assistant type — append as a new bubble instead of
                                // falling into the findLastAssistantIndex → overwrite block below
                                // (which is the trap that originally broke verifier_report).
                                console.warn(`[Realtime] Unknown assistant type "${messageType}" — appending generically`);
                                if (prev.some(m => m.id === newMsg.id)) return prev;
                                return [...prev, {
                                    ...newMsg,
                                    thinkingSteps: [],
                                    isProcessing: false,
                                }];
                            }

                            // Check if existing message matches ID
                            const existingIndex = prev.findIndex(m => m.id === newMsg.id);

                            if (existingIndex !== -1) {
                                console.log("[Realtime] Found existing message by ID at index", existingIndex);
                                // Update existing message content from DB authoritative source
                                const existing = newMessages[existingIndex];
                                if (existing.content !== newMsg.content || existing.created_at !== newMsg.created_at) {
                                    newMessages[existingIndex] = {
                                        ...existing,
                                        content: newMsg.content || existing.content,
                                        created_at: newMsg.created_at,
                                        isProcessing: false
                                    };
                                    console.log("[Realtime] Updated existing message");

                                    // Stop loading indicator when final response arrives
                                    if (messageType === 'final') {
                                        setLoading(false);
                                        setThinkingText("");
                                    }

                                    return newMessages;
                                }
                                return prev;
                            }

                            // NO ID MATCH - likely the placeholder needs to be updated with the real message
                            const lastAssistantIndex = findLastAssistantIndex(prev);

                            if (lastAssistantIndex !== -1) {
                                const targetMsg = newMessages[lastAssistantIndex];
                                // Only update if the target is processing or has no ID mismatch (though logic here is tricky)
                                // We assume the last assistant message IS the one we want to replace with the Realtime Update

                                console.log("[Realtime] Found last assistant message at index", lastAssistantIndex, "- Updating with DB content");
                                newMessages[lastAssistantIndex] = {
                                    ...targetMsg,
                                    id: newMsg.id,
                                    content: newMsg.content || targetMsg.content, // Keep existing content if new is empty (unlikely for final)
                                    created_at: newMsg.created_at,
                                    isProcessing: messageType !== 'final', // Only stop processing if it's final
                                    thinkingSteps: targetMsg.thinkingSteps // Preserve thinking steps we built up
                                };
                                console.log("[Realtime] Successfully reconciled!");

                                // Stop loading indicator when final response arrives
                                if (messageType === 'final') {
                                    setLoading(false);
                                    setThinkingText("");
                                }

                                return newMessages;
                            }

                            // If somehow there's no assistant message at all, append it
                            console.log("[Realtime] No assistant message found, appending new one");
                            return [...prev, {
                                ...newMsg,
                                thinkingSteps: [],
                                isProcessing: false
                            }];
                        }

                        return prev;
                    });
                }
            )
            .subscribe((status) => {
                console.log(`[Realtime] Subscription status for chat:${chatId}:`, status);
                if (status === 'SUBSCRIBED') {
                    setRealtimeStatus('connected');
                    console.log('[Realtime] Successfully connected');
                } else if (status === 'CHANNEL_ERROR') {
                    setRealtimeStatus('error');
                    console.error('[Realtime] Channel error - connection failed');
                } else if (status === 'TIMED_OUT') {
                    setRealtimeStatus('error');
                    console.warn('[Realtime] Connection timed out - this may be a WebSocket connectivity issue');
                    console.warn('[Realtime] Check: 1) Network connection 2) Firewall settings 3) Supabase project status');
                } else if (status === 'CLOSED') {
                    setRealtimeStatus('disconnected');
                    console.log('[Realtime] Connection closed');
                }
            });

        return () => {
            console.log(`[Realtime] Cleaning up subscription for chat:${chatId}`);
            supabase.removeChannel(channel);
        };
    }, [chatId, supabase]);

    // Polling fallback when Realtime fails.
    //
    // Realtime can't always connect (corporate firewalls/proxies block the
    // WebSocket, or the channel times out). When it isn't connected, rebuild
    // the ENTIRE timeline from the DB on an interval using the same transform
    // as the initial server render, so phase/tool/thinking steps appear live
    // instead of the chat being stuck on "processing". The previous version
    // fetched only the single latest assistant row into one bubble — it never
    // reconstructed the timeline and silently dropped empty-content marker
    // rows (e.g. phase_start), so multi-message phase runs rendered nothing.
    useEffect(() => {
        if (!chatId) return;
        if (realtimeStatus === 'connected') return; // Realtime owns updates when live

        console.log('[Polling] Realtime not connected, starting polling fallback');
        let stopped = false;

        const poll = async () => {
            // Don't fight an active local SSE stream — let handleSend own the
            // UI until its stream finishes, then polling can take over.
            if (isStreamingRef.current) return;
            // Only poll while a turn is in flight: an assistant bubble is still
            // processing, or the last row is a user message awaiting a reply.
            const cur = messagesRef.current;
            const inflight = cur.some(m => m.role === 'assistant' && m.isProcessing);
            const lastMsg = cur[cur.length - 1];
            const awaitingReply = !!lastMsg && lastMsg.role === 'user';
            if (!inflight && !awaitingReply) return;

            const { data, error } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: true })
                .order('sequence', { ascending: true });

            if (stopped) return;
            if (error) {
                console.error('[Polling] Error fetching messages:', error);
                return;
            }
            if (!data || data.length === 0) return;

            const rebuilt = buildUiMessages(data);
            if (rebuilt.length === 0) return;

            setMessages(prev => {
                // Preserve a just-sent optimistic user message the DB fetch may
                // not have caught yet, so it doesn't flicker out of the UI.
                const lastPrev = prev[prev.length - 1];
                if (
                    lastPrev &&
                    lastPrev.role === 'user' &&
                    !rebuilt.some(m => m.role === 'user' && m.content === lastPrev.content)
                ) {
                    return [...rebuilt, lastPrev];
                }
                return rebuilt;
            });

            // Clear the global "Thinking..." spinner once the turn resolved.
            const stillInflight = rebuilt.some(m => m.role === 'assistant' && m.isProcessing);
            if (!stillInflight) {
                setLoading(false);
                setThinkingText('');
            }
        };

        // Run immediately so the user doesn't wait a full interval for paint.
        poll();
        const interval = setInterval(poll, 3000);

        return () => {
            stopped = true;
            console.log('[Polling] Stopping polling fallback');
            clearInterval(interval);
        };
    }, [chatId, realtimeStatus, supabase]);

    const handleSend = async (
        messageContent: string = input,
        overrideImages?: string[],
        overrideModel?: string
    ) => {
        if (!messageContent.trim() && (overrideImages?.length || pendingImages.length) === 0 && pendingDocuments.length === 0) return;

        const imagesToSend = overrideImages || [...pendingImages];
        setPendingImages([]);
        setShowUsage(false);

        let finalMessageContent = messageContent;
        if (pendingDocuments.length > 0) {
            const docMessages = pendingDocuments.map(doc =>
                `[File Uploaded: ${doc.name}](${doc.url})${doc.extractedContent ? "\n\n*File content has been indexed and added to chat context.*" : ""}`
            ).join('\n\n');
            finalMessageContent = docMessages + (finalMessageContent ? '\n\n' + finalMessageContent : '');
            setPendingDocuments([]);
        }

        const tempId = uuid();
        // Add created_at timestamp and images
        const userMsg = { role: "user", content: finalMessageContent, id: tempId, created_at: new Date().toISOString(), images: imagesToSend };
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setLoading(true);
        setThinkingText("Thinking...");
        userScrolledUp.current = false; // Force scroll to bottom when user sends a message
        setShowScrollButton(false);

        // Placeholder for assistant message
        const assistantMsgId = uuid();
        setMessages(prev => [...prev, {
            role: "assistant",
            content: "",
            id: assistantMsgId,
            thinkingSteps: [],
            isProcessing: true,
            created_at: new Date().toISOString()
        }]);

        isStreamingRef.current = true;
        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectId,
                    chatId,
                    content: finalMessageContent,
                    images: imagesToSend.length > 0 ? imagesToSend : undefined,
                    previousMessages: messages.map(m => ({
                        role: m.role,
                        content: m.content,
                        images: m.images
                    })),
                    model: overrideModel || model
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                // Handle spending cap error specifically
                if (response.status === 429) {
                    try {
                        const errJson = JSON.parse(errText);
                        throw new Error(errJson.error || "Daily spending limit reached.");
                    } catch (parseErr) {
                        if (parseErr instanceof SyntaxError) {
                            throw new Error(errText || "Daily spending limit reached.");
                        }
                        throw parseErr;
                    }
                }
                throw new Error(errText);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                console.log("[ChatInterface] Reading stream...");
                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;

                    const lines = buffer.split("\n\n");
                    buffer = lines.pop() || ""; // Keep the last incomplete line

                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                const jsonStr = line.slice(6);
                                if (jsonStr.trim() === "[DONE]") continue;
                                const data = JSON.parse(jsonStr);

                                // Phase boundary events: only emitted when the
                                // project has an enabled phase pipeline. They
                                // split the response into per-phase assistant
                                // bubbles so the user sees each stage labeled
                                // (model + phase name) instead of one merged blob.
                                if (data.type === 'phase_start') {
                                    setMessages(prev => {
                                        const next = [...prev];
                                        const lastIdx = next.length - 1;
                                        const last = next[lastIdx];
                                        const phaseMeta = data.phase || {};
                                        // Reuse the existing empty placeholder bubble for
                                        // phase 1; otherwise push a new bubble.
                                        if (last && last.role === 'assistant' && !last.content && !last.metadata?.phase) {
                                            next[lastIdx] = {
                                                ...last,
                                                metadata: { ...(last.metadata || {}), phase: phaseMeta },
                                                isProcessing: true,
                                            };
                                        } else {
                                            next.push({
                                                role: 'assistant',
                                                content: '',
                                                id: uuid(),
                                                thinkingSteps: [],
                                                isProcessing: true,
                                                metadata: { phase: phaseMeta },
                                                created_at: new Date().toISOString(),
                                            });
                                        }
                                        return next;
                                    });
                                    // Phase labels are no longer surfaced in the UI; show a
                                    // generic working indicator instead of "Phase X/Y…".
                                    setThinkingText("Working…");
                                    continue;
                                }
                                if (data.type === 'phase_end') {
                                    setMessages(prev => {
                                        const next = [...prev];
                                        const lastIdx = next.length - 1;
                                        const last = next[lastIdx];
                                        if (last && last.role === 'assistant') {
                                            next[lastIdx] = { ...last, isProcessing: false };
                                        }
                                        return next;
                                    });
                                    continue;
                                }

                                // Handle different event types from the stream
                                setMessages(prev => {
                                    const newMessages = [...prev];
                                    const lastMsgIndex = newMessages.length - 1;
                                    const lastMsg = newMessages[lastMsgIndex];

                                    // Ensure we are updating the assistant message
                                    if (!lastMsg || lastMsg.role !== 'assistant') return prev;

                                    // Update timestamp to now as we receive chunks
                                    newMessages[lastMsgIndex].created_at = new Date().toISOString();

                                    if (data.type === 'token' || data.type === 'content') {
                                        const text = data.content || data.token || "";
                                        // If content is just appended
                                        newMessages[lastMsgIndex] = {
                                            ...newMessages[lastMsgIndex],
                                            content: (lastMsg.content || "") + text
                                        };
                                    } else if (data.type === 'tool_call') {
                                        const metaRaw = data.metadata || {};
                                        const meta = typeof metaRaw === 'string' ? (JSON.parse(metaRaw) || {}) : metaRaw;
                                        let args = "";
                                        const rawArgs = data.args || meta.args || {};
                                        try {
                                            args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs, null, 2);
                                        } catch (e) { args = JSON.stringify(rawArgs); }

                                        const toolName = data.tool || meta.tool || meta.name || meta.tool_name || "Unknown Tool";
                                        const toolStep = { type: 'tool_call', tool: toolName, args: args };

                                        newMessages[lastMsgIndex] = {
                                            ...newMessages[lastMsgIndex],
                                            thinkingSteps: [...(lastMsg.thinkingSteps || []), toolStep],
                                            isProcessing: true
                                        };
                                    } else if (data.type === 'tool_result') {
                                        const resultText = data.content;
                                        const resultStep = { type: 'tool_result', content: resultText };

                                        newMessages[lastMsgIndex] = {
                                            ...newMessages[lastMsgIndex],
                                            thinkingSteps: [...(lastMsg.thinkingSteps || []), resultStep]
                                        };
                                    } else if (data.type === 'thinking') {
                                        const metaRaw = data.metadata || {};
                                        const meta = typeof metaRaw === 'string' ? (JSON.parse(metaRaw) || {}) : metaRaw;
                                        const thinkStep = { type: 'thinking', content: data.content, metadata: meta };
                                        newMessages[lastMsgIndex] = {
                                            ...newMessages[lastMsgIndex],
                                            thinkingSteps: [...(lastMsg.thinkingSteps || []), thinkStep]
                                        };
                                    } else if (data.type === 'status') {
                                        setThinkingText(data.content || "Processing...");
                                        // Update status if needed
                                    } else if (data.type === 'final' || data.type === 'complete') {
                                        newMessages[lastMsgIndex].isProcessing = false;
                                        if (data.content && data.content.length > (lastMsg.content || "").length) {
                                            newMessages[lastMsgIndex].content = data.content;
                                        }
                                        setShowUsage(true);
                                    } else if (data.type === 'error') {
                                        newMessages[lastMsgIndex].content += `\n\nError: ${data.content}`;
                                        newMessages[lastMsgIndex].isProcessing = false;
                                        setShowUsage(true);
                                    } else if (data.type === 'cancelled') {
                                        setLoading(false);
                                        setThinkingText("");
                                        newMessages[lastMsgIndex].content = (newMessages[lastMsgIndex].content || "") + "\n\n*[Task Cancelled]*";
                                        newMessages[lastMsgIndex].isProcessing = false;
                                    }

                                    return newMessages;
                                });

                            } catch (e) {
                                console.error("Error parsing stream JSON", e, line);
                            }
                        }
                    }
                }
                console.log("[ChatInterface] Stream finished.");

                // Track spend after stream completes (server computes delta)
                fetch("/api/usage/track-spend", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: chatId }),
                }).catch(trackErr => {
                    console.error("[ChatInterface] Spend tracking error:", trackErr);
                });
            }
            setLoading(false);

        } catch (e: any) {
            console.error("Chat Error:", e);
            setMessages(prev => {
                // If we have a pending message, mark it as waiting for the background process instead of showing a hard error
                // This allows the Realtime subscription to eventually pick up the result
                const last = prev[prev.length - 1];
                if (last && last.role === 'assistant' && last.isProcessing) {
                    const newPrev = [...prev];
                    newPrev[newPrev.length - 1] = {
                        ...last,
                        content: (last.content || "") + `\n\n*[System Warning]: Connection timed out, but the agent is still working in the background. The response will appear here automatically when complete.*`,
                        // Keep isProcessing true so the pending finder in Realtime can locate it
                    };
                    return newPrev;
                }
                // Only if no message was processing do we append a new error
                return [...prev, { role: "assistant", content: `Error: ${e.message || "Failed to start chat."}` }];
            });
            // We do NOT set loading to false if we believe the background agent is working, 
            // but the timeout forces us to stop the local spinner logic.
            // Actually, keep loading true might be confusing if the stream is dead.
            // Let's set loading false, but the "isProcessing" flag on the message determines the specific UI processing state.
            setLoading(false);
        } finally {
            // Always clear the streaming flag so the polling fallback can resume.
            isStreamingRef.current = false;
        }
    };

    const handleStop = async () => {
        if (!chatId) return;

        console.log("Stopping chat:", chatId);
        // Optimistic UI update - show we are stopping
        setThinkingText("Stopping...");

        try {
            const res = await fetch('/api/chat/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId })
            });

            if (res.ok) {
                // Determine success - force UI stop
                setLoading(false);
                setThinkingText("");

                // Manually mark last assistant message as cancelled in UI if needed
                setMessages(prev => {
                    let lastIdx = -1;
                    for (let i = prev.length - 1; i >= 0; i--) {
                        if (prev[i].role === 'assistant') {
                            lastIdx = i;
                            break;
                        }
                    }
                    if (lastIdx === -1) return prev;

                    const msg = prev[lastIdx];
                    // Only update if not already marked
                    if (msg.content?.includes("[Task Cancelled]")) return prev;

                    const newMessages = [...prev];
                    newMessages[lastIdx] = {
                        ...msg,
                        content: (msg.content || "") + "\n\n*[Task Cancelled]*",
                        isProcessing: false
                    };
                    return newMessages;
                });
            }
        } catch (e) {
            console.error("Error stopping chat:", e);
            setThinkingText("Failed to stop");
        }
    };

    const processImageFiles = async (files: File[]) => {
        if (files.length === 0) return;
        setUploadingImage(true);
        try {
            const urls = await Promise.all(files.map(async (file) => {
                const filePath = `chat/${chatId}/img_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
                const { error: uploadError } = await supabase.storage
                    .from("project-files")
                    .upload(filePath, file);

                if (uploadError) throw uploadError;

                const { data, error: signedUrlError } = await supabase.storage
                    .from("project-files")
                    .createSignedUrl(filePath, 60 * 60 * 24 * 365); // 1 year expiry

                if (signedUrlError) throw signedUrlError;

                return data?.signedUrl || '';
            }));

            setPendingImages(prev => [...prev, ...urls.filter(Boolean)]);
        } catch (error: any) {
            console.error("Image upload failed", error);
            alert("Image upload failed: " + error.message);
        } finally {
            setUploadingImage(false);
            if (imageInputRef.current) imageInputRef.current.value = "";
        }
    };

    const processDocuments = async (files: File[]) => {
        if (files.length === 0) return;
        setUploading(true);
        try {
            const newDocs: { name: string, url: string, extractedContent: string }[] = [];
            for (const file of files) {
                const filePath = `chat/${chatId}/${Date.now()}_${file.name}`;

                // 1. Upload to Storage
                const { error: uploadError } = await supabase.storage
                    .from("project-files")
                    .upload(filePath, file);

                if (uploadError) throw uploadError;

                // 2. Extract content (client-side)
                let extractedContent = "";
                try {
                    extractedContent = await extractFileContent(file);
                } catch (extractError) {
                    console.warn("Content extraction failed for chat upload:", extractError);
                }

                // 3. If in a project, save to documents table so it's injected into system prompt
                if (projectId) {
                    await addDocument(projectId, file.name, filePath, extractedContent || undefined);
                }

                const { data: { publicUrl } } = supabase.storage
                    .from("project-files")
                    .getPublicUrl(filePath);

                newDocs.push({
                    name: file.name,
                    url: publicUrl,
                    extractedContent: extractedContent
                });
            }
            setPendingDocuments(prev => [...prev, ...newDocs]);
        } catch (error: any) {
            console.error("Upload failed", error);
            alert("Upload failed: " + error.message);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        await processDocuments(Array.from(e.target.files));
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        await processImageFiles(Array.from(e.target.files));
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        const imageFiles: File[] = [];
        const docFiles: File[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf("image") !== -1) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
            } else if (item.kind === "file") {
                const file = item.getAsFile();
                if (file) docFiles.push(file);
            }
        }

        if (imageFiles.length > 0) {
            await processImageFiles(imageFiles);
        }
        if (docFiles.length > 0) {
            await processDocuments(docFiles);
        }
    };


    // Initialize speech recognition
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                console.log('Speech recognition available');
                recognitionRef.current = new SpeechRecognition();
                recognitionRef.current.continuous = true;
                recognitionRef.current.interimResults = true;
                recognitionRef.current.lang = 'en-US';

                recognitionRef.current.onstart = () => {
                    console.log('Speech recognition started');
                };

                recognitionRef.current.onresult = (event: any) => {
                    let finalTranscript = '';
                    let interimTranscript = '';

                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        const transcript = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            finalTranscript += transcript + ' ';
                        } else {
                            interimTranscript += transcript;
                        }
                    }

                    if (finalTranscript) {
                        console.log('Final transcript:', finalTranscript);
                        setInput(prev => prev + (prev ? ' ' : '') + finalTranscript.trim());
                    }
                };

                recognitionRef.current.onerror = (event: any) => {
                    console.error('Speech recognition error:', event.error);
                    setIsRecording(false);
                };

                recognitionRef.current.onend = () => {
                    console.log('Speech recognition ended');
                    setIsRecording(false);
                };
            }
        }
    }, []);

    const toggleVoiceInput = () => {
        if (!recognitionRef.current) {
            alert('Speech recognition is not supported in your browser.');
            return;
        }

        if (isRecording) {
            recognitionRef.current.stop();
            setIsRecording(false);
        } else {
            try {
                recognitionRef.current.start();
                setIsRecording(true);
            } catch (error) {
                console.error('Failed to start recognition:', error);
                alert('Failed to start voice input.');
            }
        }
    };

    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    const handleCopy = (text: string, index: number) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    return (
        <div className="flex flex-col h-full bg-background relative w-full max-w-screen overflow-x-hidden">

            {/* New Chat Header Button — only show inside project chats */}
            {projectId && (
                <div className="flex items-center justify-end px-3 md:px-5 pt-3 pb-1">
                    <button
                        onClick={handleNewChat}
                        disabled={creatingNewChat}
                        className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                            bg-primary/10 text-primary border border-primary/20
                            hover:bg-primary hover:text-primary-foreground hover:border-primary
                            hover:shadow-[0_0_16px_rgba(var(--primary-rgb,99,102,241),0.25)]
                            disabled:opacity-50 disabled:cursor-not-allowed
                            transition-all duration-200 ease-out"
                        title="Start a new chat in this project"
                    >
                        {creatingNewChat ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Plus className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-90" />
                        )}
                        <span>{creatingNewChat ? "Creating..." : "New Chat"}</span>
                    </button>

                    <button
                        onClick={handleExtractMemory}
                        disabled={extractingMemory || loading}
                        className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ml-2
                            bg-purple-500/10 text-purple-600 border border-purple-500/20
                            hover:bg-purple-500 hover:text-white hover:border-purple-500
                            hover:shadow-[0_0_16px_rgba(168,85,247,0.25)]
                            disabled:opacity-50 disabled:cursor-not-allowed
                            transition-all duration-200 ease-out"
                        title="Extract and learn from this chat's behavior"
                    >
                        {extractingMemory ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Brain className="h-3.5 w-3.5 transition-transform duration-300 group-hover:scale-110" />
                        )}
                        <span>{extractingMemory ? "Extracting..." : "Extract Memory"}</span>
                    </button>
                </div>
            )}

            <div 
                className="flex-1 overflow-y-auto overflow-x-hidden p-2 md:p-4 space-y-6 w-full max-w-screen" 
                ref={scrollRef}
                onScroll={handleScroll}
            >
                {messages.length === 0 && (
                    <div className="flex h-full items-center justify-center text-muted-foreground opacity-50 px-4 text-center flex-col gap-2">
                        <div className="p-4 rounded-full bg-muted/50">
                            <Bot className="h-8 w-8" />
                        </div>
                        <p>How can I help you today?</p>
                    </div>
                )}
                {(() => {
                    // Extract filtered list once so we can pre-compute the
                    // index of the LAST message containing a todos step.
                    // We render the todos card only in that message — every
                    // earlier todos card is hidden, leaving a single "live"
                    // card that always shows the most recent counts.
                    const filteredRaw = messages.filter(msg => {
                        if (msg.role === 'assistant' && msg.isProcessing && !msg.content?.trim() && (!msg.thinkingSteps || msg.thinkingSteps.length === 0)) {
                            return false;
                        }
                        // Todos feature removed: drop legacy assistant rows whose ONLY
                        // content is todo output, so they don't leave an empty bubble
                        // (with a dangling action toolbar) where the card used to be.
                        // Messages that mix a todo step with real text/tool output are
                        // kept — the todo steps are hidden individually at render time.
                        if (msg.role === 'assistant' && !msg.isProcessing) {
                            const steps = msg.thinkingSteps || [];
                            const stepContents = steps.map((s: any) =>
                                typeof s === 'string' ? s : (s?.type === 'tool_group' ? null : s?.content)
                            );
                            const hasTodo =
                                (typeof msg.content === 'string' && isTodoMessage(msg.content)) ||
                                stepContents.some((c: any) => typeof c === 'string' && isTodoMessage(c));
                            const contentIsTodoOrEmpty = !msg.content?.trim() || isTodoMessage(msg.content);
                            const stepsAllTodos = steps.every((s: any, i: number) =>
                                s?.type !== 'tool_group' &&
                                typeof stepContents[i] === 'string' &&
                                isTodoMessage(stepContents[i])
                            );
                            if (hasTodo && contentIsTodoOrEmpty && stepsAllTodos) {
                                return false;
                            }
                        }
                        return true;
                    });

                    // If phaseBoundaries are provided (automation chat),
                    // assign each assistant message to its phase by created_at
                    // — bypasses the need for Replit to tag chat_messages.metadata
                    // for the divider to render. Mirrors how the automation
                    // table groups phases by completed_at timestamps.
                    const totalPhases = phaseBoundaries?.length ?? 0;
                    const filteredMessages = (!phaseBoundaries || phaseBoundaries.length === 0)
                        ? filteredRaw
                        : filteredRaw.map(msg => {
                            if (msg.role !== 'assistant') return msg;
                            // If Replit already tagged this row, respect it.
                            if (msg.metadata?.phase?.position) return msg;
                            const t = new Date(msg.created_at || 0).getTime();
                            // Find the highest-position phase whose after_ms <= t.
                            let assigned: typeof phaseBoundaries[number] | null = null;
                            for (const b of phaseBoundaries) {
                                if (t >= b.after_ms) assigned = b;
                            }
                            if (!assigned) return msg;
                            return {
                                ...msg,
                                metadata: {
                                    ...(msg.metadata || {}),
                                    phase: {
                                        index: assigned.position,
                                        total: totalPhases,
                                        position: assigned.position,
                                        name: assigned.name,
                                        model_id: assigned.model_id,
                                    },
                                },
                            };
                        });
                    return filteredMessages.map((msg, i) => {
                        const msgType = msg.type || 'message';

                        // verifier_report: standalone verdict bubble (passed = green, failed = amber)
                        if (msgType === 'verifier_report') {
                            const vmeta = (typeof msg.metadata === 'string'
                                ? (() => { try { return JSON.parse(msg.metadata) || {}; } catch { return {}; } })()
                                : (msg.metadata || {})) as any;
                            const passed = vmeta.passed === true;
                            const missed: string[] = Array.isArray(vmeta.missed_ids) ? vmeta.missed_ids : [];
                            const pillBase = "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border";
                            const pillCls = passed
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30";
                            const headline = passed
                                ? `✅ Verifier passed${typeof vmeta.total_tool_calls === 'number' ? ` · ${vmeta.total_tool_calls} tool calls` : ''}`
                                : (msg.content || vmeta.summary || '⚠️ Verifier flagged issues');
                            return (
                                <div key={i} className="flex gap-4 mx-auto w-full max-w-3xl justify-start">
                                    <div className="h-8 w-8 rounded-full bg-background border flex items-center justify-center text-primary flex-shrink-0 mt-1 shadow-sm">
                                        <Bot className="h-5 w-5" />
                                    </div>
                                    <div className="flex flex-col gap-2 max-w-[85%] md:max-w-[80%] min-w-0 items-start">
                                        <span className={`${pillBase} ${pillCls}`}>{headline}</span>
                                        {!passed && missed.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {missed.map((mid, idx) => (
                                                    <span key={idx} className="inline-block rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground border border-border/60">
                                                        {mid}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {!passed && vmeta.detail && (
                                            <details className="w-full mt-1 rounded-md border border-border/60 bg-muted/30">
                                                <summary className="cursor-pointer select-none px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                                                    View verifier details
                                                </summary>
                                                <div className="px-3 pb-2 pt-1">
                                                    <MarkdownContent content={String(vmeta.detail)} compact />
                                                </div>
                                            </details>
                                        )}
                                    </div>
                                </div>
                            );
                        }

                        // verifier_remediation: server-written user-role row; render as
                        // left-aligned "system follow-up" bubble (visually distinct from a
                        // user-typed message even though role='user').
                        if (msgType === 'verifier_remediation') {
                            return (
                                <div key={i} className="flex gap-4 mx-auto w-full max-w-3xl justify-start">
                                    <div className="h-8 w-8 rounded-full bg-muted border flex items-center justify-center text-muted-foreground flex-shrink-0 mt-1 shadow-sm">
                                        <RotateCcw className="h-4 w-4" />
                                    </div>
                                    <div className="flex flex-col gap-1 max-w-[85%] md:max-w-[80%] min-w-0 items-start">
                                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                                            System follow-up
                                        </span>
                                        <div className="rounded-2xl rounded-tl-sm border border-dashed border-muted-foreground/30 bg-muted/40 px-4 py-2.5 text-sm text-foreground/85 italic whitespace-pre-wrap break-words">
                                            {msg.content || ''}
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        const phaseInfo = msg.role === 'assistant' ? msg.metadata?.phase : null;
                        // Phase dividers ("Phase X of Y — Name" + model-id subtitle)
                        // have been removed from the chat UI. Empty phase-start marker
                        // rows existed only to render those dividers, so skip them.
                        const isPhaseMarker = msg.metadata?.kind === 'phase_start';
                        if (isPhaseMarker) {
                            return null;
                        }
                        // Kept inert now that the divider/collapse toggle is gone
                        // (collapsedPhases can no longer be populated → always false).
                        const inCollapsedPhase = phaseInfo && collapsedPhases.has(phaseInfo.position);

                        return (
                        <Fragment key={i}>
                        {inCollapsedPhase ? null : (
                        <div className={`flex gap-4 mx-auto w-full max-w-3xl ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'assistant' && (
                                <div className="h-8 w-8 rounded-full bg-background border flex items-center justify-center text-primary flex-shrink-0 mt-1 shadow-sm">
                                    <Bot className="h-5 w-5" />
                                </div>
                            )}
                            <div className={`flex flex-col gap-2 max-w-[85%] md:max-w-[80%] min-w-0 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                {msg.role === 'user' ? (
                                    <div className="flex flex-col gap-2 items-end">
                                        {msg.images && msg.images.length > 0 && (
                                            <div className="flex flex-wrap gap-2 justify-end mb-1">
                                                {msg.images.map((url: string, idx: number) => (
                                                    <img key={idx} src={url} alt="Uploaded content" className="w-[85%] md:w-full max-w-[280px] max-h-[220px] object-cover rounded-xl shadow-sm border border-border/20 bg-background" />
                                                ))}
                                            </div>
                                        )}
                                        {msg.content && (
                                            <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm md:text-base break-words shadow-sm">
                                                <div className="whitespace-pre-wrap">
                                                    {msg.content.split(/(\[File Uploaded: .*?\]\(.*?\))/g).map((part: string, index: number) => {
                                                        const match = part.match(/\[File Uploaded: (.*?)\]\((.*?)\)/);
                                                        if (match) {
                                                            return (
                                                                <a key={index} href={match[2]} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80 flex items-center gap-1 bg-white/10 p-1 rounded">
                                                                    <FileIcon className="h-4 w-4" />
                                                                    {match[1]}
                                                                </a>
                                                            );
                                                        }
                                                        return part;
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (() => {
                                    const rawContent = msg.content || "";
                                    let thinkingContent = "";
                                    let mainContent = rawContent;

                                    if (rawContent.includes("### Thinking Process") && rawContent.includes("### Answer")) {
                                        const parts = rawContent.split("### Answer");
                                        thinkingContent = parts[0].replace("### Thinking Process", "").trim();
                                        mainContent = parts.slice(1).join("### Answer").trim();
                                    }
                                    else if (msg.thinkingSteps && msg.thinkingSteps.length > 0) {
                                        thinkingContent = msg.thinkingSteps.join("\n\n");
                                    }

                                    // Hack to handle raw stringified Python/JSON objects from backend
                                    let displayContent = mainContent;
                                    if (mainContent.trim().startsWith("[")) {
                                        try {
                                            // Try to find the text content block
                                            // Matches: 'text': '...' OR 'text': "..."
                                            const textMatch = mainContent.match(/'text':\s*(['"])((?:[^\\]|\\.)*?)\1/);
                                            if (textMatch && textMatch[2]) {
                                                displayContent = textMatch[2]
                                                    .replace(/\\n/g, '\n')
                                                    .replace(/\\"/g, '"')
                                                    .replace(/\\'/g, "'")
                                                    .replace(/\\\\/g, "\\");
                                            }
                                        } catch (e) { }
                                    }

                                    // Deduplication: if the final displayContent is substantially the
                                    // same as a thinking step that was already rendered with full markdown,
                                    // skip it so the user doesn't see the same content twice.
                                    const thinkingTexts = (msg.thinkingSteps || [])
                                        .filter((s: any) => s.type === 'thinking' || (!s.type && s.content))
                                        .map((s: any) => (typeof s === 'string' ? s : s.content || '').trim())
                                        .filter((t: string) => t.length > 200); // Only consider large blocks

                                    const isDuplicateOfThinkingStep = thinkingTexts.some((t: string) => {
                                        const dc = displayContent.trim();
                                        if (!dc || dc.length < 100) return false;
                                        // Check if they share a very large common prefix (>80% of displayContent)
                                        const minLen = Math.min(t.length, dc.length);
                                        let common = 0;
                                        for (let ci = 0; ci < minLen; ci++) {
                                            if (t[ci] === dc[ci]) common++;
                                        }
                                        return common / dc.length > 0.85;
                                    });

                                    return (
                                        <div className="w-full text-foreground/90 text-sm md:text-base leading-relaxed" id={`message-content-${i}`}>
                                            {/* Render Mixed Thoughts & Toggles */}
                                            {msg.thinkingSteps && msg.thinkingSteps.length > 0 && (
                                                <div className="flex flex-col gap-2 mb-4 w-full">
                                                    {(() => {
                                                        const groups: any[] = [];
                                                        let currentToolGroup: any[] = [];

                                                        msg.thinkingSteps.forEach((step: any) => {
                                                            if (step.type === 'tool_call' || step.type === 'tool_result') {
                                                                currentToolGroup.push(step);
                                                            } else {
                                                                if (currentToolGroup.length > 0) {
                                                                    groups.push({ type: 'tool_group', steps: currentToolGroup });
                                                                    currentToolGroup = [];
                                                                }
                                                                groups.push(step);
                                                            }
                                                        });
                                                        if (currentToolGroup.length > 0) {
                                                            groups.push({ type: 'tool_group', steps: currentToolGroup });
                                                        }

                                                        return groups.map((group: any, idx: number) => {
                                                            if (group.type === 'tool_group') {
                                                                // Pair up tool_calls with their results
                                                                const pairs: { call: any; result: any | null }[] = [];
                                                                let i2 = 0;
                                                                while (i2 < group.steps.length) {
                                                                    const step = group.steps[i2];
                                                                    if (step.type === 'tool_call') {
                                                                        const next = group.steps[i2 + 1];
                                                                        if (next && next.type === 'tool_result') {
                                                                            pairs.push({ call: step, result: next });
                                                                            i2 += 2;
                                                                        } else {
                                                                            pairs.push({ call: step, result: null });
                                                                            i2++;
                                                                        }
                                                                    } else {
                                                                        i2++;
                                                                    }
                                                                }

                                                                const isStreaming = !!msg.isProcessing || (loading && i === messages.length - 1);
                                                                return <ToolTimeline key={idx} pairs={pairs} isStreaming={isStreaming} />;
                                                            }

                                                            // Handle string/thinking steps
                                                            const content = typeof group === 'string' ? group : group.content;
                                                            if (!content) return null;

                                                            // Check for agent_reasoning metadata
                                                            const isAgentReasoning = group.metadata?.source === 'agent_reasoning';

                                                            // Detect if this thinking step is a short status line (no markdown)
                                                            // vs a rich output block that deserves full rendering.
                                                            // Short lines (< 120 chars, no markdown markers) are shown inline;
                                                            // longer / markdown-containing content gets full ReactMarkdown.
                                                            const looksLikeMarkdown = /[#*|>\-`\[\]!]/.test(content) || content.length > 120;

                                                            // Todos feature removed: suppress any legacy write_todos
                                                            // output (summary lines + full-list dumps) so it never
                                                            // renders in the chat.
                                                            if (isTodoMessage(content)) {
                                                                return null;
                                                            }

                                                            if (isAgentReasoning || looksLikeMarkdown) {
                                                                return (
                                                                    <div key={idx} className="thinking-md-block text-foreground/90 mb-3 leading-relaxed border-l-2 border-muted-foreground/20 pl-3">
                                                                        <MarkdownContent content={content} compact />
                                                                    </div>
                                                                );
                                                            }

                                                            return (
                                                                <div key={idx} className="py-0.5 mb-1 text-sm text-muted-foreground italic">
                                                                    {content}
                                                                </div>
                                                            );
                                                        });
                                                    })()}
                                                </div>
                                            )}

                                            {displayContent && !isDuplicateOfThinkingStep && !isTodoMessage(displayContent) && (
                                                <MarkdownContent content={displayContent} />
                                            )}

                                            {(msg.isProcessing || (loading && i === messages.length - 1)) && (
                                                <div className="flex items-center gap-2 mt-2 text-muted-foreground animate-pulse">
                                                    <span className="h-2 w-2 rounded-full bg-primary/50"></span>
                                                    <span className="text-xs">{thinkingText || "Thinking..."}</span>
                                                </div>
                                            )}

                                            {!msg.isProcessing && msg.role === 'assistant' && (
                                                <div className="flex items-center gap-1 mt-4 border-t border-border/50 pt-2 opacity-80">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg"
                                                        onClick={() => handleCopy(displayContent, i)}
                                                        title="Copy response"
                                                    >
                                                        {copiedIndex === i ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg"
                                                    >
                                                        <ThumbsUp className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg"
                                                    >
                                                        <ThumbsDown className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg"
                                                    >
                                                        <RotateCcw className="h-4 w-4" />
                                                    </Button>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg"
                                                                title="Export Response"
                                                            >
                                                                <Download className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="start">
                                                            <DropdownMenuItem onClick={() => {
                                                                if (displayContent) exportToPDF(displayContent, `chat-export-${i}.pdf`);
                                                            }}>
                                                                Export as PDF
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => {
                                                                if (displayContent) exportToDocx(displayContent, `chat-export-${i}.doc`);
                                                            }}>
                                                                Export as Word
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                    <div className="flex-1" />
                                                    {(function () {
                                                        // Calculate time difference
                                                        let duration = null;
                                                        if (i > 0) {
                                                            const prevMsg = messages[i - 1];
                                                            if (prevMsg.role === 'user' && prevMsg.created_at && msg.created_at) {
                                                                const start = new Date(prevMsg.created_at).getTime();
                                                                const end = new Date(msg.created_at).getTime();
                                                                const diff = (end - start) / 1000;
                                                                if (diff > 0) {
                                                                    duration = diff < 1 ? "<1s" : `${diff.toFixed(1)}s`;
                                                                }
                                                            }
                                                        }
                                                        return duration ? (
                                                            <span className="text-xs text-muted-foreground ml-1 tabular-nums">
                                                                generated in {duration}
                                                            </span>
                                                        ) : null;
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                        )}
                        </Fragment>
                        );
                    });
                })()}

                {/* Global "Thinking..." indicator - only show if we don't have a visible assistant message yet */}
                {loading && (() => {
                    const lastMsg = messages[messages.length - 1];
                    const isLastMsgVisible = lastMsg && lastMsg.role === 'assistant' &&
                        (lastMsg.content?.trim() || (lastMsg.thinkingSteps && lastMsg.thinkingSteps.length > 0));

                    if (isLastMsgVisible) return null;

                    return (
                        <div className="flex gap-4 mx-auto w-full max-w-3xl justify-start">
                            <div className="h-8 w-8 rounded-full bg-background border flex items-center justify-center text-primary flex-shrink-0 mt-1 shadow-sm">
                                <Bot className="h-5 w-5" />
                            </div>
                            <div className="flex items-center gap-2 mt-2 text-muted-foreground animate-pulse">
                                <span className="h-2 w-2 rounded-full bg-primary/50"></span>
                                <span className="text-xs">{thinkingText || "Thinking..."}</span>
                            </div>
                        </div>
                    );
                })()}

                <div className="h-4" /> {/* Spacer */}
            </div>

            {/* Scroll to Bottom Button */}
            {showScrollButton && (
                <div className="absolute bottom-[90px] md:bottom-[110px] left-0 right-0 flex justify-center pointer-events-none z-10">
                    <button
                        onClick={scrollToBottomAndResume}
                        className="pointer-events-auto flex items-center gap-2 bg-background/95 backdrop-blur-sm border border-border shadow-lg rounded-full px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-all duration-200 animate-in fade-in slide-in-from-bottom-2"
                    >
                        <ChevronDown className="h-4 w-4" />
                        <span>New messages</span>
                    </button>
                </div>
            )}

            <UsagePill chatId={chatId} visible={showUsage} />

            <div className="p-4 bg-background w-full max-w-screen flex justify-center pb-6">
                <div className="w-full max-w-3xl relative bg-muted/30 border border-border/50 rounded-2xl shadow-sm focus-within:ring-1 focus-within:ring-primary/20 focus-within:border-primary/20 transition-all flex flex-col">

                    {/* Pending Images & Files Preview */}
                    {(pendingImages.length > 0 || pendingDocuments.length > 0) && (
                        <div className="px-3 pt-3 pb-1 flex gap-3 overflow-x-auto w-full items-start">
                            {pendingImages.map((url, idx) => (
                                <div key={idx} className="relative group flex-shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <img src={url} alt="upload" className="h-20 w-20 md:h-24 md:w-24 object-cover rounded-xl border shadow-sm" />
                                    <button
                                        onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                                        className="absolute -top-2 -right-2 bg-background border shadow-sm text-muted-foreground hover:text-destructive rounded-full p-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                            {pendingDocuments.map((doc, idx) => (
                                <div key={`doc-${idx}`} className="relative group flex-shrink-0 animate-in fade-in slide-in-from-bottom-2 duration-300 bg-background/50 border border-border/50 rounded-xl shadow-sm p-3 w-36 h-20 md:h-24 md:w-40 flex flex-col items-center justify-center text-center">
                                    <FileIcon className="h-6 w-6 md:h-8 md:w-8 text-primary/70 mb-1 md:mb-2" />
                                    <span className="text-[10px] md:text-xs font-medium text-foreground truncate w-full" title={doc.name}>{doc.name}</span>
                                    <button
                                        onClick={() => setPendingDocuments(prev => prev.filter((_, i) => i !== idx))}
                                        className="absolute -top-2 -right-2 bg-background border shadow-sm text-muted-foreground hover:text-destructive rounded-full p-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <textarea
                        className={`w-full bg-transparent border-none rounded-2xl pl-[112px] pr-32 pb-3 pt-3 md:pb-4 md:pt-4 text-sm md:text-base focus:outline-none resize-none overflow-y-auto ${(pendingImages.length > 0 || pendingDocuments.length > 0) ? "min-h-[44px]" : "min-h-[56px]"}`}
                        placeholder={(pendingImages.length > 0 || pendingDocuments.length > 0) ? "Add a message about these attachments..." : "Send a message to the model..."}
                        value={input}
                        onPaste={handlePaste}
                        onChange={(e) => {
                            setInput(e.target.value);
                            e.target.style.height = 'auto';
                            e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        disabled={loading}
                        rows={1}
                    />

                    <div className="absolute bottom-2 left-2 flex gap-1">
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileUpload}
                            accept=".pdf,.csv,.xls,.xlsx,.txt"
                            multiple
                        />
                        <input
                            type="file"
                            ref={imageInputRef}
                            className="hidden"
                            onChange={handleImageUpload}
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            multiple
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={loading || uploading || uploadingImage}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background/50 rounded-lg"
                        >
                            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => imageInputRef.current?.click()}
                            disabled={loading || uploading || uploadingImage}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background/50 rounded-lg"
                        >
                            {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={toggleVoiceInput}
                            disabled={loading || uploading || uploadingImage}
                            className={`h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background/50 rounded-lg ${isRecording ? "text-destructive" : ""}`}
                        >
                            {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </Button>
                    </div>

                    <div className="absolute bottom-2 right-2 flex items-center gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground px-2">
                                    {availableModels.find(m => m.id === model)?.name || "Loading..."}
                                    <ChevronDown className="h-3 w-3 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            {availableModels.length > 0 && (
                                <DropdownMenuContent align="end">
                                    {availableModels.map(m => (
                                        <DropdownMenuItem key={m.id} onClick={() => setModel(m.id)}>
                                            {m.name}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            )}
                        </DropdownMenu>
                        <Button
                            onClick={() => loading ? handleStop() : handleSend()}
                            disabled={(!loading && !input.trim() && pendingImages.length === 0)}
                            size="icon"
                            className={`h-8 w-8 rounded-lg transition-all ${loading
                                ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                                : "bg-primary hover:bg-primary/90 text-primary-foreground"
                                }`}
                            title={loading ? "Stop generating" : "Send message"}
                        >
                            {loading ? (
                                <Square className="h-4 w-4 fill-current" />
                            ) : (
                                <Send className="h-4 w-4" />
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
