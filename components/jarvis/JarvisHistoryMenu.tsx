"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History, MessageSquare, Trash2, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import {
    listJarvisChats,
    removeJarvisChat,
    type JarvisChatEntry,
} from "@/lib/jarvis/history";

// Reads/deletes are RLS-scoped to the current user, so no userId prop needed.
export function JarvisHistoryMenu() {
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);
    const [items, setItems] = useState<JarvisChatEntry[]>([]);
    const [loading, setLoading] = useState(false);

    const refresh = async () => {
        setLoading(true);
        try {
            setItems(await listJarvisChats(supabase));
        } finally {
            setLoading(false);
        }
    };

    return (
        <DropdownMenu onOpenChange={(o) => o && refresh()}>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                    <History className="h-4 w-4" />
                    History
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 max-h-96 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading…
                    </div>
                ) : items.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                        No Jarvis chats yet.
                    </div>
                ) : (
                    items.map((c) => (
                        <DropdownMenuItem
                            key={c.id}
                            className="group/item gap-2"
                            onClick={() => router.push(`/analysis/jarvis/${c.id}`)}
                        >
                            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm">{c.title || "Untitled chat"}</div>
                                <div className="text-[10px] text-muted-foreground/60">
                                    {formatDistanceToNow(new Date(c.created_at))} ago
                                </div>
                            </div>
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    await removeJarvisChat(supabase, c.id);
                                    refresh();
                                }}
                                className="opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                                title="Remove from history"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </DropdownMenuItem>
                    ))
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
