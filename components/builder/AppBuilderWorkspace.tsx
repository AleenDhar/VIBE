"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_BUILDER_SYSTEM_PROMPT } from "@/lib/builder-constants";
import {
    Send,
    Sparkles,
    Code,
    Play,
    Laptop,
    Smartphone,
    Tablet,
    Wand2,
    RefreshCw,
    Minimize2,
    Bot,
    User,
    MoreHorizontal,
    Download,
    Copy,
    Check,
    ArrowLeft,
    Loader2,
    AlertCircle,
    Globe,
    ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    hasCode?: boolean;
}

interface AppError {
    message: string;
    stack?: string;
    type: string;
    timestamp: number;
}

interface AppBuilderWorkspaceProps {
    sessionId: string;
}

// Inner component that uses useSearchParams
function AppBuilderWorkspaceInner({ sessionId }: AppBuilderWorkspaceProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabaseRef = useRef(createClient());

    // State
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isBuilding, setIsBuilding] = useState(false);
    const [generatedCode, setGeneratedCode] = useState("");
    const [errors, setErrors] = useState<AppError[]>([]);
    const [sessionTitle, setSessionTitle] = useState("Untitled App");
    const [isLoadingSession, setIsLoadingSession] = useState(true);
    const [copied, setCopied] = useState(false);

    // Publishing state
    const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
    const [publishSlug, setPublishSlug] = useState("");
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishError, setPublishError] = useState("");
    const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

    // System Prompt state
    const [systemPrompt, setSystemPrompt] = useState("");
    const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
    const [isSavingPrompt, setIsSavingPrompt] = useState(false);

    // Continue state
    const [canContinue, setCanContinue] = useState(false);
    const [isContinuing, setIsContinuing] = useState(false);

    const [previewMode, setPreviewMode] = useState<"desktop" | "tablet" | "mobile">("desktop");
    const [viewMode, setViewMode] = useState<"preview" | "code" | "errors">("preview");
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const scrollRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const autorunTriggered = useRef(false);
    const initialPromptRef = useRef<string | null>(null);

    const scrollToBottom = useCallback(() => {
        setTimeout(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        }, 50);
    }, []);

    // Strip code blocks from text
    function stripCodeBlocks(text: string): string {
        return text.replace(/```[\s\S]*?```/g, "").trim();
    }

    // Extract HTML code from text (robustly handles streaming/partial blocks)
    function extractHtmlCode(text: string): string {
        // Try complete block first
        const fullMatch = text.match(/```html([\s\S]*?)```/);
        if (fullMatch) return fullMatch[1].trim();

        // Fallback for streaming: if block is open but not yet closed
        const partialMatch = text.match(/```html([\s\S]*)$/);
        if (partialMatch) return partialMatch[1].trim();

        // Final fallback: look for content between <html> tags if backticks are missing
        const htmlMatch = text.match(/<html[\s\S]*?<\/html>/i);
        if (htmlMatch) return htmlMatch[0];

        return "";
    }

    // Apply Search/Replace patches to existing code
    function applyPatches(baseContent: string, diffText: string): string {
        const blocks = diffText.split("<<<<<<< SEARCH");
        let newContent = baseContent;

        // Skip first part if it doesn't contain a search block
        for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i];
            const parts = block.split("=======");
            if (parts.length < 2) continue;

            const searchPart = parts[0].trim();
            const replaceParts = parts[1].split(">>>>>>> REPLACE");
            if (replaceParts.length < 2) continue;

            const replacePart = replaceParts[0].trim();

            if (newContent.includes(searchPart)) {
                newContent = newContent.replace(searchPart, replacePart);
            } else {
                console.warn("[Builder] Could not find search block in content:", searchPart);
            }
        }
        return newContent;
    }

    const [appConfig, setAppConfig] = useState<any>(null);

    // Load session data from DB on mount
    useEffect(() => {
        const supabase = supabaseRef.current;
        const loadSession = async () => {
            setIsLoadingSession(true);

            // Load session info
            const { data: session } = await supabase
                .from("builder_sessions")
                .select("title, system_prompt")
                .eq("id", sessionId)
                .maybeSingle();

            if (session) {
                setSessionTitle(session.title || "Untitled App");
                if (session.system_prompt) setSystemPrompt(session.system_prompt);
            }

            // Load latest artifact config
            const { data: latestArtifact } = await supabase
                .from("builder_artifacts")
                .select("code, config")
                .eq("session_id", sessionId)
                .order("version", { ascending: false })
                .limit(1)
                .maybeSingle();

            if (latestArtifact?.config) {
                setAppConfig(latestArtifact.config);
            }

            // Load messages
            const { data: dbMessages } = await supabase
                .from("builder_messages")
                .select("id, role, content, created_at")
                .eq("session_id", sessionId)
                .order("created_at", { ascending: true });

            if (dbMessages && dbMessages.length > 0) {
                const loaded: ChatMessage[] = dbMessages.map((m) => {
                    const hasCode = /```html[\s\S]*?```/.test(m.content);
                    return {
                        id: m.id,
                        role: m.role as "user" | "assistant",
                        content: m.content, // Store FULL content including code
                        hasCode,
                    };
                });
                setMessages(loaded);

                // If we didn't get code from artifacts, extract from messages
                if (!latestArtifact?.code) {
                    const lastAssistantWithCode = [...loaded].reverse().find(m => m.role === "assistant" && m.hasCode);
                    if (lastAssistantWithCode) {
                        setGeneratedCode(extractHtmlCode(lastAssistantWithCode.content));
                    }
                } else {
                    setGeneratedCode(latestArtifact.code);
                }

                // Check if last message is a user message with no following assistant message
                // This is the case for autorun
                const lastMsg = dbMessages[dbMessages.length - 1];
                if (lastMsg.role === "user") {
                    initialPromptRef.current = lastMsg.content;
                }
            }
            setIsLoadingSession(false);
        };

        loadSession();
    }, [sessionId]);

    // Message Listener (Errors & Persisted Saves)
    useEffect(() => {
        const handleMessage = async (event: MessageEvent) => {
            if (event.data?.type === "runtime_error") {
                setErrors(prev => [...prev, {
                    message: event.data.message,
                    stack: event.data.stack,
                    type: event.data.errorType,
                    timestamp: Date.now()
                }]);
            }

            // Handle Full Artifact Saves (Code + Config)
            if (event.data?.type === "SAVE_ARTIFACT" && event.data.code) {
                const newCode = event.data.code;
                const newConfig = event.data.config || appConfig;
                const supabase = supabaseRef.current;

                try {
                    const { count } = await supabase
                        .from("builder_artifacts")
                        .select("*", { count: "exact", head: true })
                        .eq("session_id", sessionId);

                    await supabase.from("builder_artifacts").insert({
                        session_id: sessionId,
                        code: newCode,
                        config: newConfig,
                        version: (count || 0) + 1,
                    });

                    setGeneratedCode(newCode);
                    if (newConfig) setAppConfig(newConfig);
                    console.log("[Builder] Artifact saved successfully (Full)");
                } catch (err) {
                    console.error("[Builder] Failed to save artifact:", err);
                }
            }

            // Handle Light Config-Only Saves
            if (event.data?.type === "SAVE_SITE_CONFIG" && event.data.config) {
                const newConfig = event.data.config;
                const supabase = supabaseRef.current;

                try {
                    // Save to DB (as a new artifact version but with same code)
                    const { count } = await supabase
                        .from("builder_artifacts")
                        .select("*", { count: "exact", head: true })
                        .eq("session_id", sessionId);

                    await supabase.from("builder_artifacts").insert({
                        session_id: sessionId,
                        code: generatedCode,
                        config: newConfig,
                        version: (count || 0) + 1,
                    });

                    setAppConfig(newConfig);
                    console.log("[Builder] Site config updated persistently");
                } catch (err) {
                    console.error("[Builder] Failed to save site config:", err);
                }
            }

            // NEW: Send config to iframe when it's ready
            if (event.data?.type === "IFRAME_READY" && appConfig) {
                iframeRef.current?.contentWindow?.postMessage({
                    type: "INIT_CONFIG",
                    config: appConfig
                }, "*");
                console.log("[Builder] Sent INIT_CONFIG to iframe");
            }
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [sessionId, generatedCode, appConfig]);

    // Enhance generated code with error reporting and cloud config support
    const getEnhancedCode = useCallback((code: string) => {
        if (!code) return "";
        const injection = `
<script>
    (function() {
        // Universal Error Reporter
        const reportError = (message, stack, type) => {
            window.parent.postMessage({
                type: 'runtime_error',
                message: message,
                stack: stack,
                errorType: type
            }, '*');
        };
        window.onerror = (msg, url, line, col, error) => {
            reportError(msg, error?.stack, 'Uncaught Error');
            return false;
        };
        window.onunhandledrejection = (event) => {
            reportError(event.reason?.message || event.reason, event.reason?.stack, 'Unhandled Rejection');
        };
        const originalConsoleError = console.error;
        console.error = (...args) => {
            reportError(args.join(' '), null, 'Console Error');
            if (originalConsoleError) originalConsoleError.apply(console, args);
        };

        // Self-Saving Artifact Helper (Code + Config)
        window.saveArtifact = (config) => {
            document.querySelectorAll('input, textarea').forEach(el => {
                if (el.tagName === 'TEXTAREA') {
                    el.textContent = (el as HTMLTextAreaElement).value; 
                } else {
                    el.setAttribute('value', (el as HTMLInputElement).value);
                }
            });

            setTimeout(() => {
                const htmlString = document.documentElement.outerHTML;
                window.parent.postMessage({
                    type: 'SAVE_ARTIFACT',
                    code: htmlString.startsWith('<!DOCTYPE') ? htmlString : '<!DOCTYPE html>\\n' + htmlString,
                    config: config || (window.getAppConfig ? window.getAppConfig() : null)
                }, '*');
            }, 100);
        };

        // Site Config Persistent Helper (Config Only)
        window.saveConfig = (config) => {
            window.parent.postMessage({ type: 'SAVE_SITE_CONFIG', config: config }, '*');
        };

        // Handshake Step: Parent will respond with INIT_CONFIG
        window.parent.postMessage({ type: 'IFRAME_READY' }, '*');

        // Handle incoming config from parent
        window.addEventListener('message', (event) => {
            if (event.data.type === 'INIT_CONFIG' && window.onConfigLoad) {
                window.onConfigLoad(event.data.config);
            }
        });
    })();
</script>
        `;
        // Inject before </body>
        if (code.includes("</body>")) {
            return code.replace("</body>", injection + "</body>");
        }
        return code + injection;
    }, []);

    // Auto-run: if redirected from landing with a prompt
    useEffect(() => {
        if (isLoadingSession || autorunTriggered.current) return;
        const shouldAutorun = searchParams.get("autorun") === "1";
        if (shouldAutorun && initialPromptRef.current) {
            const prompt = initialPromptRef.current;
            initialPromptRef.current = null;
            autorunTriggered.current = true;
            // Don't add user message again — it was already loaded from DB
            buildApp(prompt, true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoadingSession]);

    // Build the app — skipUserMessage = true when autorunning (message already in DB + state)
    const buildApp = async (userPrompt: string, skipUserMessage: boolean = false) => {
        if (!userPrompt.trim() || isBuilding) return;
        setIsBuilding(true);
        setErrors([]); // Clear errors on new build

        const supabase = supabaseRef.current;

        try {
            // Add user message to chat (unless it's already there from DB load)
            if (!skipUserMessage) {
                const userMsgId = crypto.randomUUID();
                setMessages(prev => [...prev, {
                    id: userMsgId,
                    role: "user",
                    content: userPrompt,
                }]);
                scrollToBottom();

                // Save user message to DB
                await supabase.from("builder_messages").insert({
                    session_id: sessionId,
                    role: "user",
                    content: userPrompt,
                });

                // Update session title from first user message
                if (messages.filter(m => m.role === "user").length === 0) {
                    const title = userPrompt.slice(0, 60) + (userPrompt.length > 60 ? "..." : "");
                    setSessionTitle(title);
                    await supabase.from("builder_sessions")
                        .update({ title, updated_at: new Date().toISOString() })
                        .eq("id", sessionId);
                }
            }

            // Build the messages array for the API
            const currentMessages = [...messages];
            if (!skipUserMessage) {
                currentMessages.push({ id: "temp", role: "user", content: userPrompt });
            }
            const apiMessages = currentMessages
                .filter(m => m.content && m.content.trim().length > 0)
                .map(m => ({
                    role: m.role,
                    content: m.content,
                }));

            const response = await fetch("/api/builder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: apiMessages, sessionId, systemPrompt }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("API error:", response.status, errorText);
                throw new Error(`API error: ${response.status} `);
            }

            // Read streaming response
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let fullResponse = "";

            if (reader) {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value, { stream: true });
                        fullResponse += chunk;

                        // Try to extract code from partial response for live preview
                        const partialCode = extractHtmlCode(fullResponse);
                        if (partialCode) {
                            setGeneratedCode(partialCode);
                            if (viewMode !== "preview") setViewMode("preview");
                        }
                    }
                    console.log("[Builder] Stream finished. Total length:", fullResponse.length);
                } catch (streamErr) {
                    console.error("[Builder] Stream reading error:", streamErr);
                    throw streamErr;
                } finally {
                    reader.releaseLock();
                }
            } else {
                console.error("[Builder] No response body found");
                throw new Error("No response body");
            }

            if (!fullResponse.trim()) {
                console.warn("[Builder] Received empty response from AI");
                throw new Error("Received an empty response from the AI architect.");
            }

            // Detect if response was cut off (e.g. unclosed code block or search/replace block)
            const isTruncated = (fullResponse.includes("```") && !fullResponse.endsWith("```")) ||
                (fullResponse.includes("<<<<<<< SEARCH") && !fullResponse.includes(">>>>>>> REPLACE"));
            setCanContinue(isTruncated);

            // Process extraction or patching
            const finalCode = extractHtmlCode(fullResponse);
            const hasEditBlock = fullResponse.includes("<<<<<<< SEARCH");

            let updatedCode = generatedCode;
            if (finalCode) {
                updatedCode = finalCode;
            } else if (hasEditBlock) {
                updatedCode = applyPatches(generatedCode, fullResponse);
            }

            const hasCode = updatedCode !== generatedCode || !!finalCode;

            if (hasCode) {
                setGeneratedCode(updatedCode);
                // Only switch to preview if not already in a view mode that the user chose
                if (viewMode === "code") {
                    // Stay in code
                } else {
                    setViewMode("preview");
                }
            }

            // Add assistant message to history (FULL CONTENT so AI remembers context)
            if (fullResponse.trim()) {
                setMessages(prev => [...prev, {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: fullResponse,
                    hasCode,
                }]);
                scrollToBottom();

                // Save to DB (fire-and-forget, don't let DB errors block the UI)
                try {
                    const { data: savedMsg } = await supabase.from("builder_messages").insert({
                        session_id: sessionId,
                        role: "assistant",
                        content: fullResponse,
                    }).select("id").single();

                    if (finalCode) {
                        const { count } = await supabase
                            .from("builder_artifacts")
                            .select("*", { count: "exact", head: true })
                            .eq("session_id", sessionId);

                        await supabase.from("builder_artifacts").insert({
                            session_id: sessionId,
                            message_id: savedMsg?.id,
                            code: finalCode,
                            version: (count || 0) + 1,
                        });
                    }

                    await supabase.from("builder_sessions")
                        .update({ updated_at: new Date().toISOString() })
                        .eq("id", sessionId);
                } catch (dbErr) {
                    console.error("DB error saving assistant message:", dbErr);
                }
            }
        } catch (err: any) {
            console.error("Build error details:", err);
            const errorMessage = err.message || "An unexpected error occurred.";
            setMessages(prev => [...prev, {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `🚨 ** Build Error:** ${errorMessage} \n\nThe AI architect might be overwhelmed or the connection was lost.Please try a simpler prompt or refresh the page.`,
            }]);
            scrollToBottom();
        } finally {
            // ALWAYS reset building state
            setIsBuilding(false);
        }
    };

    const handleSavePrompt = async () => {
        setIsSavingPrompt(true);
        try {
            const supabase = supabaseRef.current;
            const { error } = await supabase
                .from("builder_sessions")
                .update({ system_prompt: systemPrompt, updated_at: new Date().toISOString() })
                .eq("id", sessionId);

            if (error) throw error;
            setIsPromptModalOpen(false);
        } catch (err) {
            console.error("Error saving prompt:", err);
            // Even if DB save fails (column missing), we'll keep it in state for the session
            setIsPromptModalOpen(false);
        } finally {
            setIsSavingPrompt(false);
        }
    };

    const handleSend = () => {
        if (!input.trim() || isBuilding) return;
        const prompt = input;
        setInput("");
        setCanContinue(false);
        buildApp(prompt, false);
    };

    const handleContinue = () => {
        if (isBuilding) return;
        setCanContinue(false);
        setIsContinuing(true);
        buildApp("Continue generating from where you left off. Do not repeat previous text, just pick up exactly where you ended inside the code or edit block. Ensure your response is compatible with the previous message.", false);
    };

    const handleCopyCode = useCallback(() => {
        if (generatedCode) {
            navigator.clipboard.writeText(generatedCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [generatedCode]);

    const handleDownload = useCallback(() => {
        if (generatedCode) {
            const blob = new Blob([generatedCode], { type: "text/html" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${sessionTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.html`;
            a.click();
            URL.revokeObjectURL(url);
        }
    }, [generatedCode, sessionTitle]);

    const handlePublish = async () => {
        if (!publishSlug.trim() || !generatedCode) {
            setPublishError("Please enter a name for your app.");
            return;
        }
        setIsPublishing(true);
        setPublishError("");

        try {
            const response = await fetch("/api/builder/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    slug: publishSlug.trim().toLowerCase(),
                    htmlContent: getEnhancedCode(generatedCode)
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || "Failed to publish");
            }

            setPublishedUrl(data.url);
        } catch (err: any) {
            setPublishError(err.message);
        } finally {
            setIsPublishing(false);
        }
    };

    if (isLoadingSession) {
        return (
            <div className="flex items-center justify-center h-full gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Loading session...</span>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full bg-background overflow-hidden text-foreground">
            {/* Left Sidebar: Chat */}
            <div className={cn(
                "flex flex-col border-r bg-card/30 backdrop-blur-sm transition-all duration-300 relative z-20",
                isSidebarOpen ? "w-[400px] min-w-[400px]" : "w-0 min-w-0 opacity-0 overflow-hidden"
            )}>
                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b h-14 bg-background/50">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => router.push("/builder")} title="Back to Builder">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-2 font-medium">
                            <Sparkles className="h-4 w-4 text-indigo-400" />
                            <span className="text-sm truncate max-w-[200px]">{sessionTitle}</span>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => router.push("/builder")} title="New App">
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
                    {/* Welcome message */}
                    {messages.length === 0 && !isBuilding && (
                        <div className="flex gap-3">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                                <Bot className="h-4 w-4" />
                            </div>
                            <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm bg-muted/50 text-foreground border rounded-tl-none">
                                Describe the app you want to build. I&apos;ll generate it and show you a live preview.
                            </div>
                        </div>
                    )}

                    {messages.map((msg) => {
                        // Strip code for display, but keep full content in state/API
                        const displayContent = stripCodeBlocks(msg.content);

                        return (
                            <div key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
                                <div className={cn(
                                    "flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center",
                                    msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                )}>
                                    {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                                </div>
                                <div className={cn(
                                    "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
                                    msg.role === "user"
                                        ? "bg-primary text-primary-foreground rounded-tr-none"
                                        : "bg-muted/50 text-foreground border rounded-tl-none"
                                )}>
                                    {displayContent ? (
                                        <div className="whitespace-pre-wrap">{displayContent}</div>
                                    ) : null}
                                    {msg.hasCode && msg.role === "assistant" && (
                                        <div className={cn(
                                            "flex items-center gap-2 text-xs text-emerald-500",
                                            displayContent ? "mt-2 pt-2 border-t border-border/50" : ""
                                        )}>
                                            <Code className="h-3 w-3" />
                                            <span>App updated — see preview →</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {isBuilding && (
                        <div className="flex gap-3">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                                <Bot className="h-4 w-4 animate-pulse" />
                            </div>
                            <div className="bg-muted/30 border rounded-2xl rounded-tl-none px-4 py-3 text-sm flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Building your app...</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t bg-background/50">
                    <form className="relative" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
                        <textarea
                            className="w-full bg-muted/50 border rounded-xl px-4 py-3 pr-12 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500/50 min-h-[50px] max-h-[150px]"
                            placeholder={isBuilding ? "Building..." : "Describe changes or a new feature..."}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            disabled={isBuilding}
                        />
                        <Button
                            type="submit"
                            className="absolute right-2 bottom-2 h-8 w-8 p-0 rounded-lg"
                            size="sm"
                            disabled={!input.trim() || isBuilding}
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                    {canContinue && (
                        <div className="mt-3 flex justify-center animate-in fade-in slide-in-from-top-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-2 text-[11px] font-medium border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10 text-indigo-400 rounded-full px-4 shadow-sm"
                                onClick={handleContinue}
                                disabled={isBuilding}
                            >
                                <RefreshCw className={cn("h-3 w-3", isBuilding && "animate-spin")} />
                                Continue Generating
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Pane */}
            <div className="flex-1 flex flex-col bg-muted/10 relative overflow-hidden">
                {!isSidebarOpen && (
                    <Button
                        variant="ghost" size="icon"
                        className="absolute left-4 top-4 z-50 bg-background/80 backdrop-blur border shadow-sm"
                        onClick={() => setIsSidebarOpen(true)}
                    >
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                )}

                {/* Toolbar */}
                <div className="h-14 border-b bg-background/80 backdrop-blur flex items-center justify-between px-4 z-10">
                    <div className="flex items-center gap-2">
                        {isSidebarOpen && (
                            <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(false)} title="Hide Chat">
                                <Minimize2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                        )}
                        <div className="h-6 w-[1px] bg-border mx-1" />
                        <h2 className="text-sm font-medium">{sessionTitle}</h2>
                        {generatedCode && (
                            <span className="text-xs text-emerald-500 px-2 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">Live</span>
                        )}
                        {isBuilding && (
                            <span className="text-xs text-amber-500 px-2 py-0.5 bg-amber-500/10 rounded-full border border-amber-500/20 flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Building
                            </span>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setIsPromptModalOpen(true)}
                        >
                            <Sparkles className="h-3 w-3" />
                            System Prompt
                        </Button>
                    </div>

                    <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border">
                        <Button
                            variant="ghost" size="sm"
                            className={cn("h-7 px-2 gap-1.5 text-xs", viewMode === "preview" && "bg-background shadow-sm")}
                            onClick={() => setViewMode("preview")}
                        >
                            <Play className="h-3 w-3" />
                            Preview
                        </Button>
                        <Button
                            variant="ghost" size="sm"
                            className={cn("h-7 px-2 gap-1.5 text-xs", viewMode === "code" && "bg-background shadow-sm")}
                            onClick={() => setViewMode("code")}
                        >
                            <Code className="h-3 w-3" />
                            Code
                        </Button>
                        <Button
                            variant="ghost" size="sm"
                            className={cn(
                                "h-7 px-2 gap-1.5 text-xs relative",
                                viewMode === "errors" && "bg-background shadow-sm text-red-500",
                                errors.length > 0 && viewMode !== "errors" && "text-red-400"
                            )}
                            onClick={() => setViewMode("errors")}
                        >
                            <AlertCircle className="h-3 w-3" />
                            Errors
                            {errors.length > 0 && (
                                <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] text-white">
                                    {errors.length}
                                </span>
                            )}
                        </Button>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border mr-2">
                            {(["desktop", "tablet", "mobile"] as const).map((mode) => (
                                <Button key={mode} variant="ghost" size="icon"
                                    className={cn("h-7 w-7", previewMode === mode && "bg-background shadow-sm")}
                                    onClick={() => setPreviewMode(mode)}
                                >
                                    {mode === "desktop" ? <Laptop className="h-3 w-3" /> :
                                        mode === "tablet" ? <Tablet className="h-3 w-3" /> :
                                            <Smartphone className="h-3 w-3" />}
                                </Button>
                            ))}
                        </div>
                        {generatedCode && (
                            <>
                                <Button variant="outline" size="sm" className="h-8 gap-2" onClick={handleCopyCode}>
                                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    {copied ? "Copied" : "Copy"}
                                </Button>
                                <Button variant="outline" size="sm" className="h-8 gap-2" onClick={handleDownload}>
                                    <Download className="h-3 w-3" />
                                    Export
                                </Button>
                                <Button
                                    variant="default"
                                    size="sm"
                                    className="h-8 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 shadow-lg"
                                    onClick={() => {
                                        setPublishSlug(sessionTitle.replace(/[^a-z0-9]/gi, "-").toLowerCase());
                                        setIsPublishDialogOpen(true);
                                        setPublishedUrl(null);
                                        setPublishError("");
                                    }}
                                >
                                    <Globe className="h-3 w-3" />
                                    Publish
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 relative overflow-auto p-4 md:p-8 flex items-start justify-center">
                    {/* Background Pattern Layer */}
                    <div className="absolute inset-0 bg-dots-pattern pointer-events-none" />

                    <div className={cn(
                        "bg-background border shadow-2xl transition-all duration-300 flex flex-col overflow-hidden relative z-10",
                        previewMode === "desktop" ? "w-full max-w-5xl h-full rounded-xl" : "",
                        previewMode === "tablet" ? "w-[768px] h-[1024px] max-h-full rounded-[2rem] border-[8px] border-muted-foreground/10" : "",
                        previewMode === "mobile" ? "w-[375px] h-[812px] max-h-full rounded-[2.5rem] border-[8px] border-muted-foreground/10" : ""
                    )}>
                        {viewMode === "preview" ? (
                            generatedCode ? (
                                <iframe
                                    ref={iframeRef}
                                    srcDoc={getEnhancedCode(generatedCode)}
                                    className="w-full h-full border-0 bg-white" // Force solid background
                                    sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
                                    title="App Preview"
                                />
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
                                    <div className="h-16 w-16 bg-gradient-to-br from-indigo-500/20 to-purple-600/20 rounded-2xl flex items-center justify-center mb-2">
                                        <Wand2 className="h-8 w-8 text-indigo-400" />
                                    </div>
                                    <h3 className="text-xl font-semibold">Your App Canvas</h3>
                                    <p className="text-muted-foreground max-w-md">
                                        {isBuilding
                                            ? "Building your app... the preview will appear here momentarily."
                                            : "Use the chat to describe the app you want. I'll generate it and show a live preview here."}
                                    </p>
                                    {isBuilding && (
                                        <Loader2 className="h-8 w-8 animate-spin text-indigo-400 mt-4" />
                                    )}
                                </div>
                            )
                        ) : viewMode === "code" ? (
                            <div className="h-full w-full overflow-auto bg-[#1e1e2e] relative">
                                <div className="sticky top-0 flex items-center justify-between px-4 py-2 bg-[#1e1e2e]/90 backdrop-blur border-b border-white/5 z-10">
                                    <span className="text-xs text-zinc-500 font-mono">app.html</span>
                                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-zinc-400 hover:text-white" onClick={handleCopyCode}>
                                        {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                                        {copied ? "Copied" : "Copy"}
                                    </Button>
                                </div>
                                <pre className="p-4 font-mono text-sm text-zinc-50 whitespace-pre-wrap leading-relaxed">
                                    {generatedCode || "// No code generated yet.\n// Describe your app in the chat to get started."}
                                </pre>
                            </div>
                        ) : (
                            <div className="h-full w-full overflow-auto bg-background p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-semibold flex items-center gap-2">
                                        <AlertCircle className="h-5 w-5 text-red-500" />
                                        Runtime Console
                                    </h3>
                                    {errors.length > 0 && (
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => {
                                                const errorLog = errors.map(e => `[${e.type}] ${e.message} `).join('\n');
                                                setInput(`I am getting the following errors in the app.Please fix them: \n\n${errorLog} `);
                                                setIsSidebarOpen(true);
                                            }}
                                        >
                                            Fix Errors with AI
                                        </Button>
                                    )}
                                </div>

                                {errors.length > 0 ? (
                                    <div className="space-y-3">
                                        {errors.map((error, idx) => (
                                            <div key={idx} className="p-4 rounded-lg bg-red-500/5 border border-red-500/20 font-mono text-xs">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-red-500 font-bold">{error.type}</span>
                                                    <span className="text-muted-foreground">{new Date(error.timestamp).toLocaleTimeString()}</span>
                                                </div>
                                                <div className="text-foreground break-words">{error.message}</div>
                                                {error.stack && (
                                                    <pre className="mt-2 p-2 bg-black/20 rounded overflow-x-auto text-muted-foreground scale-95 origin-left">
                                                        {error.stack}
                                                    </pre>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-[60%] text-muted-foreground italic">
                                        No runtime errors detected.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Publish Dialog */}
            {isPublishDialogOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-card border shadow-2xl rounded-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                                    <Globe className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold">Publish Your App</h3>
                                    <p className="text-sm text-muted-foreground">Make your app accessible via a public link.</p>
                                </div>
                            </div>

                            {!publishedUrl ? (
                                <div className="space-y-4 pt-2">
                                    <div className="space-y-2">
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Choose a name (URL slug)</label>
                                        <div className="flex items-center gap-2 bg-muted/50 border rounded-lg px-3 py-2 focus-within:ring-1 focus-within:ring-indigo-500 transition-all">
                                            <span className="text-muted-foreground/50 text-sm select-none">/</span>
                                            <input
                                                autoFocus
                                                type="text"
                                                className="bg-transparent border-none outline-none text-sm flex-1 font-mono"
                                                placeholder="my-cool-app"
                                                value={publishSlug}
                                                onChange={(e) => setPublishSlug(e.target.value.replace(/[^a-z0-9-]/gi, "-").toLowerCase())}
                                                onKeyDown={(e) => e.key === "Enter" && handlePublish()}
                                            />
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">Only lowercase letters, numbers, and dashes allowed.</p>
                                    </div>

                                    {publishError && (
                                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs flex items-center gap-2">
                                            <AlertCircle className="h-3 w-3" />
                                            {publishError}
                                        </div>
                                    )}

                                    <div className="flex gap-3 pt-2">
                                        <Button variant="ghost" className="flex-1" onClick={() => setIsPublishDialogOpen(false)} disabled={isPublishing}>
                                            Cancel
                                        </Button>
                                        <Button
                                            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
                                            onClick={handlePublish}
                                            disabled={isPublishing || !publishSlug.trim()}
                                        >
                                            {isPublishing ? (
                                                <>
                                                    <Loader2 className="h-3 w-3 animate-spin mr-2" />
                                                    Publishing...
                                                </>
                                            ) : "Publish Now"}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-6 pt-2 text-center py-4">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500 mb-2">
                                            <Check className="h-6 w-6" />
                                        </div>
                                        <h4 className="font-medium text-lg text-foreground">Successfully Published!</h4>
                                        <p className="text-sm text-muted-foreground">Your app is now live at the link below:</p>
                                    </div>

                                    <div className="bg-muted/50 border rounded-xl p-4 flex items-center justify-between gap-4">
                                        <span className="text-sm font-mono truncate text-indigo-400">{window.location.origin}{publishedUrl}</span>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => {
                                            navigator.clipboard.writeText(`${window.location.origin}${publishedUrl} `);
                                        }}>
                                            <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>

                                    <div className="flex gap-3">
                                        <Button variant="outline" className="flex-1" onClick={() => setIsPublishDialogOpen(false)}>
                                            Done
                                        </Button>
                                        <Button
                                            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
                                            onClick={() => window.open(publishedUrl, "_blank")}
                                        >
                                            Visit App <ExternalLink className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* System Prompt Modal */}
            {isPromptModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-card border shadow-2xl rounded-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                                        <Sparkles className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold">Custom System Prompt</h3>
                                        <p className="text-sm text-muted-foreground">Override the default instructions for the AI builder.</p>
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => setIsPromptModalOpen(false)}>
                                    <MoreHorizontal className="h-4 w-4 rotate-45" />
                                </Button>
                            </div>

                            <div className="space-y-2">
                                <textarea
                                    className="w-full h-[300px] bg-muted/50 border rounded-xl px-4 py-3 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                                    placeholder="Enter custom system instructions here... (Leave empty to use default)"
                                    value={systemPrompt}
                                    onChange={(e) => setSystemPrompt(e.target.value)}
                                />
                                <p className="text-[11px] text-muted-foreground italic">
                                    Note: If left empty, the architect uses its default system prompt for building vanilla JS/HTML apps.
                                </p>
                            </div>

                            <div className="flex justify-between items-center pt-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSystemPrompt(DEFAULT_BUILDER_SYSTEM_PROMPT)}
                                    className="text-xs"
                                >
                                    Load Default Prompt
                                </Button>
                                <div className="flex gap-3">
                                    <Button variant="ghost" onClick={() => setIsPromptModalOpen(false)}>
                                        Cancel
                                    </Button>
                                    <Button
                                        className="bg-primary text-primary-foreground min-w-[120px]"
                                        onClick={handleSavePrompt}
                                        disabled={isSavingPrompt}
                                    >
                                        {isSavingPrompt ? (
                                            <>
                                                <Loader2 className="h-3 w-3 animate-spin mr-2" />
                                                Saving...
                                            </>
                                        ) : "Save Prompt"}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Wrap in Suspense for useSearchParams
export function AppBuilderWorkspace({ sessionId }: AppBuilderWorkspaceProps) {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center h-full gap-3 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Loading...</span>
            </div>
        }>
            <AppBuilderWorkspaceInner sessionId={sessionId} />
        </Suspense>
    );
}
