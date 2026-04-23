"use client";

import { useState, useRef, useCallback } from "react";
import {
    Eye, Search, MessageSquare, User, ChevronDown, ChevronRight,
    ArrowLeft, Clock, Filter, FolderOpen, ExternalLink, Inbox, Loader2, X, FileSearch,
    CalendarDays, Repeat2, AlertTriangle, Info
} from "lucide-react";
import { formatDistanceToNow, subDays, format } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
    UserAggregate,
    getOmnivisionChatsForUser,
    searchOmnivisionMessages,
    MessageSearchResult,
    getAbmRunCountsByUser,
    getAbmRunsForChat,
    getFlaggedAbmChats,
    AbmRunCountsByUser,
    AbmRunForChat,
    FlaggedAbmChat,
} from "@/lib/actions/admin";
import { SENTINEL_ORPHAN_USER_ID, SEARCH_TIMEOUT_SENTINEL } from "@/lib/omnivision-constants";

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
    // ABM reuse signal for this user in the selected window. Populated by
    // the same initial fetch + date-filter flow as `chat_count`. When
    // `chats_with_reuse > 0`, the UI paints a reuse badge on this row.
    abmReuse?: AbmRunCountsByUser;
}

type DatePreset = "all" | "today" | "7d" | "30d" | "custom";

export function OmnivisionDashboard({
    initialAggregates,
    initialAbmReuse = [],
}: {
    initialAggregates: UserAggregate[];
    initialAbmReuse?: AbmRunCountsByUser[];
}) {
    const [searchQuery, setSearchQuery] = useState("");
    const [filterRole, setFilterRole] = useState("all");
    const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

    const [users, setUsers] = useState<Record<string, UserState>>(() => {
        // Index the ABM reuse data by user_id once so we can splice it into
        // every user row's initial state without a per-row lookup.
        const reuseMap: Record<string, AbmRunCountsByUser> = {};
        for (const r of initialAbmReuse) reuseMap[r.user_id] = r;

        const init: Record<string, UserState> = {};
        for (const u of initialAggregates) {
            init[u.user_id] = { ...u, projects: [], abmReuse: reuseMap[u.user_id] };
        }
        return init;
    });

    // Per-chat run counts, populated lazily when a user is expanded.
    // Keyed by chat_id so we can stamp a reuse badge on individual chats
    // without re-fetching on every toggle.
    const [chatAbmRuns, setChatAbmRuns] = useState<Record<string, AbmRunForChat[]>>({});

    // ── Date filter state ──────────────────────────────────────────────
    const [datePreset, setDatePreset] = useState<DatePreset>("all");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [showDatePicker, setShowDatePicker] = useState(false);
    // Whether the "what does this reuse number mean?" panel is open.
    // Defaulted to closed so it doesn't crowd the header on load, but a
    // one-click toggle gives any viewer a full explanation.
    const [showReuseHelp, setShowReuseHelp] = useState(false);

    // Flagged-chats drill-down sheet state. Lazily fetches the list the
    // first time it's opened for a given window; cached until the window
    // changes (via applyDateFilter) or the user manually refreshes.
    const [showFlaggedSheet, setShowFlaggedSheet] = useState(false);
    const [flaggedChats, setFlaggedChats] = useState<FlaggedAbmChat[] | null>(null);
    const [flaggedLoading, setFlaggedLoading] = useState(false);
    const [flaggedSort, setFlaggedSort] = useState<"runs" | "recent">("runs");
    const [flaggedQuery, setFlaggedQuery] = useState("");
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
            // Fetch aggregates and ABM reuse for the new window in parallel
            // so the badge state stays in sync with the chat counts.
            const [newAggregates, newAbmReuse] = await Promise.all([
                getOmnivisionUserAggregates(from, to),
                getAbmRunCountsByUser(from, to),
            ]);

            const reuseMap: Record<string, AbmRunCountsByUser> = {};
            for (const r of newAbmReuse) reuseMap[r.user_id] = r;

            const updated: Record<string, UserState> = {};
            for (const u of newAggregates) {
                updated[u.user_id] = { ...u, projects: [], abmReuse: reuseMap[u.user_id] };
            }
            setUsers(updated);
            // Drop per-chat run cache — stale once the window shifts.
            setChatAbmRuns({});
            // Drop the flagged-chats list too; it was scoped to the old
            // window. It will re-fetch next time the sheet is opened.
            setFlaggedChats(null);
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
    // Distinct error state so the empty-list UI can tell "DB returned 0 rows"
    // apart from "DB call failed / timed out". Previously the catch block
    // silently swallowed timeouts and the UI rendered "No messages found",
    // which was actively misleading when the real issue was the ILIKE
    // sequential scan exceeding statement_timeout.
    const [msgSearchError, setMsgSearchError] = useState<"timeout" | "generic" | null>(null);
    const [showMsgSearch, setShowMsgSearch] = useState(false);
    const msgSearchTimer = useRef<NodeJS.Timeout | null>(null);

    const handleMsgSearch = useCallback((value: string) => {
        setMsgSearchQuery(value);
        if (msgSearchTimer.current) clearTimeout(msgSearchTimer.current);

        if (value.trim().length < 2) {
            setMsgSearchResults([]);
            setMsgSearchLoading(false);
            setMsgSearchError(null);
            return;
        }

        setMsgSearchLoading(true);
        setMsgSearchError(null);
        msgSearchTimer.current = setTimeout(async () => {
            try {
                const results = await searchOmnivisionMessages(value);
                setMsgSearchResults(results);
                setMsgSearchError(null);
            } catch (err) {
                console.error("Message search failed:", err);
                setMsgSearchResults([]);
                // Sentinel from the server action. Matching on message is
                // resilient to Next.js' dev-mode error wrapping, which
                // sometimes prefixes the text with "Server Error: …".
                const msg = err instanceof Error ? err.message : String(err);
                setMsgSearchError(msg.includes(SEARCH_TIMEOUT_SENTINEL) ? "timeout" : "generic");
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

    // Window-level ABM reuse roll-up, computed from the per-user reuse
    // metrics that accompany the current aggregate view. Gives super
    // admins a one-glance "are users abusing chat reuse this period?"
    // signal without drilling into individual rows.
    const reuseSummary = allUsersList.reduce(
        (acc, u) => {
            const r = u.abmReuse;
            if (!r) return acc;
            acc.totalRuns += Number(r.run_count) || 0;
            acc.totalAccounts += Number(r.distinct_accounts) || 0;
            acc.chatsWithReuse += Number(r.chats_with_reuse) || 0;
            acc.usersWithReuse += Number(r.chats_with_reuse) > 0 ? 1 : 0;
            acc.worstChatRuns = Math.max(acc.worstChatRuns, Number(r.max_runs_in_one_chat) || 0);
            return acc;
        },
        { totalRuns: 0, totalAccounts: 0, chatsWithReuse: 0, usersWithReuse: 0, worstChatRuns: 0 }
    );

    // ── Flagged-chats sheet opener ───────────────────────────────────────
    // Opens the right-side drill-down sheet, lazily fetching the list on
    // first open for the currently selected window. Cached in
    // `flaggedChats`; reset to null whenever the date filter changes.
    const openFlaggedChats = useCallback(async () => {
        setShowFlaggedSheet(true);
        if (flaggedChats !== null) return; // already loaded for this window
        setFlaggedLoading(true);
        try {
            const range = getDateRange();
            const rows = await getFlaggedAbmChats(range.from, range.to);
            setFlaggedChats(rows);
        } catch (err) {
            console.error("Failed to load flagged chats", err);
            setFlaggedChats([]);
        } finally {
            setFlaggedLoading(false);
        }
    }, [flaggedChats, getDateRange]);

    // Click a user's reuse pill → expand that user so their reused chats
    // (each carrying a red per-chat badge) become visible inline. Smooth-
    // scrolls to the user row after the expand animation.
    const jumpToUser = useCallback((uid: string) => {
        if (!expandedUsers.has(uid)) {
            toggleUser(uid);
        }
        // Next tick so the expanded DOM exists before we try to scroll.
        setTimeout(() => {
            const el = document.getElementById(`om-user-${uid}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expandedUsers]);

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

                // If this user has any reused chats in the window, fetch
                // per-chat ABM run data for every chat we just loaded so
                // the reuse badges can render without a per-click fetch.
                // Capped at 50 chats of concurrency to avoid hammering the
                // RPC for heavy users.
                const chatIds: string[] = fetchedChats
                    .map((c: { id: string }) => c.id)
                    .filter((id: string) => !(id in chatAbmRuns));
                if (chatIds.length > 0 && users[uid]?.abmReuse?.run_count) {
                    const results = await Promise.all(
                        chatIds.slice(0, 50).map(async (cid: string) => {
                            try {
                                const runs = await getAbmRunsForChat(cid);
                                return [cid, runs] as const;
                            } catch {
                                return [cid, [] as AbmRunForChat[]] as const;
                            }
                        })
                    );
                    setChatAbmRuns(prev => {
                        const next = { ...prev };
                        for (const [cid, runs] of results) next[cid] = runs;
                        return next;
                    });
                }
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

    // Surface when a user has reused a single chat_id for multiple ABM runs
    // against different Salesforce accounts — the exact pattern we want to
    // discourage (context bloat, cross-contamination, broken per-account
    // attribution). Tooltip explains what "reused" means in plain language
    // so a viewer doesn't need any external docs to interpret it.
    const ReuseUserBadge = ({ reuse, userId }: { reuse: AbmRunCountsByUser; userId: string }) => {
        if (!reuse || !reuse.chats_with_reuse || Number(reuse.chats_with_reuse) <= 0) return null;
        const chatsWithReuse = Number(reuse.chats_with_reuse);
        const maxRuns = Number(reuse.max_runs_in_one_chat);
        const tip =
            `Click to open this person's conversations below. The reused ones carry the same red badge.\n\n` +
            `${chatsWithReuse} of this person's conversations were reused for more than one Salesforce account.\n\n` +
            `Worst conversation: ${maxRuns} ABMs stacked into a single session.\n\n` +
            `Why this matters: each extra ABM in the same conversation wastes budget (later ` +
            `ABMs re-read everything that came before), risks one account's content leaking into ` +
            `another's emails, and makes per-account results impossible to separate. ` +
            `Expected value: 0.`;
        // NOTE: rendered as a <span role="button"> rather than a real <button>
        // because the parent user-row is already a <button> (click to
        // expand/collapse), and HTML forbids nested <button> elements.
        // role=button + tabIndex + Enter/Space handler gives us the same
        // keyboard/a11y story without the DOM violation. stopPropagation
        // prevents click from bubbling to the outer expand handler.
        const handle = (e: React.SyntheticEvent) => {
            e.stopPropagation();
            jumpToUser(userId);
        };
        return (
            <span
                role="button"
                tabIndex={0}
                onClick={handle}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handle(e);
                    }
                }}
                title={tip}
                aria-label={`Open ${chatsWithReuse} reused chats for this person, worst is ${maxRuns} runs`}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/25 hover:bg-rose-500/25 hover:text-rose-200 font-medium leading-none flex-shrink-0 cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500/40"
            >
                <Repeat2 className="h-3 w-3" />
                {chatsWithReuse} reused · max {maxRuns}
            </span>
        );
    };

    // Per-chat reuse badge. Appears on a chat row when that single chat
    // produced more than one ABM run. A marker-row count is higher-trust
    // than a heuristic-row count; tooltip discloses which and lists the
    // accounts so a viewer can eyeball cross-contamination risk.
    const ReuseChatBadge = ({ runs }: { runs: AbmRunForChat[] | undefined }) => {
        if (!runs || runs.length <= 1) return null;
        const distinctAccounts = new Set(runs.map(r => r.account_id)).size;
        const accountsPreview = Array.from(new Set(runs.map(r => r.account_id)))
            .slice(0, 5)
            .join(", ");
        const moreAccts = distinctAccounts > 5 ? ` (+${distinctAccounts - 5} more)` : "";
        const tip =
            `This single conversation was used to run ${runs.length} ABMs across ${distinctAccounts} ` +
            `Salesforce account${distinctAccounts === 1 ? "" : "s"}.\n\n` +
            `Accounts: ${accountsPreview}${moreAccts}\n\n` +
            `Expected: 1 ABM per conversation. Anything higher means the same conversation was ` +
            `reused for another account instead of starting a new one.`;
        return (
            <span
                title={tip}
                aria-label={`${runs.length} ABM runs in this chat across ${distinctAccounts} accounts`}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/25 font-medium leading-none flex-shrink-0 cursor-help"
            >
                <Repeat2 className="h-3 w-3" />
                {runs.length} runs · {distinctAccounts} accts
            </span>
        );
    };

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
                    <div className="flex items-center gap-5 text-sm flex-wrap">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            <strong className="text-foreground">{totalUsers}</strong> users
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <MessageSquare className="h-3.5 w-3.5 opacity-50" />
                            <strong className="text-foreground">{totalChats}</strong> chats
                        </span>
                        {reuseSummary.chatsWithReuse > 0 && (
                            <span className="flex items-center gap-1.5 text-rose-400">
                                <AlertTriangle className="h-3.5 w-3.5 opacity-70" />
                                {/* Main action: open the drill-down sheet listing every flagged chat. */}
                                <button
                                    type="button"
                                    onClick={openFlaggedChats}
                                    className="flex items-center gap-1.5 text-rose-400 hover:text-rose-200 transition-colors cursor-pointer underline-offset-4 hover:underline"
                                    title="Click to see the list of conversations flagged for reuse, with a link to open each"
                                >
                                    <strong className="text-rose-300">{reuseSummary.chatsWithReuse}</strong>
                                    &nbsp;chat{reuseSummary.chatsWithReuse === 1 ? "" : "s"} reused for multi-account ABM
                                    <span className="text-muted-foreground/50">
                                        {" "}(worst: {reuseSummary.worstChatRuns} runs)
                                    </span>
                                </button>
                                {/* Secondary action: toggle the inline explainer. Kept as a */}
                                {/* separate affordance so the primary click goes straight to */}
                                {/* the actionable list. */}
                                <button
                                    type="button"
                                    onClick={() => setShowReuseHelp(v => !v)}
                                    className="text-muted-foreground/60 hover:text-foreground transition-colors"
                                    title="What does this mean?"
                                    aria-expanded={showReuseHelp}
                                    aria-label="Show explanation"
                                >
                                    <Info className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        )}
                    </div>

                    {/* Explainer panel — one-click toggle from the reuse strip above. */}
                    {showReuseHelp && reuseSummary.chatsWithReuse > 0 && (
                        <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4 text-xs leading-relaxed text-foreground/80 space-y-2.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-2 text-rose-300 font-semibold">
                                    <AlertTriangle className="h-4 w-4" />
                                    What does &quot;reused for multi-account ABM&quot; mean?
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowReuseHelp(false)}
                                    className="text-muted-foreground/60 hover:text-foreground"
                                    aria-label="Close"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            <p>
                                Each ABM conversation is meant to focus on <strong>one Salesforce account</strong> —
                                the agent researches that account, drafts its emails, and pushes its contacts into
                                Lemlist. A <strong>reused</strong> conversation is one where someone ran ABMs for
                                <strong> two or more accounts inside the same conversation </strong>
                                instead of starting a fresh one for each. This dashboard surfaces when that happens.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
                                <div className="rounded-lg bg-background/40 border border-border/30 px-3 py-2">
                                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                                        Badge next to a name <span className="text-rose-400">🔁 N reused · max M</span>
                                    </div>
                                    <p className="text-[11px]">
                                        <strong>N</strong> = how many of this person&apos;s conversations were used for
                                        more than one account.
                                        <br />
                                        <strong>M</strong> = the worst offender&apos;s count. M = 9 means a single
                                        conversation was reused for 9 different accounts.
                                    </p>
                                </div>
                                <div className="rounded-lg bg-background/40 border border-border/30 px-3 py-2">
                                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                                        Line below the name <span className="text-rose-400">&quot;N ABM runs across M accounts&quot;</span>
                                    </div>
                                    <p className="text-[11px]">
                                        Total ABMs this person ran in the selected period, across how many distinct
                                        accounts. This is a volume stat — high numbers aren&apos;t bad by themselves.
                                        Only the badge above flags a problem.
                                    </p>
                                </div>
                                <div className="rounded-lg bg-background/40 border border-border/30 px-3 py-2">
                                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                                        Badge on a conversation <span className="text-rose-400">🔁 N runs · A accts</span>
                                    </div>
                                    <p className="text-[11px]">
                                        Shown on individual conversations after expanding a user. Hover it to see which
                                        Salesforce accounts were stacked into that one conversation.
                                    </p>
                                </div>
                                <div className="rounded-lg bg-background/40 border border-border/30 px-3 py-2">
                                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                                        Why it matters
                                    </div>
                                    <p className="text-[11px]">
                                        Stacking multiple accounts into one conversation wastes budget (later accounts
                                        re-read earlier work), risks one account&apos;s content leaking into another&apos;s
                                        emails, and makes it impossible to measure cost or results per account.
                                    </p>
                                </div>
                            </div>
                            <p className="text-muted-foreground/60 text-[11px] pt-1">
                                Counts reflect the date range selected above. Older activity is reconstructed from past
                                conversations; new activity is tracked as it happens.
                            </p>
                        </div>
                    )}

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

                            {!msgSearchLoading && msgSearchError === "timeout" && (
                                <div className="py-4 px-3 text-xs text-rose-300/90 bg-rose-500/5 border border-rose-500/20 rounded-md">
                                    <div className="font-medium mb-0.5">Search timed out</div>
                                    <div className="text-muted-foreground/70">
                                        The server took too long to respond. Try a more specific query
                                        (longer substring or a unique ID) and retry.
                                    </div>
                                </div>
                            )}

                            {!msgSearchLoading && msgSearchError === "generic" && (
                                <div className="py-4 px-3 text-xs text-rose-300/90 bg-rose-500/5 border border-rose-500/20 rounded-md">
                                    Search failed. Please try again in a moment.
                                </div>
                            )}

                            {!msgSearchLoading && !msgSearchError && msgSearchQuery.length >= 2 && msgSearchResults.length === 0 && (
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
                                id={`om-user-${user.user_id}`}
                                className="border border-border/30 rounded-xl overflow-hidden bg-card/40 backdrop-blur-sm hover:border-border/60 transition-colors scroll-mt-20"
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
                                                {user.abmReuse && <ReuseUserBadge reuse={user.abmReuse} userId={user.user_id} />}
                                            </p>
                                            <p className="text-xs text-muted-foreground/50 mt-0.5">
                                                {user.chat_count} chat{user.chat_count !== 1 ? "s" : ""}
                                                {" · "}
                                                {user.project_count} project{user.project_count !== 1 ? "s" : ""}
                                                {user.abmReuse && Number(user.abmReuse.run_count) > 0 && (
                                                    <>
                                                        {" · "}
                                                        <span
                                                            className="text-rose-400/70 cursor-help"
                                                            title={
                                                                `Total ABMs this person has run in the selected period, and how many distinct ` +
                                                                `Salesforce accounts they worked on. This is a volume stat — high numbers aren't ` +
                                                                `bad on their own. Only the badge next to the name flags actual reuse problems.`
                                                            }
                                                        >
                                                            {user.abmReuse.run_count} ABM run{Number(user.abmReuse.run_count) === 1 ? "" : "s"}
                                                            {" "}across {user.abmReuse.distinct_accounts} account{Number(user.abmReuse.distinct_accounts) === 1 ? "" : "s"}
                                                        </span>
                                                    </>
                                                )}
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
                                                                                <ReuseChatBadge runs={chatAbmRuns[chat.id]} />
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

            {/* ── Flagged chats side-sheet ─────────────────────────────── */}
            {showFlaggedSheet && (
                <FlaggedChatsSheet
                    chats={flaggedChats}
                    loading={flaggedLoading}
                    sort={flaggedSort}
                    query={flaggedQuery}
                    onSortChange={setFlaggedSort}
                    onQueryChange={setFlaggedQuery}
                    onClose={() => setShowFlaggedSheet(false)}
                    windowLabel={dateLabel()}
                />
            )}
        </div>
    );
}

/**
 * Right-side slide-in sheet listing every chat flagged for multi-account
 * ABM reuse in the current window. Each row offers a direct link that
 * opens the chat in a new tab so the super-admin's audit state (search
 * query, expanded users) stays intact.
 *
 * Receives pre-fetched data; parent handles loading/caching so clicking
 * in and out of the sheet doesn't refetch.
 */
function FlaggedChatsSheet({
    chats,
    loading,
    sort,
    query,
    onSortChange,
    onQueryChange,
    onClose,
    windowLabel,
}: {
    chats: FlaggedAbmChat[] | null;
    loading: boolean;
    sort: "runs" | "recent";
    query: string;
    onSortChange: (s: "runs" | "recent") => void;
    onQueryChange: (q: string) => void;
    onClose: () => void;
    windowLabel: string;
}) {
    // Apply sort + filter locally (list is small, <500 rows by RPC limit).
    const visible = (() => {
        if (!chats) return [];
        const q = query.trim().toLowerCase();
        const filtered = q
            ? chats.filter(c =>
                (c.owner_username || "").toLowerCase().includes(q) ||
                (c.owner_full_name || "").toLowerCase().includes(q) ||
                (c.chat_title || "").toLowerCase().includes(q) ||
                (c.project_name || "").toLowerCase().includes(q) ||
                c.account_ids.some(a => a.toLowerCase().includes(q))
            )
            : chats;
        if (sort === "recent") {
            return [...filtered].sort(
                (a, b) => new Date(b.last_run_at).getTime() - new Date(a.last_run_at).getTime()
            );
        }
        // "runs" (default): backend already returns this order, but resort in
        // case the filter changed the visible set.
        return [...filtered].sort((a, b) =>
            Number(b.runs) - Number(a.runs) ||
            new Date(b.last_run_at).getTime() - new Date(a.last_run_at).getTime()
        );
    })();

    const chatHref = (c: FlaggedAbmChat) =>
        c.project_id ? `/projects/${c.project_id}/chat/${c.chat_id}` : `/chat/${c.chat_id}`;

    return (
        <>
            {/* Backdrop — click to close */}
            <div
                className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm animate-in fade-in-0 duration-200"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Panel */}
            <aside
                role="dialog"
                aria-modal="true"
                aria-label="Conversations reused for multiple ABM accounts"
                className="fixed right-0 top-0 z-50 h-screen w-full sm:w-[540px] lg:w-[640px] bg-background border-l border-border/30 shadow-2xl shadow-black/40 flex flex-col animate-in slide-in-from-right-4 duration-200"
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 p-4 border-b border-border/30">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold flex items-center gap-2 text-rose-300">
                            <Repeat2 className="h-4 w-4" />
                            Conversations reused for multiple ABM accounts
                        </h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Each conversation below was used to run ABMs for 2 or more Salesforce accounts.
                            Open a chat to review the context and decide if content leaked between accounts.
                        </p>
                        <p className="text-[11px] text-muted-foreground/60 mt-1">
                            {windowLabel}
                            {chats !== null && ` · ${visible.length} of ${chats.length} shown`}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-muted-foreground/60 hover:text-foreground flex-shrink-0"
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-2 p-3 border-b border-border/20">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search by user, chat title, project, or account ID…"
                            value={query}
                            onChange={e => onQueryChange(e.target.value)}
                            className="w-full bg-muted/30 border border-border/20 rounded-lg py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-rose-500/30 placeholder:text-muted-foreground/30"
                        />
                    </div>
                    <div className="flex bg-muted/30 border border-border/20 rounded-lg overflow-hidden">
                        <button
                            type="button"
                            onClick={() => onSortChange("runs")}
                            className={cn(
                                "px-2.5 py-1.5 text-[11px] transition-colors",
                                sort === "runs"
                                    ? "bg-rose-500/20 text-rose-300"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                            title="Sort by most runs first"
                        >
                            Most runs
                        </button>
                        <button
                            type="button"
                            onClick={() => onSortChange("recent")}
                            className={cn(
                                "px-2.5 py-1.5 text-[11px] transition-colors",
                                sort === "recent"
                                    ? "bg-rose-500/20 text-rose-300"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                            title="Sort by most recent activity"
                        >
                            Recent
                        </button>
                    </div>
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto">
                    {loading && (
                        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading flagged chats…
                        </div>
                    )}
                    {!loading && chats !== null && chats.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16 text-center px-8">
                            <div className="text-4xl mb-3">🎉</div>
                            <p className="text-sm text-foreground/80 font-medium">
                                No multi-account reuse in this window
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Every ABM ran in its own clean conversation.
                            </p>
                        </div>
                    )}
                    {!loading && chats !== null && visible.length === 0 && chats.length > 0 && (
                        <div className="py-16 text-center text-sm text-muted-foreground">
                            No matches for <span className="text-foreground/80 font-mono">{query}</span>
                        </div>
                    )}
                    {!loading && visible.length > 0 && (
                        <div className="divide-y divide-border/10">
                            {visible.map(c => (
                                <FlaggedChatRow key={c.chat_id} chat={c} href={chatHref(c)} />
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer hint */}
                <div className="border-t border-border/20 px-4 py-2.5 text-[11px] text-muted-foreground/60">
                    Expected value per conversation: 1 run. Anything higher means the same conversation
                    was reused for another account instead of starting a new one.
                </div>
            </aside>
        </>
    );
}

function FlaggedChatRow({ chat, href }: { chat: FlaggedAbmChat; href: string }) {
    const runs = Number(chat.runs);
    const accts = Number(chat.distinct_accounts);
    const accountsPreview = chat.account_ids.slice(0, 3).join(", ");
    const moreAccts = accts > 3 ? ` +${accts - 3} more` : "";
    const firstAt = chat.first_run_at ? new Date(chat.first_run_at) : null;
    const lastAt = chat.last_run_at ? new Date(chat.last_run_at) : null;
    const ownerName = chat.owner_full_name || chat.owner_username || "(unknown)";

    return (
        <div className="p-3.5 hover:bg-rose-500/5 transition-colors">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    {/* Title + severity pill */}
                    <div className="flex items-start gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground/90 truncate">
                            {chat.chat_title || "Untitled chat"}
                        </p>
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold leading-none flex-shrink-0">
                            <Repeat2 className="h-3 w-3" />
                            {runs} runs · {accts} accts
                        </span>
                    </div>
                    {/* Owner + project */}
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <User className="h-3 w-3 opacity-50" />
                        <span className="text-foreground/70">{ownerName}</span>
                        {chat.owner_role === "super_admin" && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-500 border border-amber-500/30 leading-none">SUPER</span>
                        )}
                        {chat.owner_role === "admin" && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 leading-none">ADMIN</span>
                        )}
                        {chat.project_name && (
                            <>
                                <span className="text-muted-foreground/40">·</span>
                                <FolderOpen className="h-3 w-3 opacity-50" />
                                <span className="text-foreground/60">{chat.project_name}</span>
                            </>
                        )}
                    </p>
                    {/* Accounts preview */}
                    <p
                        className="text-[11px] text-muted-foreground/70 mt-1 font-mono truncate"
                        title={`All accounts in this conversation: ${chat.account_ids.join(", ")}`}
                    >
                        Accounts: {accountsPreview}
                        <span className="text-muted-foreground/40">{moreAccts}</span>
                    </p>
                    {/* Time window */}
                    {(firstAt || lastAt) && (
                        <p className="text-[11px] text-muted-foreground/50 mt-1 flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {firstAt && format(firstAt, "MMM d HH:mm")}
                            {firstAt && lastAt && firstAt.getTime() !== lastAt.getTime() && (
                                <>
                                    {" "}→ {format(lastAt, "MMM d HH:mm")}
                                </>
                            )}
                        </p>
                    )}
                </div>
                {/* Open link */}
                <Link
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/25 transition-colors font-medium"
                    title="Open this conversation in a new tab"
                >
                    Open
                    <ExternalLink className="h-3 w-3" />
                </Link>
            </div>
        </div>
    );
}
