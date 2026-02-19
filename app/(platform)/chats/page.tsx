"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Search, Plus, MessageSquare, Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface Chat {
    id: string;
    title: string;
    created_at: string;
    project_id: string | null;
}

export default function ChatsHistoryPage() {
    const router = useRouter();
    const supabase = createClient();
    const [chats, setChats] = useState<Chat[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        const fetchChats = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase
                .from("chats")
                .select("id, title, created_at, project_id")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false });

            if (!error && data) {
                // Filter out agent-generated chats same as sidebar
                const filtered = data.filter(c =>
                    !c.title?.startsWith("\u200B") &&
                    !c.title?.startsWith("Look up Salesforce Opportu")
                );
                setChats(filtered);
            }
            setLoading(false);
        };

        fetchChats();
    }, []);

    const filteredChats = chats.filter(chat =>
        (chat.title || "New Chat").toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleNewChat = () => {
        router.push("/chat");
    };

    const getChatHref = (chat: Chat) => {
        if (chat.project_id) {
            return `/projects/${chat.project_id}/chat/${chat.id}`;
        }
        return `/chat/${chat.id}`;
    };

    return (
        <div className="max-w-4xl mx-auto px-4 py-8 h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-medium text-foreground">Chats</h1>
                <Button onClick={handleNewChat} className="bg-white text-black hover:bg-white/90 gap-2 font-normal rounded-lg px-4 border shadow-sm">
                    <Plus className="h-4 w-4" />
                    New chat
                </Button>
            </div>

            {/* Search */}
            <div className="relative mb-6">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-muted-foreground/50" />
                </div>
                <input
                    type="text"
                    placeholder="Search your chats..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-accent/10 border border-border/20 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/30"
                />
            </div>

            {/* Stats */}
            <div className="text-sm text-muted-foreground/60 mb-6 flex items-center gap-2">
                {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                    <span>{filteredChats.length} chats. <button className="text-primary hover:underline ml-1">Select</button></span>
                )}
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto space-y-px border rounded-xl bg-card/30 backdrop-blur-sm divide-y divide-border/20">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin mb-4 opacity-20" />
                        <p className="text-sm">Loading your history...</p>
                    </div>
                ) : filteredChats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <MessageSquare className="h-12 w-12 mb-4 opacity-5" />
                        <p className="text-sm">{searchQuery ? "No chats match your search" : "No chats yet"}</p>
                    </div>
                ) : (
                    filteredChats.map((chat) => (
                        <div key={chat.id} className="group relative">
                            <button
                                onClick={() => router.push(getChatHref(chat))}
                                className="w-full text-left p-5 hover:bg-accent/20 transition-colors flex items-center justify-between group"
                            >
                                <div className="min-w-0 pr-10">
                                    <h3 className="text-lg font-medium text-foreground truncate group-hover:text-primary transition-colors mb-1">
                                        {chat.title || "Untitled"}
                                    </h3>
                                    <p className="text-xs text-muted-foreground/60">
                                        Last message {formatDistanceToNow(new Date(chat.created_at))} ago
                                    </p>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-background rounded-lg transition-all text-muted-foreground/40 hover:text-foreground"
                                >
                                    <MoreHorizontal className="h-4 w-4" />
                                </button>
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
