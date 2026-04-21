"use client";

import { useState, useRef, useCallback } from "react";
import {
    Eye, Search, MessageSquare, User, ChevronDown, ChevronRight,
    ArrowLeft, Clock, Filter, FolderOpen, ExternalLink, Inbox, Loader2, X, FileSearch,
    CalendarDays
} from "lucide-react";
import { formatDistanceToNow, subDays, format } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { UserAggregate, getOmnivisionChatsForUser, searchOmnivisionMessages, MessageSearchResult } from "@/lib/actions/admin";
import { SENTINEL_ORPHAN_USER_ID } from "@/lib/omnivision-constants";

/**
 * Omnivision range bounds are plain calendar dates resolved server-side
 * against the Asia/Kolkata business timezone. The client just picks the
 * intended day in IST and stringifies as YYYY-MM-DD so the RPC produces
 * identical numbers regardless of the viewer's browser timezone.
 */
const BIZ_TZ = "Asia/Kolkata";
const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
    timeZone: BIZ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});
function formatIstDate(d: Date): string {
    // en-CA yields YYYY-MM-DD
    return IST_DATE_FORMATTER.format(d);
}

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

interface UserState extends UserAggregate {
    isLoaded?: boolean;
    isLoading?: boolean;
    projects?: ProjectGroup[];
}

type DatePreset = "all" | "today" | "7d" | "30d" | "custom";

export function OmnivisionDashboard({ initialAggregates }: { initialAggregates: UserAggregate[] }) {
    const [searchQuery, setSearchQuery] = useState("");
    const [filterRole, setFilterRole] = useState("all");
    const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

    const [users, setUsers] = useState<Record<string, UserState>>(() => {
        const init: Record<string, UserState> = {};
        for (const u of initialAggregates) {
            init[u.user_id] = { ...u, projects: [] };
        }
        return init;
    });

    // ── Date filter state ──────────────────────────────────────────────
    const [datePreset, setDatePreset] = useState<DatePreset>("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [dateLoading, setDateLoading] = useState(false);

    const getDateRange = useCallback((): { from?: string; to?: string } => {
        // Returns IST calendar dates as YYYY-MM-DD so the server RPC can
        // resolve window boundaries authoritatively. Prevents the browser
        // timezone from skewing results (Bug 3).
        const now = new Date();
        switch (datePreset) {
            case "today":
                return { from: formatIstDate(now), to: formatIstDate(now) };
            case "7d":
                return { from: formatIstDate(subDays(now, 7)), to: formatIstDate(now) };
            case "30d":
                return { from: formatIstDate(subDays(now, 30)), to: formatIstDate(now) };
            case "custom":
                // Custom picker already produces YYYY-MM-DD strings; pass
                // them through untouched so we honour exactly what the
                // user typed, interpreted as IST dates server-side.
                return {
                    from: dateFrom || undefined,
                    to: dateTo || undefined,
                };
            default:
                return {};
        }
    }, [datePreset, dateFrom, dateTo]);

    const applyDateFilter = useCallback(async (preset: DatePreset, customFrom?: string, customTo?: string) => {
        setDatePreset(preset);
        if (customFrom !== undefined) setDateFrom(customFrom);
        if (customTo !== undefined) setDateTo(customTo);
        setDateLoading(true);

        // Collapse all expanded users since data will change
        setExpandedUsers(new Set());
        setExpandedProjects(new Set());

        try {
            const now = new Date();
            let from: string | undefined;
            let to: string | undefined;

            switch (preset) {
                case "today":
                    from = formatIstDate(now);
                    to = formatIstDate(now);
                    break;
                case "7d":
                    from = formatIstDate(subDays(now, 7));
                    to = formatIstDate(now);
                    break;
                case "30d":
                    from = formatIstDate(subDays(now, 30));
                    to = formatIstDate(now);
                    break;
                case "custom":
                    from = (customFrom || dateFrom) || undefined;
                    to = (customTo || dateTo) || undefined;
                    break;
            }

            const { getOmnivisionUserAggregates } = await import("@/lib/actions/admin");
            const newAggregates = await getOmnivisionUserAggregates(from, to);

            const updated: Record<string, UserState> = {};
            for (const u of newAggregates) {
                updated[u.user_id] = { ...u, projects: [] };
            }
            setUsers(updated);
        } catch (err) {
            console.error("Failed to apply date filter:", err);
        } finally {
            setDateLoading(false);
        }
    }, [dateFrom, dateTo]);

    const dateLabel = useCallback(() => {
        switch (datePreset) {
            case "today": return "Today";
            case "7d": return "Last 7 days";
            case "30d": return "Last 30 days";
            case "custom":
                if (dateFrom && dateTo) return `${dateFrom} → ${dateTo}`;
                if (dateFrom) return `From ${dateFrom}`;
                if (dateTo) return `Until ${dateTo}`;
                return "Custom";
            default: return "All time";
        }
    }, [datePreset, dateFrom, dateTo]);

    // ── Message search state ────────────────────────────────────────────
    const [msgSearchQuery, setMsgSearchQuery] = useState("");
    const [msgSearchResults, setMsgSearchResults] = useState<MessageSearchResult[]>([]);
    const [msgSearchLoading, setMsgSearchLoading] = useState(false);
    const [showMsgSearch, setShowMsgSearch] = useState(false);
    const msgSearchTimer = useRef<NodeJS.Timeout | null>(null);

    const handleMsgSearch = useCallback((value: string) => {
        setMsgSearchQuery(value);
        if (msgSearchTimer.current) clearTimeout(msgSearchTimer.current);

        if (value.trim().length < 2) {
            setMsgSearchResults([]);
            setMsgSearchLoading(false);
            return;
        }

        setMsgSearchLoading(true);
        msgSearchTimer.current = setTimeout(async () => {
            try {
                const results = await searchOmnivisionMessages(value);
                setMsgSearchResults(results);
            } catch (err) {
                console.error("Message search failed:", err);
                setMsgSearchResults([]);
            } finally {
                setMsgSearchLoading(false);
            }
        }, 400);
    }, []);

    const highlightMatch = (text: string, query: string) => {
        if (!query || query.length < 2) return text;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text;
        return (
            <>
                {text.slice(0, idx)}
                <mark className="bg-amber-500/30 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
                {text.slice(idx + query.length)}
            </>
        );
    };

    const getSnippet = (content: string, query: string, maxLen: number = 150) => {
        const idx = content.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return content.slice(0, maxLen);
        const start = Math.max(0, idx - 50);
        const end = Math.min(content.length, idx + query.length + 80);
        return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
    };

    const allUsers = Object.values(users).sort((a, b) => Number(b.chat_count) - Number(a.chat_count));

    // ── Filtering ────────────────────────────────────────────────────────
    const lq = searchQuery.toLowerCase();
    const filteredUsers = allUsers.filter(user => {
        const matchesRole = filterRole === "all" || user.role === filterRole;
        if (!matchesRole) return false;
        if (!lq) return true;
        
        // Match user details
        if (
            (user.full_name || "").toLowerCase().includes(lq) ||
            (user.username || "").toLowerCase().includes(lq) ||
            (user.role || "").toLowerCase().includes(lq)
        ) {
            return true;
        }

        // Match loaded projects and chats if they exist
        if (user.isLoaded && user.projects) {
            return user.projects.some(p =>
                (p.project_name || "").toLowerCase().includes(lq) ||
                p.chats.some(c => (c.title || "").toLowerCase().includes(lq))
            );
        }

        return false;
    });

    const allUsersList = Object.values(users);
    // The "(unattributed)" synthetic entry carries chats with user_id = NULL
    // so totals aren't understated (Bug 4). It is NOT a real user, so it
    // must be excluded from the user count but included in the chat count.
    const totalUsers = allUsersList.filter(u =>
        u.user_id !== SENTINEL_ORPHAN_USER_ID &&
        (Number(u.chat_count) > 0 || datePreset === "all")
    ).length;
    const totalChats = allUsersList.reduce((acc, curr) => acc + Number(curr.chat_count), 0);

    // ── Toggle helpers ───────────────────────────────────────────────────
    const toggleUser = async (uid: string) => {
        setExpandedUsers(prev => {
            const next = new Set(prev);
            if (next.has(uid)) {
                next.delete(uid);
            } else {
                next.add(uid);
            }
            return next;
        });

        // Fetch user chats if not loaded
        if (!users[uid].isLoaded && !users[uid].isLoading) {
            setUsers(prev => ({ ...prev, [uid]: { ...prev[uid], isLoading: true } }));

            try {
                const range = getDateRange();
                const fetchedChats = await getOmnivisionChatsForUser(uid, range.from, range.to);

                const pGroups: Record<string, ProjectGroup> = {};
                for (const chat of fetchedChats) {
                    const pKey = chat.project_id || "__direct__";
                    if (!pGroups[pKey]) {
                        pGroups[pKey] = {
                            project_id: chat.project_id,
                            project_name: chat.project_name ?? (chat.project_id ? `Project ${chat.project_id.substring(0, 8)}...` : "Direct Chats"),
                            chats: [],
                        };
                    }
                    pGroups[pKey].chats.push(chat as any);
                }

                const sortedProjects = Object.values(pGroups).sort((a, b) => {
                    if (!a.project_id) return 1;
                    if (!b.project_id) return -1;
                    return b.chats.length - a.chats.length;
                });

                setUsers(prev => ({
                    ...prev,
                    [uid]: { ...prev[uid], isLoaded: true, isLoading: false, projects: sortedProjects }
                }));
            } catch (err) {
                console.error("Failed to load user chats", err);
                setUsers(prev => ({ ...prev, [uid]: { ...prev[uid], isLoading: false } }));
            }
        }
    };

    const toggleProject = (key: string) => setExpandedProjects(prev => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    });

    const chatHref = (chat: OmnivisionChat) =>
        chat.project_id
            ? `/projects/${chat.project_id}/chat/${chat.id}`
            : `/chat/${chat.id}`;

    const isLive = (chat: OmnivisionChat) => chat.last_msg_type === "processing" || chat.last_msg_type === "status";

    const LiveBadge = () => (
        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 font-medium leading-none flex-shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
        </span>
    );

    const RoleBadge = ({ role }: { role: string | null }) => {
        if (role === "super_admin")
            return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 border border-amber-500/30 font-semibold leading-none">⚡ SUPER</span>;
        if (role === "admin")
            return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 leading-none">ADMIN</span>;
        return null;
    };

    const Avatar = ({ user }: { user: UserState }) => (
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
                : (user.full_name || user.username || "?").charAt(0).toUpperCase()
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
                                placeholder="Search users or loaded chats…"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full bg-muted/30 border border-border/20 rounded-xl py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-muted-foreground/30"
                            />
                        </div>

                        {/* Date filter button */}
                        <button
                            onClick={() => setShowDatePicker(prev => !prev)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap",
                                datePreset !== "all"
                                    ? "bg-amber-500/15 border-amber-500/30 text-amber-500"
                                    : "bg-muted/30 border-border/20 text-muted-foreground hover:text-foreground hover:border-border/40"
                            )}
                            title="Filter by date"
                        >
                            {dateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                            <span className="hidden sm:inline">{dateLabel()}</span>
                        </button>

                        <button
                            onClick={() => setShowMsgSearch(prev => !prev)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors",
                                showMsgSearch
                                    ? "bg-amber-500/15 border-amber-500/30 text-amber-500"
                                    : "bg-muted/30 border-border/20 text-muted-foreground hover:text-foreground hover:border-border/40"
                            )}
                            title="Search message content"
                        >
                            <FileSearch className="h-4 w-4" />
                            <span className="hidden sm:inline">Messages</span>
                        </button>
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

                    {/* ── Date filter panel ───────────────────────────── */}
                    {showDatePicker && (
                        <div className="bg-muted/20 border border-border/20 rounded-xl p-3 space-y-3">
                            {/* Preset buttons */}
                            <div className="flex flex-wrap gap-2">
                                {([
                                    { key: "all", label: "All time" },
                                    { key: "today", label: "Today" },
                                    { key: "7d", label: "Last 7 days" },
                                    { key: "30d", label: "Last 30 days" },
                                    { key: "custom", label: "Custom range" },
                                ] as { key: DatePreset; label: string }[]).map(({ key, label }) => (
                                    <button
                                        key={key}
                                        onClick={() => {
                                            if (key !== "custom") {
                                                applyDateFilter(key);
                                                if (key === "all") setShowDatePicker(false);
                                            } else {
                                                setDatePreset("custom");
                                            }
                                        }}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                                            datePreset === key
                                                ? "bg-amber-500/15 border-amber-500/30 text-amber-500"
                                                : "bg-background/60 border-border/20 text-muted-foreground hover:text-foreground hover:border-border/40"
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {/* Custom date inputs */}
                            {datePreset === "custom" && (
                                <div className="flex items-center gap-2">
                                    <div className="flex-1">
                                        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1 block">From</label>
                                        <input
                                            type="date"
                                            value={dateFrom}
                                            onChange={e => setDateFrom(e.target.value)}
                                            className="w-full bg-background/60 border border-border/20 rounded-lg py-1.5 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-foreground"
                                        />
                                    </div>
                                    <span className="text-muted-foreground/30 mt-4">→</span>
                                    <div className="flex-1">
                                        <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1 block">To</label>
                                        <input
                                            type="date"
                                            value={dateTo}
                                            onChange={e => setDateTo(e.target.value)}
                                            className="w-full bg-background/60 border border-border/20 rounded-lg py-1.5 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-foreground"
                                        />
                                    </div>
                                    <button
                                        onClick={() => applyDateFilter("custom", dateFrom, dateTo)}
                                        disabled={!dateFrom && !dateTo}
                                        className={cn(
                                            "mt-4 px-4 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                                            dateFrom || dateTo
                                                ? "bg-amber-500/15 border-amber-500/30 text-amber-500 hover:bg-amber-500/25"
                                                : "bg-muted/30 border-border/20 text-muted-foreground/40 cursor-not-allowed"
                                        )}
                                    >
                                        Apply
                                    </button>
                                </div>
                            )}

                            {/* Active filter indicator with clear */}
                            {datePreset !== "all" && datePreset !== "custom" && (
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground/50">
                                        Showing chats from <span className="text-amber-500 font-medium">{dateLabel()}</span>
                                    </span>
                                    <button
                                        onClick={() => { applyDateFilter("all"); setShowDatePicker(false); }}
                                        className="text-muted-foreground/40 hover:text-foreground flex items-center gap-1"
                                    >
                                        <X className="h-3 w-3" /> Clear
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Message content search panel ─────────────────── */}
                    {showMsgSearch && (
                        <div className="bg-muted/20 border border-border/20 rounded-xl p-3 space-y-3">
                            <div className="relative">
                                <FileSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-500/50 pointer-events-none" />
                                <input
                                    type="text"
                                    placeholder="Search inside all message content…"
                                    value={msgSearchQuery}
                                    onChange={e => handleMsgSearch(e.target.value)}
                                    className="w-full bg-background/60 border border-amber-500/20 rounded-lg py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 placeholder:text-muted-foreground/30"
                                    autoFocus
                                />
                                {msgSearchQuery && (
                                    <button
                                        onClick={() => { setMsgSearchQuery(""); setMsgSearchResults([]); }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>

                            {/* Results */}
                            {msgSearchLoading && (
                                <div className="flex items-center justify-center py-4 text-muted-foreground/50">
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    <span className="text-xs">Searching messages…</span>
                                </div>
                            )}

                            {!msgSearchLoading && msgSearchQuery.length >= 2 && msgSearchResults.length === 0 && (
                                <div className="text-center py-4 text-muted-foreground/40 text-xs">
                                    No messages found
                                </div>
                            )}

                            {!msgSearchLoading && msgSearchResults.length > 0 && (
                                <div className="space-y-1 max-h-80 overflow-y-auto">
                                    <p className="text-[10px] text-muted-foreground/40 px-1 mb-1">
                                        {msgSearchResults.length} result{msgSearchResults.length !== 1 ? "s" : ""} found
                                    </p>
                                    {msgSearchResults.map(result => (
                                        <Link
                                            key={result.message_id}
                                            href={result.project_id ? `/projects/${result.project_id}/chat/${result.chat_id}` : `/chat/${result.chat_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block px-3 py-2.5 rounded-lg hover:bg-amber-500/5 group transition-colors border border-transparent hover:border-amber-500/10"
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-xs font-medium text-foreground/70 truncate">
                                                        {result.full_name || result.username || "Unknown"}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground/30">·</span>
                                                    <span className="text-[10px] text-muted-foreground/40 truncate">
                                                        {result.chat_title || "Untitled Chat"}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                                    <span className={cn(
                                                        "text-[10px] px-1.5 py-0.5 rounded-md",
                                                        result.role === "user" ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"
                                                    )}>
                                                        {result.role}
                                                    </span>
                                                    <ExternalLink className="h-3 w-3 text-muted-foreground/20 group-hover:text-amber-500 transition-colors" />
                                                </div>
                                            </div>
                                            <p className="text-xs text-muted-foreground/60 leading-relaxed line-clamp-2">
                                                {highlightMatch(getSnippet(result.content, msgSearchQuery), msgSearchQuery)}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground/30 mt-1 flex items-center gap-1">
                                                <Clock className="h-2.5 w-2.5" />
                                                {formatDistanceToNow(new Date(result.created_at))} ago
                                            </p>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
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
                                                {user.full_name || user.username || "Unknown User"}
                                                <RoleBadge role={user.role} />
                                            </p>
                                            <p className="text-xs text-muted-foreground/50 mt-0.5">
                                                {user.chat_count} chat{user.chat_count !== 1 ? "s" : ""}
                                                {" · "}
                                                {user.project_count} project{user.project_count !== 1 ? "s" : ""}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                        {user.isLoading ? (
                                            <Loader2 className="h-4 w-4 text-amber-500 animate-spin mr-2" />
                                        ) : (
                                            <span className="text-xs bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-md">
                                                {user.chat_count}
                                            </span>
                                        )}
                                        {userExpanded
                                            ? <ChevronDown className="h-4 w-4 text-muted-foreground/40" />
                                            : <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                                        }
                                    </div>
                                </button>

                                {/* ── Expanded: project groups ───────────── */}
                                {userExpanded && user.isLoaded && user.projects && (
                                    <div className="border-t border-border/20 divide-y divide-border/10 bg-background/40">
                                        {user.projects.length === 0 ? (
                                            <div className="py-8 text-center text-sm text-muted-foreground/60">
                                                No chats found
                                            </div>
                                        ) : user.projects.map(proj => {
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
