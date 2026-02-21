"use client";

import { useState } from "react";
import {
    Eye, Search, MessageSquare, User, ChevronDown, ChevronRight,
    ArrowLeft, Clock, Filter, FolderOpen, ExternalLink, Inbox,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface OmnivisionChat {
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
    project_id: string | null;
    project_name: string | null;
    user_id: string;
    last_msg_type: string | null;
    profiles: {
        full_name: string | null;
        role: string | null;
        avatar_url: string | null;
    } | null;
}

interface ProjectGroup {
    project_id: string | null;
    project_name: string | null;
    chats: OmnivisionChat[];
}

interface UserGroup {
    user_id: string;
    full_name: string;
    role: string | null;
    avatar_url: string | null;
    chatCount: number;
    projects: ProjectGroup[];
}

export function OmnivisionDashboard({ initialChats }: { initialChats: OmnivisionChat[] }) {
    const [searchQuery, setSearchQuery] = useState("");
    const [filterRole, setFilterRole] = useState("all");
    const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

    // ── Build User → Project → Chat tree ──────────────────────────────────
    const userMap: Record<string, UserGroup> = {};

    for (const chat of initialChats) {
        const uid = chat.user_id ?? "unknown";
        if (!userMap[uid]) {
            userMap[uid] = {
                user_id: uid,
                full_name: chat.profiles?.full_name || "Unknown User",
                role: chat.profiles?.role || "user",
                avatar_url: chat.profiles?.avatar_url || null,
                chatCount: 0,
                projects: [],
            };
        }
        const user = userMap[uid];
        user.chatCount++;

        // find or create project bucket
        const projKey = chat.project_id ?? "__direct__";
        let projGroup = user.projects.find(p => (p.project_id ?? "__direct__") === projKey);
        if (!projGroup) {
            projGroup = {
                project_id: chat.project_id,
                project_name: chat.project_name ?? (chat.project_id ? `Project ${chat.project_id.substring(0, 8)}...` : "Direct Chats"),
                chats: [],
            };
            user.projects.push(projGroup);
        }
        projGroup.chats.push(chat);
    }

    // sort users by chat count desc; sort each user's projects (direct last)
    const allUsers: UserGroup[] = Object.values(userMap)
        .sort((a, b) => b.chatCount - a.chatCount)
        .map(u => ({
            ...u,
            projects: u.projects.sort((a, b) => {
                if (!a.project_id) return 1;
                if (!b.project_id) return -1;
                return b.chats.length - a.chats.length;
            }),
        }));

    // ── Filtering ────────────────────────────────────────────────────────
    const lq = searchQuery.toLowerCase();
    const filteredUsers = allUsers.filter(user => {
        const matchesRole = filterRole === "all" || user.role === filterRole;
        if (!matchesRole) return false;
        if (!lq) return true;
        return (
            user.full_name.toLowerCase().includes(lq) ||
            user.projects.some(p =>
                (p.project_name || "").toLowerCase().includes(lq) ||
                p.chats.some(c => (c.title || "").toLowerCase().includes(lq))
            )
        );
    });

    const totalChats = initialChats.length;
    const totalUsers = allUsers.length;

    // ── Toggle helpers ───────────────────────────────────────────────────
    const toggleUser = (uid: string) => setExpandedUsers(prev => {
        const next = new Set(prev);
        next.has(uid) ? next.delete(uid) : next.add(uid);
        return next;
    });

    const toggleProject = (key: string) => setExpandedProjects(prev => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    });

    // chat link helper
    const chatHref = (chat: OmnivisionChat) =>
        chat.project_id
            ? `/projects/${chat.project_id}/chat/${chat.id}`
            : `/chat/${chat.id}`;

    const isLive = (chat: OmnivisionChat) => chat.last_msg_type === "processing" || chat.last_msg_type === "status";

    // Live badge
    const LiveBadge = () => (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-medium leading-none flex-shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
        </span>
    );

    // ── Role badge ───────────────────────────────────────────────────────
    const RoleBadge = ({ role }: { role: string | null }) => {
        if (role === "super_admin")
            return (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 border border-amber-500/30 font-semibold leading-none">
                    ⚡ SUPER
                </span>
            );
        if (role === "admin")
            return (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 leading-none">
                    ADMIN
                </span>
            );
        return null;
    };

    // ── Avatar ───────────────────────────────────────────────────────────
    const Avatar = ({ user }: { user: UserGroup }) => (
        <div className={cn(
            "h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 overflow-hidden",
            user.role === "super_admin"
                ? "ring-2 ring-amber-500/40 bg-gradient-to-br from-amber-500/30 to-orange-500/30 text-amber-500"
                : user.role === "admin"
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
        )}>
            {user.avatar_url
                ? <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
                : user.full_name.charAt(0).toUpperCase()
            }
        </div>
    );

    return (
        <div className="flex flex-col h-full bg-background">

            {/* ── Sticky header ─────────────────────────────────────────── */}
            <div className="border-b border-border/30 bg-background/95 backdrop-blur sticky top-0 z-10">
                <div className="max-w-5xl mx-auto px-4 py-4 space-y-3">

                    {/* Title row */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30">
                                <Eye className="h-5 w-5 text-amber-500" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
                                    Omnivision
                                </h1>
                                <p className="text-xs text-muted-foreground">Super Admin · All user conversations</p>
                            </div>
                        </div>
                        <Link
                            href="/admin"
                            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Admin
                        </Link>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-5 text-sm">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            <strong className="text-foreground">{totalUsers}</strong> users
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <MessageSquare className="h-3.5 w-3.5 opacity-50" />
                            <strong className="text-foreground">{totalChats}</strong> chats
                        </span>
                    </div>

                    {/* Search + filter */}
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search users, projects, chats…"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full bg-muted/30 border border-border/20 rounded-xl py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-muted-foreground/30"
                            />
                        </div>
                        <div className="relative flex items-center">
                            <Filter className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground/40 pointer-events-none" />
                            <select
                                value={filterRole}
                                onChange={e => setFilterRole(e.target.value)}
                                className="bg-muted/30 border border-border/20 rounded-xl py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 appearance-none cursor-pointer"
                            >
                                <option value="all">All roles</option>
                                <option value="super_admin">Super Admin</option>
                                <option value="admin">Admin</option>
                                <option value="user">User</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Content ───────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-5xl mx-auto px-4 py-5 space-y-2">
                    {filteredUsers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                            <Search className="h-12 w-12 mb-3 opacity-10" />
                            <p className="text-sm">No results</p>
                        </div>
                    ) : filteredUsers.map(user => {
                        const userExpanded = expandedUsers.has(user.user_id);

                        return (
                            <div
                                key={user.user_id}
                                className="border border-border/30 rounded-xl overflow-hidden bg-card/40 backdrop-blur-sm hover:border-border/60 transition-colors"
                            >
                                {/* ── User row ──────────────────────────── */}
                                <button
                                    onClick={() => toggleUser(user.user_id)}
                                    className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-accent/10 transition-colors text-left"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <Avatar user={user} />
                                        <div className="min-w-0">
                                            <p className="font-medium text-sm flex items-center gap-2 flex-wrap">
                                                {user.full_name}
                                                <RoleBadge role={user.role} />
                                            </p>
                                            <p className="text-xs text-muted-foreground/50 mt-0.5">
                                                {user.chatCount} chat{user.chatCount !== 1 ? "s" : ""}
                                                {" · "}
                                                {user.projects.filter(p => p.project_id).length} project{user.projects.filter(p => p.project_id).length !== 1 ? "s" : ""}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                        <span className="text-xs bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-md">
                                            {user.chatCount}
                                        </span>
                                        {userExpanded
                                            ? <ChevronDown className="h-4 w-4 text-muted-foreground/40" />
                                            : <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                                        }
                                    </div>
                                </button>

                                {/* ── Expanded: project groups ───────────── */}
                                {userExpanded && (
                                    <div className="border-t border-border/20 divide-y divide-border/10 bg-background/40">
                                        {user.projects.map(proj => {
                                            const projKey = `${user.user_id}-${proj.project_id ?? "direct"}`;
                                            const projExpanded = expandedProjects.has(projKey);
                                            const isDirect = !proj.project_id;

                                            return (
                                                <div key={projKey}>
                                                    {/* project header */}
                                                    <button
                                                        onClick={() => toggleProject(projKey)}
                                                        className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-accent/10 transition-colors text-left"
                                                    >
                                                        <div className="flex items-center gap-2.5">
                                                            {isDirect
                                                                ? <Inbox className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
                                                                : <FolderOpen className="h-3.5 w-3.5 text-primary/50 flex-shrink-0" />
                                                            }
                                                            <span className={cn(
                                                                "text-xs font-medium",
                                                                isDirect ? "text-muted-foreground/60" : "text-foreground/80"
                                                            )}>
                                                                {isDirect ? "Direct Chats" : proj.project_name}
                                                            </span>
                                                            <span className="text-[10px] bg-muted/40 text-muted-foreground/50 px-1.5 py-0.5 rounded-md">
                                                                {proj.chats.length}
                                                            </span>
                                                        </div>
                                                        {projExpanded
                                                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/30" />
                                                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30" />
                                                        }
                                                    </button>

                                                    {/* chat list */}
                                                    {projExpanded && (
                                                        <div className="bg-background/60 divide-y divide-border/5">
                                                            {proj.chats.map(chat => (
                                                                <Link
                                                                    key={chat.id}
                                                                    href={chatHref(chat)}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="flex items-center justify-between px-7 py-2.5 hover:bg-amber-500/5 group transition-colors"
                                                                >
                                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                                        <MessageSquare className={cn(
                                                                            "h-3.5 w-3.5 flex-shrink-0 transition-colors",
                                                                            isLive(chat)
                                                                                ? "text-emerald-400"
                                                                                : "text-muted-foreground/25 group-hover:text-amber-500/60"
                                                                        )} />
                                                                        <div className="min-w-0">
                                                                            <p className="text-sm text-foreground/75 truncate group-hover:text-foreground transition-colors flex items-center gap-2">
                                                                                {chat.title || "Untitled Chat"}
                                                                                {isLive(chat) && <LiveBadge />}
                                                                            </p>
                                                                            <p className="text-[11px] text-muted-foreground/40 flex items-center gap-1 mt-0.5">
                                                                                <Clock className="h-2.5 w-2.5" />
                                                                                {formatDistanceToNow(new Date(chat.created_at))} ago
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-amber-500 transition-all opacity-0 group-hover:opacity-100 flex-shrink-0 ml-2" />
                                                                </Link>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
