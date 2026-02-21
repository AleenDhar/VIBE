"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef, useCallback } from "react";
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
    Search,
    Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { ModeToggle } from "@/components/ModeToggle";
import { createClient } from "@/lib/supabase/client";
import { toggleStarChat } from "@/lib/actions/chat";

const menuItems = [
    { name: "Chats", href: "/chats", icon: MessageSquare },
    { name: "Projects", href: "/projects", icon: FolderOpen },
    // { name: "App Builder", href: "/builder", icon: Wand2 },
    // { name: "Users", href: "/users", icon: Users }
    { name: "Admin Panel", href: "/admin", icon: ShieldCheck },
];

const superAdminItems = [
    { name: "Omnivision", href: "/omnivision", icon: Eye },
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
    is_starred: boolean;
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
    const [searchQuery, setSearchQuery] = useState("");
    const [userRole, setUserRole] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                const { data: profile } = await supabase
                    .from("profiles")
                    .select("full_name, avatar_url, role")
                    .eq("id", user.id)
                    .single();

                setUserProfile({
                    full_name: profile?.full_name || null,
                    avatar_url: profile?.avatar_url || null,
                    email: user.email || "",
                });
                setUserRole(profile?.role || null);

                const { data: chats } = await supabase
                    .from("chats")
                    .select("id, title, project_id, is_starred")
                    .eq("user_id", user.id)
                    .order("created_at", { ascending: false })
                    .limit(30);

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

    const handleNewChat = () => {
        router.push("/chat");
        setMobileOpen?.(false);
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

    const handleToggleStar = useCallback(async (chatId: string, currentlyStarred: boolean) => {
        // Optimistic update
        setRecentChats(prev =>
            prev.map(c => c.id === chatId ? { ...c, is_starred: !currentlyStarred } : c)
        );
        setOpenDropdownId(null);

        const result = await toggleStarChat(chatId, !currentlyStarred);
        if (result.error) {
            // Revert on error
            setRecentChats(prev =>
                prev.map(c => c.id === chatId ? { ...c, is_starred: currentlyStarred } : c)
            );
            console.error("Failed to toggle star:", result.error);
        }
    }, []);

    const handleDeleteChat = useCallback(async (chatId: string) => {
        setOpenDropdownId(null);
        const { error } = await supabase.from("chats").delete().eq("id", chatId);
        if (error) {
            console.error("Failed to delete chat:", error);
        } else {
            setRecentChats(prev => prev.filter(c => c.id !== chatId));
        }
    }, [supabase]);

    const userInitial = userProfile?.full_name
        ? userProfile.full_name.charAt(0).toUpperCase()
        : userProfile?.email?.charAt(0).toUpperCase() || "?";

    const userDisplayName = userProfile?.full_name || userProfile?.email?.split("@")[0] || "User";

    // Separate starred and unstarred chats with search filter applied
    const filteredChats = recentChats.filter(c =>
        (c.title || "New Chat").toLowerCase().includes(searchQuery.toLowerCase())
    );
    const starredChats = filteredChats.filter(c => c.is_starred);
    const unstarredChats = filteredChats.filter(c => !c.is_starred);

    const renderChatItem = (chat: RecentChat, isStarredSection: boolean) => {
        const href = getChatHref(chat);
        const isActive = pathname === href;
        const isDropdownOpen = openDropdownId === chat.id;

        return (
            <div key={chat.id} className="relative">
                <Link
                    href={href}
                    className={cn(
                        "group flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] transition-colors",
                        isActive
                            ? "bg-accent/40 text-foreground"
                            : "text-muted-foreground/80 hover:text-foreground hover:bg-accent/20"
                    )}
                    onClick={() => setMobileOpen?.(false)}
                >
                    <span className="truncate pr-2 flex items-center gap-1.5">
                        {isStarredSection && (
                            <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />
                        )}
                        {chat.title || "New Chat"}
                    </span>
                    <button
                        className={cn(
                            "transition-opacity text-muted-foreground/50 hover:text-foreground p-0.5 rounded flex-shrink-0",
                            isDropdownOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenDropdownId(isDropdownOpen ? null : chat.id);
                        }}
                    >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                </Link>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                    <div
                        ref={dropdownRef}
                        className="absolute right-0 top-full mt-1 z-50 w-40 rounded-lg border border-border/40 bg-popover/95 backdrop-blur-xl shadow-xl shadow-black/20 py-1 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150"
                    >
                        <button
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-foreground/90 hover:bg-accent/30 transition-colors rounded-sm mx-0.5"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleToggleStar(chat.id, chat.is_starred);
                            }}
                        >
                            <Star className={cn(
                                "h-3.5 w-3.5",
                                chat.is_starred
                                    ? "text-amber-400 fill-amber-400"
                                    : "text-muted-foreground/70"
                            )} />
                            <span>{chat.is_starred ? "Unstar" : "Star"}</span>
                        </button>
                        <div className="my-1 h-px bg-border/20 mx-2" />
                        <button
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors rounded-sm mx-0.5"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDeleteChat(chat.id);
                            }}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete</span>
                        </button>
                    </div>
                )}
            </div>
        );
    };

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
                        {/* Super Admin - Omnivision */}
                        {userRole === 'super_admin' && superAdminItems.map((item) => {
                            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={cn(
                                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                                        isCollapsed ? "md:justify-center md:px-2 md:w-10" : "",
                                        isActive
                                            ? "text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10"
                                            : "text-amber-600/60 dark:text-amber-400/60 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/5"
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

                    {/* Scrollable chats area */}
                    <div className="flex-1 overflow-y-auto sidebar-scroll min-h-0">
                        {!isCollapsed && (
                            <div>
                                {/* Search Bar */}
                                <div className="px-2 mb-3">
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                            <Search className="h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-muted-foreground/70 transition-colors" />
                                        </div>
                                        <input
                                            type="text"
                                            placeholder="Search recent..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full bg-accent/10 border border-border/20 rounded-md py-1.5 pl-9 pr-3 text-[12px] focus:outline-none focus:ring-1 focus:ring-border/40 placeholder:text-muted-foreground/30 transition-all hover:bg-accent/20"
                                        />
                                    </div>
                                </div>

                                {loading ? (
                                    <div className="flex items-center justify-center py-4">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40" />
                                    </div>
                                ) : (
                                    <>
                                        {/* Starred Section */}
                                        {starredChats.length > 0 && (
                                            <div className="mb-4">
                                                <div className="flex items-center gap-1.5 mb-2 px-3">
                                                    <Star className="h-3 w-3 text-amber-400/70 fill-amber-400/70" />
                                                    <h4 className="text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                                                        Starred
                                                    </h4>
                                                </div>
                                                <div className="space-y-px">
                                                    {starredChats.map((chat) => renderChatItem(chat, true))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Recents Section */}
                                        <div>
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="px-3 text-[11px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                                                    Recents
                                                </h4>
                                            </div>
                                            <div className="space-y-px">
                                                {unstarredChats.map((chat) => renderChatItem(chat, false))}
                                                {unstarredChats.length === 0 && (
                                                    <p className="px-3 text-xs text-muted-foreground/40 italic py-2">
                                                        {searchQuery ? "No matches found" : "No recent chats"}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </>
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
