"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Sparkles, Plus, ArrowRight, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function BuilderLandingPage() {
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);
    const [prompt, setPrompt] = useState("");

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

            {/* Or create blank */}
            <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleCreateApp()}
                disabled={isCreating}
            >
                <Plus className="h-4 w-4" />
                {isCreating ? "Creating..." : "Start with blank canvas"}
            </Button>
        </div>
    );
}
