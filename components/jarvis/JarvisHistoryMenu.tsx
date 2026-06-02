"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History, MessageSquare, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
    getJarvisHistory,
    removeJarvisChat,
    type JarvisChatEntry,
} from "@/lib/jarvis/history";

export function JarvisHistoryMenu({ userId }: { userId: string | null }) {
    const router = useRouter();
    const [items, setItems] = useState<JarvisChatEntry[]>([]);

    const refresh = () => {
        if (userId) setItems(getJarvisHistory(userId));
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
                {items.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                        No Jarvis chats yet.
                    </div>
                ) : (
                    items.map((c) => (
                        <DropdownMenuItem
                            key={c.id}
                            className="group/item gap-2"
                            onClick={() => router.push(`/analysis/jarvis?chat=${c.id}`)}
                        >
                            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm">{c.title || "Untitled chat"}</div>
                                <div className="text-[10px] text-muted-foreground/60">
                                    {formatDistanceToNow(new Date(c.ts))} ago
                                </div>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (userId) {
                                        removeJarvisChat(userId, c.id);
                                        refresh();
                                    }
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
