"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Sparkles, Plus, ArrowRight, Wand2, Clock, Trash2, LayoutGrid, AppWindow, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDistanceToNow } from "date-fns";

export default function BuilderLandingPage() {
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [sessions, setSessions] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchSessions = async () => {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase
                .from("builder_sessions")
                .select("*")
                .eq("user_id", user.id)
                .order("updated_at", { ascending: false });

            if (data) setSessions(data);
            setIsLoading(false);
        };

        fetchSessions();
    }, []);

    const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        if (!confirm("Are you sure you want to delete this app?")) return;

        const supabase = createClient();
        const { error } = await supabase
            .from("builder_sessions")
            .delete()
            .eq("id", id);

        if (!error) {
            setSessions(prev => prev.filter(s => s.id !== id));
        }
    };

    const handleCreateApp = async (initialPrompt?: string) => {
        setIsCreating(true);
        try {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/login");
                return;
            }

            const title = initialPrompt
                ? initialPrompt.slice(0, 60) + (initialPrompt.length > 60 ? "..." : "")
                : "Untitled App";

            const { data: session, error } = await supabase
                .from("builder_sessions")
                .insert({ user_id: user.id, title })
                .select("id")
                .single();

            if (error || !session) {
                console.error("Failed to create session:", error);
                setIsCreating(false);
                return;
            }

            // If there's an initial prompt, save it as the first message
            if (initialPrompt?.trim()) {
                await supabase.from("builder_messages").insert({
                    session_id: session.id,
                    role: "user",
                    content: initialPrompt.trim(),
                });
            }

            router.push(`/builder/app/${session.id}${initialPrompt ? "?autorun=1" : ""}`);
        } catch (err) {
            console.error(err);
            setIsCreating(false);
        }
    };

    const examples = [
        "Build a file upload tool that reads Excel and shows data in a table",
        "Create a lead scoring dashboard with charts",
        "Build a batch processor that sends data to an AI agent",
    ];

    return (
        <div className="flex flex-col items-center justify-center h-full p-8 gap-8">
            {/* Hero */}
            <div className="flex flex-col items-center gap-4 text-center max-w-xl">
                <div className="h-16 w-16 bg-gradient-to-br from-indigo-500/20 to-purple-600/20 rounded-2xl flex items-center justify-center border border-indigo-500/10">
                    <Wand2 className="h-8 w-8 text-indigo-400" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight">App Builder</h1>
                <p className="text-muted-foreground text-lg">
                    Describe the tool you want and I&apos;ll build it for you instantly.
                </p>
            </div>

            {/* Prompt Input */}
            <div className="w-full max-w-xl">
                <form onSubmit={(e) => { e.preventDefault(); handleCreateApp(prompt); }} className="relative">
                    <textarea
                        className="w-full bg-muted/50 border rounded-2xl px-5 py-4 pr-14 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 min-h-[80px] max-h-[160px]"
                        placeholder="Describe the app you want to build..."
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleCreateApp(prompt);
                            }
                        }}
                        disabled={isCreating}
                    />
                    <Button
                        type="submit"
                        className="absolute right-3 bottom-3 h-9 w-9 p-0 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white border-0"
                        size="sm"
                        disabled={!prompt.trim() || isCreating}
                    >
                        <ArrowRight className="h-4 w-4" />
                    </Button>
                </form>
            </div>

            {/* Examples */}
            <div className="flex flex-wrap gap-2 justify-center max-w-xl">
                {examples.map((example, i) => (
                    <button
                        key={i}
                        className="px-3 py-1.5 rounded-full border text-xs text-muted-foreground hover:text-foreground hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-colors"
                        onClick={() => setPrompt(example)}
                        disabled={isCreating}
                    >
                        {example}
                    </button>
                ))}
            </div>

            {/* Recent Apps */}
            <div className="w-full max-w-4xl mt-12 pb-20">
                <div className="flex items-center justify-between mb-6 px-4">
                    <div className="flex items-center gap-2">
                        <LayoutGrid className="h-5 w-5 text-indigo-400" />
                        <h2 className="text-xl font-semibold">Your Apps</h2>
                    </div>
                </div>

                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-32 rounded-2xl bg-muted/30 animate-pulse border border-border/50" />
                        ))}
                    </div>
                ) : sessions.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
                        {sessions.map((session) => (
                            <div
                                key={session.id}
                                onClick={() => router.push(`/builder/app/${session.id}`)}
                                className="group relative flex flex-col p-5 rounded-2xl bg-card border border-border/50 hover:border-indigo-500/50 hover:bg-indigo-500/[0.02] transition-all cursor-pointer shadow-sm hover:shadow-md"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                                        <AppWindow className="h-5 w-5" />
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => handleDeleteSession(e, session.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                                <h3 className="font-medium text-sm line-clamp-2 mb-4 group-hover:text-indigo-400 transition-colors">
                                    {session.title || "Untitled App"}
                                </h3>
                                <div className="mt-auto flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest font-mono">
                                    <Clock className="h-3 w-3" />
                                    <span>{formatDistanceToNow(new Date(session.updated_at), { addSuffix: true })}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 border-2 border-dashed rounded-3xl border-border/50 mx-4">
                        <div className="bg-muted/50 h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-4 text-muted-foreground/30">
                            <Plus className="h-6 w-6" />
                        </div>
                        <p className="text-muted-foreground text-sm">No apps created yet. Describe something above to get started!</p>
                    </div>
                )}
            </div>
        </div>
    );
}
