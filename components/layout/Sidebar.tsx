"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
    Plus,
    MessageSquare,
    FolderOpen,
    Users,
    ShieldCheck,
    PanelLeftClose,
    PanelLeftOpen,
    Loader2,
    MoreHorizontal,
    LogOut,
    Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { ModeToggle } from "@/components/ModeToggle";
import { createClient } from "@/lib/supabase/client";

const menuItems = [
    { name: "Chats", href: "/chat", icon: MessageSquare },
    { name: "Projects", href: "/projects", icon: FolderOpen },
    // { name: "App Builder", href: "/builder", icon: Wand2 },
    // { name: "Users", href: "/users", icon: Users }
    { name: "Admin Panel", href: "/admin", icon: ShieldCheck },
];

interface SidebarProps {
    isCollapsed: boolean;
    toggleCollapse: () => void;
    mobileOpen?: boolean;
    setMobileOpen?: (open: boolean) => void;
}

interface RecentChat {
    id: string;
    title: string;
    project_id: string | null;
}

interface UserProfile {
    full_name: string | null;
    avatar_url: string | null;
    email: string;
}

export function Sidebar({ isCollapsed, toggleCollapse, mobileOpen = false, setMobileOpen }: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const supabase = createClient();
    const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
    const [loading, setLoading] = useState(true);
    const [creatingChat, setCreatingChat] = useState(false);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                const { data: profile } = await supabase
                    .from("profiles")
                    .select("full_name, avatar_url")
                    .eq("id", user.id)
                    .single();

                setUserProfile({
                    full_name: profile?.full_name || null,
                    avatar_url: profile?.avatar_url || null,
                    email: user.email || "",
                });

                const { data: chats } = await supabase
                    .from("chats")
                    .select("id, title, project_id")
                    .eq("user_id", user.id)
                    .order("created_at", { ascending: false })
                    .limit(20);

                if (chats) {
                    // Filter out agent-generated chats:
                    // 1. New ones (prefixed with hidden \u200B)
                    // 2. Legacy ones matching the Salesforce lookup pattern seen in clutter
                    setRecentChats(chats.filter(c =>
                        !c.title?.startsWith("\u200B") &&
                        !c.title?.startsWith("Look up Salesforce Opportu")
                    ));
                }
            } catch (error) {
                console.error("Error fetching sidebar data:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        // Subscribe to changes in chats table
        const channel = supabase
            .channel('sidebar_updates')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'chats'
            }, () => {
                fetchData();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const handleNewChat = async () => {
        setCreatingChat(true);
        try {
            const { createStandaloneChat } = await import("@/lib/actions/chat");
            const result = await createStandaloneChat();
            if (result.id) {
                router.push(`/chat/${result.id}`);
                setMobileOpen?.(false);
            }
        } catch (err) {
            console.error("Error creating chat:", err);
        } finally {
            setCreatingChat(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        router.push("/");
    };

    const getChatHref = (chat: RecentChat) => {
        if (chat.project_id) {
            return `/projects/${chat.project_id}/chat/${chat.id}`;
        }
        return `/chat/${chat.id}`;
    };

    const userInitial = userProfile?.full_name
        ? userProfile.full_name.charAt(0).toUpperCase()
        : userProfile?.email?.charAt(0).toUpperCase() || "?";

    const userDisplayName = userProfile?.full_name || userProfile?.email?.split("@")[0] || "User";

    return (
        <>
            {/* Mobile Overlay */}
            {mobileOpen && (
                <div
                    className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm md:hidden"
                    onClick={() => setMobileOpen?.(false)}
                />
            )}

            <aside
                className={cn(
                    "fixed left-0 top-0 z-40 h-screen border-r border-border/30 bg-background/95 backdrop-blur transition-all duration-300 supports-[backdrop-filter]:bg-background/60 flex flex-col",
                    "w-64 -translate-x-full md:translate-x-0",
                    mobileOpen && "translate-x-0",
                    isCollapsed ? "md:w-16" : "md:w-64"
                )}
            >
                <div className="flex h-full flex-col px-3 py-3">
                    {/* Toggle Button */}
                    <div className={cn("mb-3 flex", isCollapsed ? "md:justify-center" : "justify-start px-1")}>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { toggleCollapse(); setMobileOpen?.(false); }}
                            className="h-8 w-8 text-muted-foreground/70 hover:text-foreground hidden md:flex"
                        >
                            {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setMobileOpen?.(false)}
                            className="h-8 w-8 text-muted-foreground/70 hover:text-foreground md:hidden"
                        >
                            <PanelLeftClose className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* New Chat */}
                    <button
                        disabled={creatingChat}
                        onClick={handleNewChat}
                        className={cn(
                            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4",
                            isCollapsed && "md:justify-center md:px-2"
                        )}
                    >
                        {creatingChat ? (
                            <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                        ) : (
                            <Plus className="h-4 w-4 flex-shrink-0" />
                        )}
                        <span className={cn("text-sm", isCollapsed && "md:hidden")}>
                            {creatingChat ? "Creating..." : "New chat"}
                        </span>
                    </button>

                    {/* Navigation */}
                    <nav className={cn("space-y-0.5 mb-4", isCollapsed && "flex flex-col items-center")}>
                        {menuItems.map((item) => {
                            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                                        isCollapsed ? "md:justify-center md:px-2 md:w-10" : "",
                                        isActive
                                            ? "text-foreground font-medium"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                    title={isCollapsed ? item.name : undefined}
                                    onClick={() => setMobileOpen?.(false)}
                                >
                                    <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
                                    <span className={cn(isCollapsed && "md:hidden")}>{item.name}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    {/* Recents */}
                    <div className="flex-1 overflow-y-auto sidebar-scroll min-h-0">
                        {!isCollapsed && (
                            <div>
                                <h4 className="px-3 text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider mb-2">
                                    Recents
                                </h4>
                                {loading ? (
                                    <div className="flex items-center justify-center py-4">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40" />
                                    </div>
                                ) : recentChats.length === 0 ? (
                                    <p className="px-3 text-xs text-muted-foreground/40">No recent chats</p>
                                ) : (
                                    <div className="space-y-px">
                                        {recentChats.map((chat) => {
                                            const href = getChatHref(chat);
                                            const isActive = pathname === href;
                                            return (
                                                <Link
                                                    key={chat.id}
                                                    href={href}
                                                    className={cn(
                                                        "group flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] transition-colors",
                                                        isActive
                                                            ? "bg-accent/40 text-foreground"
                                                            : "text-muted-foreground/80 hover:text-foreground hover:bg-accent/20"
                                                    )}
                                                    onClick={() => setMobileOpen?.(false)}
                                                >
                                                    <span className="truncate pr-2">{chat.title || "New Chat"}</span>
                                                    <button
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-foreground p-0.5 rounded flex-shrink-0"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                        }}
                                                    >
                                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                                    </button>
                                                </Link>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="mt-auto pt-3 border-t border-border/20">
                        <div className={cn(
                            "flex items-center",
                            isCollapsed ? "md:justify-center" : "gap-3 px-1"
                        )}>
                            {/* Avatar */}
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold flex-shrink-0">
                                {userInitial}
                            </div>

                            {/* Name + Plan */}
                            <div className={cn("flex-1 min-w-0", isCollapsed && "md:hidden")}>
                                <p className="text-sm font-medium text-foreground truncate leading-tight">{userDisplayName}</p>
                                <p className="text-[11px] text-muted-foreground/50 leading-tight">Free plan</p>
                            </div>

                            {/* Actions */}
                            <div className={cn("flex items-center gap-0.5 flex-shrink-0", isCollapsed && "md:hidden")}>
                                <ModeToggle />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground/40 hover:text-foreground"
                                    onClick={handleLogout}
                                    title="Sign out"
                                >
                                    <LogOut className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </aside>
        </>
    );
}
