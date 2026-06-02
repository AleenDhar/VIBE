"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ChevronLeft, Sparkles, MessageSquare, Settings2, SquarePen } from "lucide-react";
import { cn, uuid } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getActiveModels, getUserAllowedModels } from "@/lib/actions/models";
import * as jarvis from "@/lib/jarvis/api";
import type { ModelOption } from "@/lib/analysis/types";
import { JarvisChat } from "./JarvisChat";
import { JarvisSettings } from "./JarvisSettings";
import { JarvisHistoryMenu } from "./JarvisHistoryMenu";

const PREFERRED_DEFAULT_MODEL = "anthropic:claude-sonnet-4-6";

type Tab = "chat" | "settings";

export function JarvisWorkspace() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const urlChat = searchParams.get("chat") || undefined;

    const [tab, setTab] = useState<Tab>("chat");
    const [models, setModels] = useState<ModelOption[]>([]);
    const [defaultModel, setDefaultModel] = useState<string | null>(null);
    const [enabledCount, setEnabledCount] = useState(0);
    const [userId, setUserId] = useState<string | null>(null);

    // A locally-generated id for brand-new conversations. The active chat is the
    // ?chat= param when present (resume from history), else this.
    const [localChatId, setLocalChatId] = useState<string>(() => uuid());
    const chatId = urlChat ?? localChatId;

    // Initial message handed off from the landing hero (read once).
    const [initialMessage, setInitialMessage] = useState<string | undefined>(() => {
        if (typeof window === "undefined") return undefined;
        try {
            const m = sessionStorage.getItem("jarvis:initial");
            if (m) {
                sessionStorage.removeItem("jarvis:initial");
                return m;
            }
        } catch {
            /* ignore */
        }
        return undefined;
    });

    const newChat = () => {
        setInitialMessage(undefined);
        setLocalChatId(uuid());
        if (urlChat) router.replace("/analysis/jarvis");
        setTab("chat");
    };

    // Models + current user.
    useEffect(() => {
        const supabase = createClient();
        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                setUserId(user?.id ?? null);
                const [m, allowed] = await Promise.all([
                    getActiveModels(),
                    user ? getUserAllowedModels(user.id) : Promise.resolve<string[]>([]),
                ]);
                const opts: ModelOption[] = m
                    .filter((x) => x.is_available_to_all || allowed.includes(x.id))
                    .map((x) => ({ id: x.id, label: x.name, name: x.name, provider: x.provider }));
                setModels(opts);
                setDefaultModel(opts.find((o) => o.id === PREFERRED_DEFAULT_MODEL)?.id ?? opts[0]?.id ?? null);
            } catch {
                /* free-text fallback */
            }
        })();
    }, []);

    // Enabled-analyses count for the chat's empty-state hint.
    useEffect(() => {
        jarvis
            .getJarvisSettings()
            .then((s) => setEnabledCount((s.enabled_analysis_ids ?? []).length))
            .catch(() => {});
    }, []);

    return (
        <div className="flex flex-col h-full w-full">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
                        <Link href="/analysis" aria-label="Back to analyses">
                            <ChevronLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
                    <div className="font-medium text-foreground truncate">Jarvis</div>
                    <span className="hidden lg:inline text-[11px] text-muted-foreground">
                        · cross-analysis assistant
                    </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <JarvisHistoryMenu userId={userId} />
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={newChat}>
                        <SquarePen className="h-4 w-4" />
                        New chat
                    </Button>
                    <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
                        <button
                            onClick={() => setTab("chat")}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                tab === "chat"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <MessageSquare className="h-3.5 w-3.5" />
                            Chat
                        </button>
                        <button
                            onClick={() => setTab("settings")}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                tab === "settings"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Settings2 className="h-3.5 w-3.5" />
                            Settings
                        </button>
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0">
                <div className={cn("h-full", tab === "chat" ? "block" : "hidden")}>
                    <JarvisChat
                        key={chatId}
                        chatId={chatId}
                        userId={userId}
                        models={models}
                        defaultModel={defaultModel}
                        enabledCount={enabledCount}
                        initialMessage={initialMessage}
                        onOpenSettings={() => setTab("settings")}
                    />
                </div>
                {tab === "settings" && (
                    <div className="h-full overflow-y-auto">
                        <JarvisSettings onChange={setEnabledCount} />
                    </div>
                )}
            </div>
        </div>
    );
}
