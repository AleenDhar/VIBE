"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
    LayoutDashboard,
    FolderOpen,
    Users,
    Settings,
    ShieldCheck,
    BarChart,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    History,
    FileText,
    Loader2,
    MessageSquarePlus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { ModeToggle } from "@/components/ModeToggle";
import { createClient } from "@/lib/supabase/client";

const menuItems = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Projects", href: "/projects", icon: FolderOpen },
    { name: "Deal Analytics", href: "/analytics", icon: BarChart },
    { name: "Users", href: "/users", icon: Users },
    { name: "Admin Panel", href: "/admin", icon: ShieldCheck },
    { name: "Settings", href: "/settings", icon: Settings },
];

interface SidebarProps {
    isCollapsed: boolean;
    toggleCollapse: () => void;
    mobileOpen?: boolean;
    setMobileOpen?: (open: boolean) => void;
}

interface Project {
    id: string;
    name: string;
    created_at: string;
}

export function Sidebar({ isCollapsed, toggleCollapse, mobileOpen = false, setMobileOpen }: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const supabase = createClient();
    const [recentProjects, setRecentProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [creatingChat, setCreatingChat] = useState(false);

    useEffect(() => {
        const fetchProjects = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                const { data, error } = await supabase
                    .from("projects")
                    .select("id, name, created_at")
                    .eq("owner_id", user.id)
                    .order("created_at", { ascending: false })
                    .limit(5);

                if (data) {
                    setRecentProjects(data);
                }
            } catch (error) {
                console.error("Error fetching projects:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchProjects();
    }, []);

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
                    "fixed left-0 top-0 z-40 h-screen border-r bg-background/95 backdrop-blur transition-all duration-300 supports-[backdrop-filter]:bg-background/60 flex flex-col",
                    // Mobile: Always w-64, toggle transform
                    "w-64 -translate-x-full md:translate-x-0",
                    mobileOpen && "translate-x-0",
                    // Desktop: Toggle width
                    isCollapsed ? "md:w-16" : "md:w-64"
                )}
            >
                <div className="flex h-full flex-col px-3 py-4">
                    {/* Header / Logo */}
                    <div className={cn("mb-6 flex items-center justify-between", isCollapsed ? "md:justify-center md:px-0" : "px-2")}>
                        <div className="flex items-center">
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground">
                                <BarChart className="h-5 w-5" />
                            </div>
                            <span className={cn("ml-3 text-xl font-bold tracking-tight text-foreground whitespace-nowrap", isCollapsed && "md:hidden")}>
                                Deal Intel
                            </span>
                        </div>
                        {/* Mobile Close Button */}
                        <div className="md:hidden">
                            <Button variant="ghost" size="icon" onClick={() => setMobileOpen?.(false)}>
                                <PanelLeftClose className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Desktop Toggle Button */}
                    <div className={cn("mb-4 hidden md:flex", isCollapsed ? "justify-center" : "justify-end px-2")}>
                        <Button variant="ghost" size="icon" onClick={toggleCollapse} title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}>
                            {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                        </Button>
                    </div>

                    {/* New Project Button */}
                    <div className={cn("mb-2", isCollapsed ? "px-0 flex justify-center" : "px-0")}>
                        <Button
                            asChild
                            variant="glass"
                            className={cn(
                                "w-full justify-start gap-2",
                                isCollapsed && "w-10 h-10 p-0 justify-center"
                            )}
                        >
                            <Link href="/projects/new">
                                <Plus className={cn("h-4 w-4", !isCollapsed && "mr-1")} />
                                {!isCollapsed && "New Project"}
                            </Link>
                        </Button>
                    </div>

                    {/* New Chat Button */}
                    <div className={cn("mb-6", isCollapsed ? "px-0 flex justify-center" : "px-0")}>
                        <Button
                            variant="outline"
                            disabled={creatingChat}
                            className={cn(
                                "w-full justify-start gap-2",
                                isCollapsed && "w-10 h-10 p-0 justify-center"
                            )}
                            onClick={async () => {
                                setCreatingChat(true);
                                try {
                                    const { createStandaloneChat } = await import("@/lib/actions/chat");
                                    const result = await createStandaloneChat();
                                    if (result.id) {
                                        router.push(`/chat/${result.id}`);
                                        setMobileOpen?.(false);
                                    } else {
                                        console.error("Failed to create chat:", result.error);
                                    }
                                } catch (err) {
                                    console.error("Error creating standalone chat:", err);
                                } finally {
                                    setCreatingChat(false);
                                }
                            }}
                        >
                            {creatingChat ? (
                                <Loader2 className={cn("h-4 w-4 animate-spin", !isCollapsed && "mr-1")} />
                            ) : (
                                <MessageSquarePlus className={cn("h-4 w-4", !isCollapsed && "mr-1")} />
                            )}
                            {!isCollapsed && (creatingChat ? "Creating..." : "New Chat")}
                        </Button>
                    </div>

                    {/* Navigation */}
                    <div className="flex-1 overflow-y-auto space-y-6 scrollbar-none">
                        <nav className="space-y-1">
                            {menuItems.map((item) => {
                                const isActive = pathname.startsWith(item.href);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={cn(
                                            "flex items-center rounded-lg py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                                            isCollapsed ? "md:justify-center md:px-2" : "px-3",
                                            mobileOpen ? "px-3" : "",
                                            isActive
                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                : "text-muted-foreground"
                                        )}
                                        title={isCollapsed ? item.name : undefined}
                                        onClick={() => setMobileOpen?.(false)}
                                    >
                                        <item.icon className={cn("h-5 w-5 flex-shrink-0", (!isCollapsed || mobileOpen) && "mr-3", isCollapsed && !mobileOpen && "md:mr-0")} />
                                        <span className={cn(isCollapsed && "md:hidden")}>{item.name}</span>
                                    </Link>
                                );
                            })}
                        </nav>

                        {/* Recent Projects Section */}
                        {!isCollapsed && (
                            <div className="space-y-2">
                                <h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    <History className="h-3 w-3" />
                                    Recent Projects
                                </h4>
                                <div className="space-y-1">
                                    {loading ? (
                                        <div className="flex items-center justify-center py-4">
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        </div>
                                    ) : recentProjects.length === 0 ? (
                                        <p className="px-3 text-xs text-muted-foreground italic">No recent projects</p>
                                    ) : (
                                        recentProjects.map((project) => (
                                            <Link
                                                key={project.id}
                                                href={`/projects/${project.id}`}
                                                className={cn(
                                                    "flex items-center rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground truncate block",
                                                    pathname === `/projects/${project.id}` && "bg-accent"
                                                )}
                                                onClick={() => setMobileOpen?.(false)}
                                            >
                                                <FileText className="h-4 w-4 mr-2 text-muted-foreground flex-shrink-0" />
                                                <span className="truncate">{project.name}</span>
                                            </Link>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer Actions */}
                    <div className="mt-auto border-t pt-4 space-y-2">
                        <div className={cn("flex items-center", isCollapsed ? "md:justify-center" : "px-3 justify-between")}>
                            <ModeToggle />
                            <span className={cn("text-sm font-medium text-muted-foreground ml-2", isCollapsed && "md:hidden")}>Theme</span>
                        </div>
                    </div>
                </div>
            </aside>
        </>
    );
}
