"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "ai/react";
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
    Download
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface AppConfig {
    name: string;
    description: string;
    theme: "light" | "dark" | "system";
    layout: "default" | "dashboard" | "fullscreen";
}

export function AppBuilderInterface() {
    const { messages, input, handleInputChange, handleSubmit, isLoading, setInput, setMessages } = useChat({
        api: "/api/builder",
        initialMessages: [
            {
                id: "1",
                role: "assistant",
                content: "Hi! I'm your App Architect. Describe the tool or application you want to build, and I'll generate it for you.",
            }
        ]
    });

    const [previewMode, setPreviewMode] = useState<"desktop" | "tablet" | "mobile">("desktop");
    const [viewMode, setViewMode] = useState<"preview" | "code">("preview");
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Placeholder for generated app state
    const [appConfig, setAppConfig] = useState<AppConfig>({
        name: "Untitled App",
        description: "A custom AI tool",
        theme: "light",
        layout: "default"
    });

    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll on new messages
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isLoading]);

    // Extract generated code from the last assistant message
    const generatedCode = (() => {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage?.role === "assistant") {
            const codeBlock = lastMessage.content.match(/```tsx?([\s\S]*?)```/);
            if (codeBlock) return codeBlock[1].trim();
        }
        return "";
    })();

    // Update view mode if code is generated
    useEffect(() => {
        if (generatedCode && !isLoading) {
            setViewMode("code");
        }
    }, [generatedCode, isLoading]);

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
                    <Button variant="ghost" size="icon" onClick={() => setMessages([])} title="New Session">
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6" ref={scrollRef}>
                    {messages.map((msg) => (
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
                                <div className="whitespace-pre-wrap">{msg.content}</div>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex gap-3">
                            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center animate-pulse">
                                <Bot className="h-4 w-4" />
                            </div>
                            <div className="bg-muted/30 border rounded-2xl rounded-tl-none px-4 py-3 text-sm flex items-center gap-2 text-muted-foreground">
                                <Sparkles className="h-3 w-3 animate-spin" />
                                <span>Thinking...</span>
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
                            if (!input.trim() || isLoading) return;
                            handleSubmit(e);
                        }}
                    >
                        <textarea
                            className="w-full bg-muted/50 border rounded-xl px-4 py-3 pr-12 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary min-h-[50px] max-h-[150px]"
                            placeholder="Describe the app you want to build..."
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    if (!input.trim() || isLoading) return;
                                    handleSubmit(e as any);
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
                {/* Expand sidebar button (visible only when closed) */}
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
                        <h2 className="text-sm font-medium">{appConfig.name}</h2>
                        <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded-full">v0.1</span>
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
                        <Button variant="outline" size="sm" className="h-8 gap-2">
                            <Download className="h-3 w-3" />
                            Export
                        </Button>
                        <Button size="sm" className="h-8 gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white border-0">
                            <Share className="h-3 w-3" />
                            Deploy
                        </Button>
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

                        {/* Mock App Header */}
                        <div className="h-12 border-b flex items-center justify-between px-4 bg-background z-10">
                            <div className="font-semibold">{appConfig.name}</div>
                            <div className="flex gap-2">
                                <div className="h-2 w-2 rounded-full bg-red-400" />
                                <div className="h-2 w-2 rounded-full bg-yellow-400" />
                                <div className="h-2 w-2 rounded-full bg-green-400" />
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-auto bg-muted/5 relative">
                            {viewMode === "preview" ? (
                                <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
                                    <div className="h-16 w-16 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center mb-2">
                                        <Wand2 className="h-8 w-8 text-primary" />
                                    </div>
                                    <h3 className="text-xl font-semibold">Your App Canvas</h3>
                                    <p className="text-muted-foreground max-w-md">
                                        Use the chat on the left to describe your app.
                                        Example: "Build a lead scoring dashboard with a chart and a table."
                                    </p>
                                    <Button variant="outline" className="mt-4" onClick={() => {
                                        setInput("Build a CRM dashboard");
                                    }}>
                                        Try Example
                                    </Button>

                                    {generatedCode && (
                                        <div className="mt-8 p-4 bg-yellow-500/10 text-yellow-600 rounded-lg text-sm border border-yellow-500/20">
                                            Code generated! Switch to "Code" view to see it.
                                            <br />(Auto-preview requires a runtime environment)
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="h-full w-full overflow-auto p-4 font-mono text-sm">
                                    <pre className="text-muted-foreground whitespace-pre-wrap">
                                        {generatedCode || "// No code generated yet. Waiting for prompt..."}
                                    </pre>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
