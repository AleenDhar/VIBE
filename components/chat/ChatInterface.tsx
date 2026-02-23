"use client";

import { createElement, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Send, Upload, RotateCcw, Copy, Check, ThumbsUp, ThumbsDown, Paperclip, Mic, FileText as FileIcon, Loader2, Bot, User, MicOff, Square, ChevronDown, Plus, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChartRenderer } from "@/components/chat/ChartRenderer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createNewChat } from "@/lib/actions/chat";
import { extractFileContent } from "@/lib/extract-file-content";
import { addDocument } from "@/lib/actions/documents";
import { exportToPDF, exportToDocx } from "@/lib/export-utils";

interface ChatProps {
    projectId: string | null;
    chatId: string;
    initialMessages: any[];
    initialInput?: string;
    initialModel?: string;
}

export function ChatInterface({ projectId, chatId, initialMessages, initialInput, initialModel }: ChatProps) {
    // Process initial messages - group thinking/tool steps with final messages
    const processedInitialMessages = initialMessages.reduce((acc: any[], msg: any) => {
        const type = msg.type || 'message';

        if (msg.role === 'user') {
            // Always add user messages
            acc.push({ ...msg });
        } else if (msg.role === 'assistant') {
            const lastMsg = acc[acc.length - 1];

            // If this is a thinking/tool message, attach it to the last assistant message
            if (type === 'thinking' || type === 'tool_call' || type === 'tool_result') {
                if (lastMsg && lastMsg.role === 'assistant') {
                    // Add to existing assistant message's thinking steps
                    // Add to existing assistant message's thinking steps
                    if (type === 'thinking') {
                        // Safely parse metadata
                        const meta = typeof msg.metadata === 'string' ? (JSON.parse(msg.metadata) || {}) : (msg.metadata || {});
                        lastMsg.thinkingSteps = [...(lastMsg.thinkingSteps || []), { type: 'thinking', content: msg.content, metadata: meta }];
                    } else if (type === 'tool_call') {
                        // Safely parse metadata
                        const meta = typeof msg.metadata === 'string' ? (JSON.parse(msg.metadata) || {}) : (msg.metadata || {});
                        let args = "";
                        const rawArgs = msg.args || meta.args || {};
                        try {
                            args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs, null, 2);
                        } catch (e) { args = JSON.stringify(rawArgs); }

                        const toolName = msg.tool || meta.tool || meta.name || meta.tool_name || "Unknown Tool";
                        lastMsg.thinkingSteps = [...(lastMsg.thinkingSteps || []), {
                            type: 'tool_call',
                            tool: toolName,
                            args: args
                        }];
                    } else if (type === 'tool_result') {
                        lastMsg.thinkingSteps = [...(lastMsg.thinkingSteps || []), { type: 'tool_result', content: msg.content }];
                    }
                } else {
                    // No assistant message to attach to - create a placeholder
                    const newMsg = {
                        ...msg,
                        thinkingSteps: type === 'thinking' ? [{ type: 'thinking', content: msg.content }] : [],
                        isProcessing: true, // Default to processing until we see a final message
                        content: ""
                    };
                    acc.push(newMsg);
                }
            } else if (type === 'status' || type === 'cancelled') {
                if (type === 'cancelled' || msg.content === 'cancelled') {
                    if (lastMsg && lastMsg.role === 'assistant') {
                        lastMsg.content = (lastMsg.content || "") + "\n\n*[Task Cancelled]*";
                        lastMsg.isProcessing = false;
                    }
                }
                // Skip status messages from being added as new bubbles
                return acc;
            } else if (type === 'final' || type === 'message') {
                // Final or regular message - add it
                if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
                    // Merge with existing empty assistant message (from thinking steps)
                    lastMsg.content = msg.content || "";
                    lastMsg.id = msg.id;
                    lastMsg.created_at = msg.created_at;
                    lastMsg.isProcessing = false; // Mark as done!
                } else {
                    // New assistant message
                    acc.push({
                        ...msg,
                        thinkingSteps: [],
                        isProcessing: false,
                        content: msg.content || ""
                    });
                }
            }
        }
        return acc;
    }, []);

    // State definitions
    const [messages, setMessages] = useState<any[]>(processedInitialMessages);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [thinkingText, setThinkingText] = useState("");
    const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
    const [isRecording, setIsRecording] = useState(false);
    const [model, setModel] = useState(initialModel || "anthropic:claude-opus-4-6");
    const [creatingNewChat, setCreatingNewChat] = useState(false);
    const router = useRouter();

    // Refs
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<any>(null);
    const supabase = createClient();

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

    // Scroll to bottom on messages change
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, loading]);

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
            handleSend(initialInput);
        }
    }, [initialInput]);

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

                        // 1. Skip User Messages - they are added optimistically on send
                        if (newMsg.role === 'user') {
                            console.log('[Realtime] Ignoring user message from DB (already added optimistically)');
                            return prev;
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
                                return prev.map((msg, index, array) => {
                                    if (index !== findLastAssistantIndex(array)) return msg;

                                    let newStep: any = null;
                                    if (messageType === 'thinking') {
                                        const metaRaw = newMsg.metadata || {};
                                        const meta = typeof metaRaw === 'string' ? (JSON.parse(metaRaw) || {}) : metaRaw;
                                        newStep = { type: 'thinking', content: newMsg.content, metadata: meta };
                                    } else if (messageType === 'tool_call') {
                                        let args = "";
                                        const metaRaw = newMsg.metadata || {};
                                        const meta = typeof metaRaw === 'string' ? (JSON.parse(metaRaw) || {}) : metaRaw;
                                        const rawArgs = newMsg.args || meta.args || {};
                                        try {
                                            args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs, null, 2);
                                        } catch (e) { args = JSON.stringify(rawArgs); }
                                        const toolName = newMsg.tool || meta.tool || meta.name || meta.tool_name || "Unknown Tool";
                                        newStep = { type: 'tool_call', tool: toolName, args: args };
                                    } else if (messageType === 'tool_result') {
                                        newStep = { type: 'tool_result', content: newMsg.content };
                                    }

                                    return {
                                        ...msg,
                                        thinkingSteps: [...(msg.thinkingSteps || []), newStep],
                                        // Ensure it stays processing until final message
                                        isProcessing: true,
                                        // Update ID if we need to track it, though usually we stay with the placeholder ID until final
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

    // Polling fallback when Realtime fails
    useEffect(() => {
        if (!chatId) return;
        if (realtimeStatus === 'connected') return; // Only poll if Realtime is not working

        console.log('[Polling] Realtime not connected, starting polling fallback');
        const interval = setInterval(async () => {
            // Check if there are any processing messages
            const processingMsg = messages.find(m => m.role === 'assistant' && m.isProcessing);
            if (!processingMsg) {
                return; // Nothing to poll for
            }

            console.log('[Polling] Checking for updates...');
            const { data, error } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('chat_id', chatId)
                .eq('role', 'assistant')
                .or('type.eq.message,type.eq.final,type.is.null') // Only fetch final messages, not thinking steps
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (error) {
                console.error('[Polling] Error fetching messages:', error);
                return;
            }

            if (data && data.content) {
                console.log('[Polling] Found completed message from DB, updating UI');
                setMessages(prev => {
                    const lastAssistantIndex = prev.findIndex(m => m.role === 'assistant' && m.isProcessing);
                    if (lastAssistantIndex === -1) return prev;

                    const updated = [...prev];
                    updated[lastAssistantIndex] = {
                        ...updated[lastAssistantIndex],
                        id: data.id,
                        content: data.content,
                        created_at: data.created_at,
                        isProcessing: false
                    };
                    return updated;
                });
            }
        }, 3000); // Poll every 3 seconds

        return () => {
            console.log('[Polling] Stopping polling fallback');
            clearInterval(interval);
        };
    }, [chatId, realtimeStatus, messages, supabase]);

    const handleSend = async (messageContent: string = input) => {
        if (!messageContent.trim()) return;

        const tempId = crypto.randomUUID();
        // Add created_at timestamp
        const userMsg = { role: "user", content: messageContent, id: tempId, created_at: new Date().toISOString() };
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setLoading(true);
        setThinkingText("Thinking...");

        // Placeholder for assistant message
        const assistantMsgId = crypto.randomUUID();
        setMessages(prev => [...prev, {
            role: "assistant",
            content: "",
            id: assistantMsgId,
            thinkingSteps: [],
            isProcessing: true,
            created_at: new Date().toISOString()
        }]);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectId,
                    chatId,
                    content: messageContent,
                    previousMessages: messages,
                    model
                })
            });

            if (!response.ok) {
                throw new Error(await response.text());
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
                                    } else if (data.type === 'error') {
                                        newMessages[lastMsgIndex].content += `\n\nError: ${data.content}`;
                                        newMessages[lastMsgIndex].isProcessing = false;
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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        setUploading(true);
        const filePath = `chat/${chatId}/${Date.now()}_${file.name}`;

        try {
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

            const fileMessage = `[File Uploaded: ${file.name}](${publicUrl})${extractedContent ? "\n\n*File content has been indexed and added to chat context.*" : ""}`;
            await handleSend(fileMessage);

        } catch (error: any) {
            console.error("Upload failed", error);
            alert("Upload failed: " + error.message);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
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
                </div>
            )}

            <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 md:p-4 space-y-6 w-full max-w-screen" ref={scrollRef}>
                {messages.length === 0 && (
                    <div className="flex h-full items-center justify-center text-muted-foreground opacity-50 px-4 text-center flex-col gap-2">
                        <div className="p-4 rounded-full bg-muted/50">
                            <Bot className="h-8 w-8" />
                        </div>
                        <p>How can I help you today?</p>
                    </div>
                )}
                {messages
                    .filter(msg => {
                        // Hide assistant messages that are processing with no content AND no thinking steps
                        // If they have thinking steps, we want to show them so the user can see the progress
                        if (msg.role === 'assistant' && msg.isProcessing && !msg.content?.trim() && (!msg.thinkingSteps || msg.thinkingSteps.length === 0)) {
                            return false;
                        }
                        return true;
                    })
                    .map((msg, i) => (
                        <div key={i} className={`flex gap-4 mx-auto w-full max-w-3xl ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'assistant' && (
                                <div className="h-8 w-8 rounded-full bg-background border flex items-center justify-center text-primary flex-shrink-0 mt-1 shadow-sm">
                                    <Bot className="h-5 w-5" />
                                </div>
                            )}
                            <div className={`flex flex-col gap-2 max-w-[85%] md:max-w-[80%] min-w-0 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                {msg.role === 'user' ? (
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
                                                                const toolCount = group.steps.filter((s: any) => s.type === 'tool_call').length;
                                                                return (
                                                                    <details key={idx} className="group border border-border/50 rounded-lg bg-muted/30 overflow-hidden mb-2">
                                                                        <summary className="flex items-center gap-2 p-2 px-3 text-xs font-medium cursor-pointer hover:bg-muted/50 select-none transition-colors text-muted-foreground">
                                                                            <div className="flex items-center justify-center h-4 w-4 transition-transform group-open:rotate-90">
                                                                                <ChevronDown className="h-3 w-3" />
                                                                            </div>
                                                                            <span>Used {toolCount} tool{toolCount !== 1 ? 's' : ''}</span>
                                                                        </summary>
                                                                        <div className="p-2 border-t border-border/40 flex flex-col gap-2 bg-background/30">
                                                                            {group.steps.map((step: any, stepIdx: number) => {
                                                                                if (step.type === 'tool_call') {
                                                                                    return (
                                                                                        <div key={stepIdx} className="border border-border/50 rounded overflow-hidden">
                                                                                            <div className="bg-muted/50 px-2 py-1 text-[10px] font-mono text-primary/70 border-b border-border/50 flex items-center justify-between">
                                                                                                <span>Calling {step.tool}...</span>
                                                                                            </div>
                                                                                            <pre className="text-[10px] bg-background/50 p-2 overflow-x-auto text-muted-foreground m-0">
                                                                                                {step.args && (typeof step.args === 'string' ? step.args : JSON.stringify(step.args, null, 2))}
                                                                                            </pre>
                                                                                        </div>
                                                                                    );
                                                                                }
                                                                                if (step.type === 'tool_result') {
                                                                                    return (
                                                                                        <details key={stepIdx} className="group/res border border-emerald-500/20 rounded bg-emerald-500/5 overflow-hidden">
                                                                                            <summary className="flex items-center gap-2 px-2 py-1 text-[10px] font-medium cursor-pointer hover:bg-emerald-500/10 select-none transition-colors text-emerald-600/80">
                                                                                                <div className="flex items-center justify-center h-3 w-3 transition-transform group-open/res:rotate-90">
                                                                                                    <ChevronDown className="h-2 w-2" />
                                                                                                </div>
                                                                                                <span>Result</span>
                                                                                            </summary>
                                                                                            <div className="p-2 pt-0 pl-6 border-t border-transparent group-open/res:border-emerald-500/10">
                                                                                                <pre className="text-[10px] whitespace-pre-wrap text-muted-foreground mt-1 max-h-[200px] overflow-y-auto font-mono">
                                                                                                    {step.content}
                                                                                                </pre>
                                                                                            </div>
                                                                                        </details>
                                                                                    );
                                                                                }
                                                                                return null;
                                                                            })}
                                                                        </div>
                                                                    </details>
                                                                );
                                                            }

                                                            // Handle string/thinking steps
                                                            const content = typeof group === 'string' ? group : group.content;
                                                            // Check for agent_reasoning metadata
                                                            const isAgentReasoning = group.metadata?.source === 'agent_reasoning';

                                                            if (isAgentReasoning) {
                                                                return (
                                                                    <div key={idx} className="text-foreground/90 whitespace-pre-wrap mb-3 leading-relaxed">
                                                                        {content}
                                                                    </div>
                                                                );
                                                            }

                                                            return (
                                                                <div key={idx} className="py-1  mb-2">
                                                                    {content}
                                                                </div>
                                                            );
                                                        });
                                                    })()}
                                                </div>
                                            )}

                                            {displayContent && (
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    components={{
                                                        code: ({ node, ...props }: any) => {
                                                            const match = /language-(\w+)/.exec((props.className || ''))
                                                            if (match && match[1] === 'chart') {
                                                                return <ChartRenderer jsonString={String(props.children).replace(/\n$/, '')} />
                                                            }
                                                            return !match ? (
                                                                <code className="bg-muted px-1.5 py-0.5 rounded text-[0.9em] font-mono" {...props} />
                                                            ) : (
                                                                <code className="block font-mono text-xs md:text-sm" {...props} />
                                                            )
                                                        },
                                                        pre: ({ node, ...props }: any) => (
                                                            <pre className="bg-muted/50 p-4 rounded-lg my-3 overflow-x-auto border border-border/50" {...props} />
                                                        ),
                                                        img: ({ node, ...props }: any) => (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img className="max-w-full h-auto rounded-lg my-3 border border-border/50 shadow-sm" {...props} alt={props.alt || "Image"} />
                                                        ),
                                                        p: ({ node, ...props }: any) => (
                                                            <p className="mb-3 last:mb-0 leading-7" {...props} />
                                                        ),
                                                        a: ({ node, ...props }: any) => (
                                                            <a className="text-primary font-medium hover:underline underline-offset-4" target="_blank" rel="noopener noreferrer" {...props} />
                                                        ),
                                                        ul: ({ node, ...props }: any) => (
                                                            <ul className="list-disc pl-6 mb-3 space-y-1.5 marker:text-muted-foreground" {...props} />
                                                        ),
                                                        ol: ({ node, ...props }: any) => (
                                                            <ol className="list-decimal pl-6 mb-3 space-y-1.5 marker:text-muted-foreground" {...props} />
                                                        ),
                                                        li: ({ node, ...props }: any) => (
                                                            <li className="pl-1" {...props} />
                                                        ),
                                                        blockquote: ({ node, ...props }: any) => (
                                                            <blockquote className="border-l-4 border-primary/20 pl-4 py-1 italic text-muted-foreground my-4" {...props} />
                                                        ),
                                                        table: ({ node, ...props }: any) => (
                                                            <div className="overflow-x-auto my-4 rounded-lg border border-border max-w-full">
                                                                <table className="w-full text-sm text-left border-collapse" {...props} />
                                                            </div>
                                                        ),
                                                        thead: ({ node, ...props }: any) => (
                                                            <thead className="bg-muted text-muted-foreground uppercase text-xs tracking-wider" {...props} />
                                                        ),
                                                        tbody: ({ node, ...props }: any) => (
                                                            <tbody className="divide-y divide-border/50" {...props} />
                                                        ),
                                                        tr: ({ node, ...props }: any) => (
                                                            <tr className="bg-card/50 hover:bg-muted/50 transition-colors" {...props} />
                                                        ),
                                                        th: ({ node, ...props }: any) => (
                                                            <th className="px-4 py-3 font-medium whitespace-nowrap" {...props} />
                                                        ),
                                                        hr: ({ node, ...props }: any) => (
                                                            <hr className="my-6 border-border/50" {...props} />
                                                        ),
                                                        td: ({ node, ...props }: any) => (
                                                            <td className="px-4 py-3 whitespace-nowrap md:whitespace-normal" {...props} />
                                                        )
                                                    }}
                                                >
                                                    {displayContent}
                                                </ReactMarkdown>
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
                    ))}

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

            <div className="p-4 bg-background w-full max-w-screen flex justify-center pb-6">
                <div className="w-full max-w-3xl relative bg-muted/30 border border-border/50 rounded-2xl shadow-sm focus-within:ring-1 focus-within:ring-primary/20 focus-within:border-primary/20 transition-all">
                    <textarea
                        className="w-full bg-transparent border-none rounded-2xl pl-20 pr-32 py-3 md:py-4 text-sm md:text-base focus:outline-none resize-none min-h-[56px] max-h-[200px] overflow-y-auto"
                        placeholder="Send a message to the model..."
                        value={input}
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

                    <div className="absolute bottom-3 left-2 flex gap-1">
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            onChange={handleFileUpload}
                            accept=".pdf,.csv,.xls,.xlsx,.txt,image/*"
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={loading || uploading}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background/50 rounded-lg"
                        >
                            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={toggleVoiceInput}
                            disabled={loading}
                            className={`h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background/50 rounded-lg ${isRecording ? "text-destructive" : ""}`}
                        >
                            {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </Button>
                    </div>

                    <div className="absolute bottom-3 right-2 flex items-center gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground px-2">
                                    {model === "openai:gpt-5.2" && "GPT-5.2"}
                                    {model === "google_genai:gemini-3-pro-preview" && "Gemini 3 Pro"}
                                    {model === "google_genai:gemini-3-flash-preview" && "Gemini 3 Flash"}
                                    {model === "anthropic:claude-opus-4-6" && "Opus 4.6"}
                                    {model === "anthropic:claude-sonnet-4-6" && "Sonnet 4.6"}
                                    <ChevronDown className="h-3 w-3 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setModel("google_genai:gemini-3-pro-preview")}>
                                    Gemini 3 Pro
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setModel("google_genai:gemini-3-flash-preview")}>
                                    Gemini 3 Flash
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setModel("openai:gpt-5.2")}>
                                    GPT 5.2
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setModel("anthropic:claude-opus-4-6")}>
                                    Opus 4.6
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setModel("anthropic:claude-sonnet-4-6")}>
                                    Sonnet 4.6
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            onClick={() => loading ? handleStop() : handleSend()}
                            disabled={!loading && !input.trim()}
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
