"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

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
    Share,
    Download,
    Copy,
    Check
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

// Helper to extract text content from message parts (without code blocks)
function getMessageTextOnly(msg: any): string {
    const fullText = getFullText(msg);
    // Strip code blocks from the chat display
    return fullText.replace(/```[\s\S]*?```/g, "").trim();
}

// Helper to extract full text including code
function getFullText(msg: any): string {
    if (msg.parts && Array.isArray(msg.parts)) {
        return msg.parts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("");
    }
    if (typeof msg.content === "string") {
        return msg.content;
    }
    return "";
}

// Helper to extract HTML code from message
function extractHtmlCode(text: string): string {
    const match = text.match(/```html([\s\S]*?)```/);
    if (match) return match[1].trim();
    // Fallback: try tsx/jsx blocks too
    const tsxMatch = text.match(/```(?:tsx?|jsx?)([\s\S]*?)```/);
    if (tsxMatch) return tsxMatch[1].trim();
    return "";
}

export function AppBuilderInterface() {
    const { messages, sendMessage, setMessages, status } = useChat({
        transport: new DefaultChatTransport({
            api: "/api/builder",
        }),
    });

    // Local state
    const [input, setInput] = useState("");
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const isLoading = status === "streaming" || status === "submitted";

    // Set initial greeting on mount
    useEffect(() => {
        setMessages([
            {
                id: "welcome-1",
                role: "assistant",
                parts: [{ type: "text" as const, text: "Hi! I'm your App Architect. Describe the tool or app you want — I'll build it for you instantly." }],
            } as any
        ]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [previewMode, setPreviewMode] = useState<"desktop" | "tablet" | "mobile">("desktop");
    const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const scrollRef = useRef<HTMLDivElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Auto-scroll on new messages
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, status]);

    // Extract generated code from ALL assistant messages (use latest one)
    const generatedCode = (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "assistant") {
                const text = getFullText(msg);
                const code = extractHtmlCode(text);
                if (code) return code;
            }
        }
        return "";
    })();

    // Auto-switch to preview when code is generated
    useEffect(() => {
        if (generatedCode && !isLoading) {
            setViewMode("preview");
        }
    }, [generatedCode, isLoading]);

    const handleSend = () => {
        if (!input.trim() || isLoading) return;
        sendMessage({ text: input });
        setInput("");
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
            a.download = "app.html";
            a.click();
            URL.revokeObjectURL(url);
        }
    }, [generatedCode]);

    return (
        <div className="flex h-full w-full bg-background overflow-hidden text-foreground">
            {/* Left Sidebar: Chat Interface */}
            <div className={cn(
                "flex flex-col border-r bg-card/30 backdrop-blur-sm transition-all duration-300 relative z-20",
                isSidebarOpen ? "w-[400px]" : "w-0 opacity-0 overflow-hidden"
            )}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b h-14 bg-background/50">
                    <div className="flex items-center gap-2 font-medium">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span>App Architect</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => {
                        setMessages([]);
                        setSessionId(null);
                        setMessages([
                            {
                                id: "welcome-1",
                                role: "assistant",
                                parts: [{ type: "text" as const, text: "Hi! I'm your App Architect. Describe the tool or app you want — I'll build it for you instantly." }],
                            } as any
                        ]);
                    }} title="New Session">
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
                    {messages.map((msg) => {
                        const text = msg.role === "assistant"
                            ? getMessageTextOnly(msg)
                            : getFullText(msg);

                        // Don't render empty assistant messages (code-only responses)
                        if (!text && msg.role === "assistant") {
                            // Check if there IS code in this message
                            const fullText = getFullText(msg);
                            const hasCode = extractHtmlCode(fullText);
                            if (hasCode) {
                                return (
                                    <div key={msg.id} className="flex gap-3">
                                        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                                            <Bot className="h-4 w-4" />
                                        </div>
                                        <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm bg-muted/50 text-foreground border rounded-tl-none">
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <Code className="h-3.5 w-3.5" />
                                                <span>App generated — see preview →</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        }

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
                                    <div className="whitespace-pre-wrap">{text}</div>
                                </div>
                            </div>
                        );
                    })}
                    {isLoading && (
                        <div className="flex gap-3">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center animate-pulse">
                                <Bot className="h-4 w-4" />
                            </div>
                            <div className="bg-muted/30 border rounded-2xl rounded-tl-none px-4 py-3 text-sm flex items-center gap-2 text-muted-foreground">
                                <Sparkles className="h-3 w-3 animate-spin" />
                                <span>Building your app...</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Input Area */}
                <div className="p-4 border-t bg-background/50">
                    <form
                        className="relative"
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleSend();
                        }}
                    >
                        <textarea
                            className="w-full bg-muted/50 border rounded-xl px-4 py-3 pr-12 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[50px] max-h-[150px]"
                            placeholder="Describe the app you want to build..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                        />
                        <Button
                            type="submit"
                            className="absolute right-2 bottom-2 h-8 w-8 p-0 rounded-lg"
                            size="sm"
                            disabled={!input.trim() || isLoading}
                        >
                            <Send className="h-4 w-4" />
                        </Button>
                    </form>
                </div>
            </div>

            {/* Right Pane: Preview / Canvas */}
            <div className="flex-1 flex flex-col bg-muted/10 relative overflow-hidden">
                {/* Expand sidebar button */}
                {!isSidebarOpen && (
                    <Button
                        variant="ghost"
                        size="icon"
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
                        <h2 className="text-sm font-medium">App Preview</h2>
                        {generatedCode && (
                            <span className="text-xs text-emerald-500 px-2 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20">Live</span>
                        )}
                    </div>

                    <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-7 px-2 gap-1.5 text-xs", viewMode === "preview" && "bg-background shadow-sm")}
                            onClick={() => setViewMode("preview")}
                        >
                            <Play className="h-3 w-3" />
                            Preview
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-7 px-2 gap-1.5 text-xs", viewMode === "code" && "bg-background shadow-sm")}
                            onClick={() => setViewMode("code")}
                        >
                            <Code className="h-3 w-3" />
                            Code
                        </Button>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border mr-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn("h-7 w-7", previewMode === "desktop" && "bg-background shadow-sm")}
                                onClick={() => setPreviewMode("desktop")}
                            >
                                <Laptop className="h-3 w-3" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn("h-7 w-7", previewMode === "tablet" && "bg-background shadow-sm")}
                                onClick={() => setPreviewMode("tablet")}
                            >
                                <Tablet className="h-3 w-3" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn("h-7 w-7", previewMode === "mobile" && "bg-background shadow-sm")}
                                onClick={() => setPreviewMode("mobile")}
                            >
                                <Smartphone className="h-3 w-3" />
                            </Button>
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
                            </>
                        )}
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 relative bg-dots-pattern overflow-auto p-4 md:p-8 flex items-start justify-center">
                    <div className={cn(
                        "bg-background border shadow-2xl transition-all duration-300 flex flex-col overflow-hidden relative",
                        previewMode === "desktop" ? "w-full max-w-5xl h-full rounded-xl" : "",
                        previewMode === "tablet" ? "w-[768px] h-[1024px] max-h-full rounded-[2rem] border-[8px] border-muted-foreground/10" : "",
                        previewMode === "mobile" ? "w-[375px] h-[812px] max-h-full rounded-[2.5rem] border-[8px] border-muted-foreground/10" : ""
                    )}>
                        {viewMode === "preview" ? (
                            generatedCode ? (
                                <iframe
                                    ref={iframeRef}
                                    srcDoc={generatedCode}
                                    className="w-full h-full border-0"
                                    sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"
                                    title="App Preview"
                                />
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
                                    <div className="h-16 w-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mb-2">
                                        <Wand2 className="h-8 w-8 text-primary" />
                                    </div>
                                    <h3 className="text-xl font-semibold">Your App Canvas</h3>
                                    <p className="text-muted-foreground max-w-md">
                                        Use the chat to describe the app you want.
                                        I&apos;ll generate it and show a live preview here.
                                    </p>
                                    <div className="flex gap-2 mt-4">
                                        <Button variant="outline" size="sm" onClick={() => setInput("Build a CRM dashboard with charts")}>
                                            CRM Dashboard
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => setInput("Build a file upload tool that reads Excel sheets")}>
                                            Excel Uploader
                                        </Button>
                                    </div>
                                </div>
                            )
                        ) : (
                            <div className="h-full w-full overflow-auto bg-[#1e1e2e] relative">
                                {/* Code toolbar */}
                                <div className="sticky top-0 flex items-center justify-between px-4 py-2 bg-[#1e1e2e]/90 backdrop-blur border-b border-white/5 z-10">
                                    <span className="text-xs text-zinc-500 font-mono">app.html</span>
                                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-zinc-400 hover:text-white" onClick={handleCopyCode}>
                                        {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                                        {copied ? "Copied" : "Copy"}
                                    </Button>
                                </div>
                                <pre className="p-4 font-mono text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                                    {generatedCode || "// No code generated yet. Describe your app in the chat..."}
                                </pre>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
