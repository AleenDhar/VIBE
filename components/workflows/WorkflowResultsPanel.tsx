"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    Users,
    ArrowRight,
    Copy,
    Check,
    ExternalLink,
    Mail,
    Linkedin,
    Download,
    Play,
    ChevronDown,
    ChevronRight,
    Shield,
    ShieldCheck,
    ShieldX,
    Zap,
    Target,
    FileJson,
    Eye,
    Code2,
    AlertTriangle,
    XCircle,
    CheckCircle2,
    Info,
    Lightbulb,
    MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

// ─── Markdown Renderer ──────────────────────────────────────────────

const mdComponents = {
    p: ({ node, ...props }: any) => <p className="mb-1.5 last:mb-0 leading-relaxed" {...props} />,
    strong: ({ node, ...props }: any) => <strong className="font-semibold text-foreground/90" {...props} />,
    em: ({ node, ...props }: any) => <em className="italic" {...props} />,
    ul: ({ node, ...props }: any) => <ul className="list-disc pl-5 mb-1.5 space-y-0.5 marker:text-muted-foreground" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="list-decimal pl-5 mb-1.5 space-y-0.5 marker:text-muted-foreground" {...props} />,
    li: ({ node, ...props }: any) => <li className="pl-0.5" {...props} />,
    h1: ({ node, ...props }: any) => <h3 className="font-semibold text-foreground mt-2 mb-1" {...props} />,
    h2: ({ node, ...props }: any) => <h3 className="font-semibold text-foreground mt-2 mb-1" {...props} />,
    h3: ({ node, ...props }: any) => <h4 className="font-semibold text-foreground mt-1.5 mb-0.5" {...props} />,
    hr: ({ node, ...props }: any) => <hr className="my-2 border-border/50" {...props} />,
    a: ({ node, ...props }: any) => <a className="text-primary hover:underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />,
    code: ({ node, ...props }: any) => <code className="bg-muted px-1 py-0.5 rounded text-[0.9em] font-mono" {...props} />,
    pre: ({ node, ...props }: any) => <pre className="bg-muted/50 p-2 rounded-md my-1.5 overflow-x-auto border border-border/30 text-[11px]" {...props} />,
    blockquote: ({ node, ...props }: any) => <blockquote className="border-l-2 border-primary/30 pl-3 py-0.5 italic text-muted-foreground my-1.5" {...props} />,
    table: ({ node, ...props }: any) => <div className="overflow-x-auto my-2 rounded border border-border"><table className="w-full text-xs border-collapse" {...props} /></div>,
    thead: ({ node, ...props }: any) => <thead className="bg-muted text-muted-foreground uppercase text-[10px] tracking-wider" {...props} />,
    th: ({ node, ...props }: any) => <th className="px-2 py-1.5 font-medium text-left" {...props} />,
    td: ({ node, ...props }: any) => <td className="px-2 py-1.5 border-t border-border/30" {...props} />,
};

function CompactMarkdown({ children, className = "" }: { children: string; className?: string }) {
    return (
        <div className={className}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {children}
            </ReactMarkdown>
        </div>
    );
}

// ─── Types ──────────────────────────────────────────────────────────

interface NodeRunData {
    input?: { structured: any; text: string } | null;
    output?: { structured: any; text: string } | null;
}

interface NodeLog {
    nodeId: string;
    label: string;
    status: "running" | "completed" | "failed";
    output?: string;
    error?: string;
    timestamp: string;
    hasStructuredOutput?: boolean;
    durationMs?: number;
    aiSummary?: string;
}

interface PipelineStage {
    nodeId: string;
    label: string;
    contactCount: number;
    icon: "discovery" | "validation" | "outreach";
    status: "completed" | "failed" | "skipped";
    summary: string;
    error?: string;
    durationMs?: number;
    aiSummary?: string;
    aiText?: string;
}

interface Contact {
    name: string;
    title: string;
    company: string;
    email?: string;
    linkedin_url?: string;
    phone?: string;
    priority?: string;
    score?: number;
    email_verified?: boolean;
    linkedin_validated?: boolean;
    outreach_snippet?: string;
    [key: string]: any;
}

interface WorkflowResultsPanelProps {
    nodeRunDataMap: Record<string, NodeRunData>;
    nodeOrder: { id: string; label: string; type: string }[];
    nodeLogs: NodeLog[];
    onRerun?: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────

function extractContacts(structured: any): Contact[] {
    if (!structured || typeof structured !== "object") return [];

    for (const key of ["top_contacts", "contacts", "outreach_sequences", "leads", "results", "selected_contacts", "enriched_contacts"]) {
        if (Array.isArray(structured[key]) && structured[key].length > 0) {
            return structured[key].map(normalizeContact);
        }
    }

    for (const val of Object.values(structured)) {
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && val[0] !== null) {
            const first = val[0] as any;
            if (first.name || first.full_name || first.firstName || first.email || first.title) {
                return (val as any[]).map(normalizeContact);
            }
        }
    }

    return [];
}

function normalizeContact(raw: any): Contact {
    return {
        name: raw.name || raw.full_name || `${raw.firstName || ""} ${raw.lastName || ""}`.trim() || "Unknown",
        title: raw.title || raw.job_title || raw.role || raw.designation || "",
        company: raw.company || raw.company_name || raw.organization || "",
        email: raw.email || raw.email_address || "",
        linkedin_url: raw.linkedin_url || raw.linkedin || raw.linkedinUrl || "",
        phone: raw.phone || raw.phone_number || "",
        priority: raw.priority || raw.tier || (raw.score ? (raw.score >= 8 ? "High" : raw.score >= 5 ? "Medium" : "Low") : ""),
        score: raw.score || raw.relevance_score || raw.priority_score || undefined,
        email_verified: raw.email_verified ?? raw.emailVerified ?? undefined,
        linkedin_validated: raw.linkedin_validated ?? raw.linkedinValidated ?? undefined,
        outreach_snippet: raw.outreach_snippet || raw.email_body || raw.message || raw.personalized_message || "",
        ...raw,
    };
}

function extractContactCount(structured: any): number {
    const contacts = extractContacts(structured);
    if (contacts.length > 0) return contacts.length;
    if (structured?.validation_summary?.confirmed_active) return structured.validation_summary.confirmed_active;
    if (structured?.total_contacts) return structured.total_contacts;
    if (structured?.contact_count) return structured.contact_count;
    return 0;
}

function getStageIcon(index: number, total: number) {
    if (index === 0) return "discovery" as const;
    if (index === total - 1) return "outreach" as const;
    return "validation" as const;
}

/** Generate a plain-English summary for a node's output */
function generateNodeSummary(label: string, structured: any, text: string, stageType: "discovery" | "validation" | "outreach"): string {
    if (!structured && !text) return "No output produced.";

    const contacts = extractContacts(structured);
    const contactCount = contacts.length || extractContactCount(structured);

    // Try to pull specific summary fields from the structured data
    const summary = structured?.summary || structured?.execution_summary || structured?.validation_summary;

    if (stageType === "discovery") {
        if (contactCount > 0) {
            const company = contacts[0]?.company || structured?.account_name || structured?.company || "the target account";
            const titles = [...new Set(contacts.slice(0, 5).map((c: Contact) => c.title).filter(Boolean))];
            const titleStr = titles.length > 0 ? ` including ${titles.slice(0, 3).join(", ")}` : "";
            return `Found ${contactCount} contact${contactCount !== 1 ? "s" : ""} at ${company}${titleStr}.`;
        }
        if (summary) return typeof summary === "string" ? summary : JSON.stringify(summary);
        return text ? text.slice(0, 200).trim() + (text.length > 200 ? "..." : "") : "Discovery completed.";
    }

    if (stageType === "validation") {
        if (structured?.validation_summary) {
            const vs = structured.validation_summary;
            const parts: string[] = [];
            if (vs.confirmed_active) parts.push(`${vs.confirmed_active} confirmed active`);
            if (vs.not_found) parts.push(`${vs.not_found} not found`);
            if (vs.linkedin_coverage) parts.push(`${vs.linkedin_coverage} LinkedIn coverage`);
            return parts.length > 0
                ? `Validated contacts: ${parts.join(", ")}.`
                : `Validated ${contactCount} contact${contactCount !== 1 ? "s" : ""}.`;
        }
        if (contactCount > 0) {
            const verified = contacts.filter((c) => c.linkedin_validated || c.email_verified).length;
            return `Processed ${contactCount} contact${contactCount !== 1 ? "s" : ""}, ${verified} verified with LinkedIn or email.`;
        }
        return text ? text.slice(0, 200).trim() + (text.length > 200 ? "..." : "") : "Validation completed.";
    }

    if (stageType === "outreach") {
        if (contactCount > 0) {
            const withSnippet = contacts.filter((c) => c.outreach_snippet).length;
            if (withSnippet > 0) {
                return `Prepared personalized outreach for ${withSnippet} contact${withSnippet !== 1 ? "s" : ""}, ready to push.`;
            }
            return `Selected top ${contactCount} contact${contactCount !== 1 ? "s" : ""} for outreach.`;
        }
        return text ? text.slice(0, 200).trim() + (text.length > 200 ? "..." : "") : "Outreach preparation completed.";
    }

    return "Step completed.";
}

/** Generate troubleshooting hints for errors */
function getTroubleshootingHints(error: string, nodeLabel: string): string[] {
    const hints: string[] = [];
    const e = error.toLowerCase();

    if (e.includes("rate limit") || e.includes("429") || e.includes("over_request")) {
        hints.push("You've hit an API rate limit. Wait a few minutes and try again.");
        hints.push("If this keeps happening, try running the workflow during off-peak hours.");
    }
    if (e.includes("timeout") || e.includes("timed out") || e.includes("deadline")) {
        hints.push("The step took too long to complete. This usually means the AI was working on a large dataset.");
        hints.push("Try simplifying the input or breaking the task into smaller pieces.");
    }
    if (e.includes("token") || e.includes("context length") || e.includes("too long") || e.includes("8192")) {
        hints.push("The data passed to this step was too large for the AI to process in one go.");
        hints.push("Try limiting the number of contacts from the previous step.");
    }
    if (e.includes("no project") || e.includes("project not found") || e.includes("no workspace")) {
        hints.push("This node isn't connected to a project. Open it and assign a project.");
    }
    if (e.includes("chat") || e.includes("400") || e.includes("bad request")) {
        hints.push("There was a problem communicating with the AI. This is usually temporary.");
        hints.push("Try running the workflow again. If the problem persists, check the project's system instructions.");
    }
    if (e.includes("auth") || e.includes("unauthorized") || e.includes("session")) {
        hints.push("Your login session may have expired. Try refreshing the page and logging in again.");
    }

    if (hints.length === 0) {
        hints.push(`The "${nodeLabel}" step encountered an unexpected error.`);
        hints.push("Try running the workflow again. If this keeps happening, check the project's settings.");
    }

    return hints;
}

const stageColors = {
    discovery: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
    validation: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30" },
    outreach: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
};

const StageIcons = { discovery: Users, validation: Shield, outreach: Target };

const priorityConfig: Record<string, { color: string; bg: string }> = {
    high: { color: "text-rose-400", bg: "bg-rose-500/15" },
    critical: { color: "text-rose-400", bg: "bg-rose-500/15" },
    medium: { color: "text-amber-400", bg: "bg-amber-500/15" },
    low: { color: "text-emerald-400", bg: "bg-emerald-500/15" },
};

// ─── Pipeline Funnel ────────────────────────────────────────────────

function PipelineFunnel({ stages }: { stages: PipelineStage[] }) {
    const maxCount = Math.max(...stages.map((s) => s.contactCount), 1);

    return (
        <div className="px-4 py-4 border-b border-border/30">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Pipeline Summary</h4>
            <div className="flex items-center gap-2">
                {stages.map((stage, i) => {
                    const colors = stageColors[stage.icon];
                    const Icon = StageIcons[stage.icon];
                    const widthPct = Math.max((stage.contactCount / maxCount) * 100, 30);

                    return (
                        <div key={stage.nodeId} className="flex items-center gap-2 flex-1 min-w-0">
                            <div
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                                    stage.status === "failed"
                                        ? "bg-rose-500/10 border-rose-500/30"
                                        : `${colors.bg} ${colors.border}`
                                } transition-all`}
                                style={{ width: `${widthPct}%`, minWidth: "fit-content" }}
                            >
                                {stage.status === "failed" ? (
                                    <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                                ) : (
                                    <Icon className={`h-3.5 w-3.5 ${colors.text} shrink-0`} />
                                )}
                                <div className="min-w-0">
                                    <p className="text-[10px] text-muted-foreground truncate">{stage.label}</p>
                                    <p className={`text-sm font-bold ${stage.status === "failed" ? "text-rose-400" : colors.text}`}>
                                        {stage.status === "failed" ? "Error" : stage.contactCount}
                                    </p>
                                </div>
                            </div>
                            {i < stages.length - 1 && (
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Per-Node Readable Summary ──────────────────────────────────────

function formatDuration(ms?: number): string {
    if (!ms) return "";
    if (ms < 1000) return `${ms}ms`;
    const secs = Math.round(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}m ${remSecs}s`;
}

function NodeSummaryCards({ stages }: { stages: PipelineStage[] }) {
    const [expandedStage, setExpandedStage] = useState<string | null>(null);

    return (
        <div className="px-4 py-3 space-y-2 border-b border-border/30">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">What Happened</h4>
            {stages.map((stage, i) => {
                const colors = stageColors[stage.icon];
                const isFailed = stage.status === "failed";
                const isExpanded = expandedStage === stage.nodeId;
                const displaySummary = stage.aiSummary || stage.summary;
                const hasFullText = stage.aiText && stage.aiText.length > 0;

                return (
                    <div
                        key={stage.nodeId}
                        className={`rounded-lg border overflow-hidden ${
                            isFailed ? "bg-rose-500/5 border-rose-500/20" : "bg-muted/10 border-border/20"
                        }`}
                    >
                        <div
                            className={`flex items-start gap-3 px-3 py-2.5 ${hasFullText ? "cursor-pointer hover:bg-muted/20 transition-colors" : ""}`}
                            onClick={() => hasFullText && setExpandedStage(isExpanded ? null : stage.nodeId)}
                        >
                            <div className={`mt-0.5 h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
                                isFailed ? "bg-rose-500/15" : colors.bg
                            }`}>
                                {isFailed ? (
                                    <XCircle className="h-3.5 w-3.5 text-rose-400" />
                                ) : (
                                    <CheckCircle2 className={`h-3.5 w-3.5 ${colors.text}`} />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="text-xs font-medium text-foreground/90">
                                        Step {i + 1}: {stage.label}
                                    </p>
                                    {stage.durationMs && (
                                        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                                            {formatDuration(stage.durationMs)}
                                        </span>
                                    )}
                                </div>
                                <p className={`text-xs mt-0.5 leading-relaxed ${isFailed ? "text-rose-400/80" : "text-muted-foreground"}`}>
                                    {displaySummary}
                                </p>
                            </div>
                            {hasFullText && (
                                <div className="shrink-0 mt-1">
                                    {isExpanded ? (
                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />
                                    ) : (
                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Expanded: full AI response text */}
                        {isExpanded && stage.aiText && (
                            <div className="px-3 py-2.5 border-t border-border/20 bg-muted/5 animate-in fade-in duration-200">
                                <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                    <MessageSquare className="h-3 w-3" />
                                    Full AI Response
                                </p>
                                <CompactMarkdown className="text-xs text-foreground/70 max-h-[300px] overflow-y-auto">
                                    {stage.aiText}
                                </CompactMarkdown>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Error Panel ────────────────────────────────────────────────────

function ErrorPanel({ stages, nodeLogs }: { stages: PipelineStage[]; nodeLogs: NodeLog[] }) {
    const errors = useMemo(() => {
        const errs: { nodeLabel: string; error: string; hints: string[] }[] = [];

        // From stages
        for (const stage of stages) {
            if (stage.status === "failed" && stage.error) {
                errs.push({
                    nodeLabel: stage.label,
                    error: stage.error,
                    hints: getTroubleshootingHints(stage.error, stage.label),
                });
            }
        }

        // From nodeLogs (may have errors not in stages)
        for (const log of nodeLogs) {
            if (log.status === "failed" && log.error) {
                const alreadyAdded = errs.some((e) => e.nodeLabel === log.label);
                if (!alreadyAdded) {
                    errs.push({
                        nodeLabel: log.label,
                        error: log.error,
                        hints: getTroubleshootingHints(log.error, log.label),
                    });
                }
            }
        }

        return errs;
    }, [stages, nodeLogs]);

    if (errors.length === 0) return null;

    return (
        <div className="px-4 py-3 border-b border-border/30">
            <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                <h4 className="text-xs font-medium text-rose-400 uppercase tracking-wider">
                    {errors.length} Error{errors.length !== 1 ? "s" : ""} Found
                </h4>
            </div>
            <div className="space-y-2">
                {errors.map((err, i) => (
                    <div key={i} className="rounded-lg border border-rose-500/20 bg-rose-500/5 overflow-hidden">
                        <div className="px-3 py-2">
                            <p className="text-xs font-medium text-rose-400">{err.nodeLabel}</p>
                            <p className="text-[11px] text-rose-300/70 mt-0.5 font-mono break-all">{err.error}</p>
                        </div>
                        <div className="px-3 py-2 bg-rose-500/5 border-t border-rose-500/10">
                            <div className="flex items-center gap-1.5 mb-1">
                                <Lightbulb className="h-3 w-3 text-amber-400" />
                                <p className="text-[10px] font-medium text-amber-400 uppercase tracking-wider">How to fix</p>
                            </div>
                            <ul className="space-y-1">
                                {err.hints.map((hint, j) => (
                                    <li key={j} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                                        <span className="text-muted-foreground/40 mt-px">-</span>
                                        {hint}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Smart Contact Table ────────────────────────────────────────────

function ContactTable({ contacts }: { contacts: Contact[] }) {
    const [expandedRow, setExpandedRow] = useState<number | null>(null);

    if (contacts.length === 0) return null;

    return (
        <div>
            <div className="px-4 py-3 border-b border-border/30">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Contacts Ready — {contacts.length} total
                </h4>
            </div>
            <div className="divide-y divide-border/20">
                {contacts.map((contact, i) => {
                    const isExpanded = expandedRow === i;
                    const pConfig = priorityConfig[(contact.priority || "").toLowerCase()] || priorityConfig.medium;

                    return (
                        <div key={i} className="px-4 py-3 hover:bg-muted/10 transition-colors">
                            <div
                                className="flex items-start gap-3 cursor-pointer"
                                onClick={() => setExpandedRow(isExpanded ? null : i)}
                            >
                                {/* Avatar */}
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                                    <span className="text-xs font-bold text-primary">
                                        {contact.name
                                            .split(" ")
                                            .map((w: string) => w[0])
                                            .slice(0, 2)
                                            .join("")
                                            .toUpperCase()}
                                    </span>
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium truncate">{contact.name}</span>
                                        {contact.priority && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${pConfig.color} ${pConfig.bg}`}>
                                                {contact.priority}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {contact.title}{contact.title && contact.company ? " at " : ""}{contact.company}
                                    </p>

                                    {/* Quick badges */}
                                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                        {contact.email && (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                {contact.email_verified ? (
                                                    <ShieldCheck className="h-3 w-3 text-emerald-500" />
                                                ) : (
                                                    <Mail className="h-3 w-3" />
                                                )}
                                                <span className="truncate max-w-[140px]">{contact.email}</span>
                                            </span>
                                        )}
                                        {contact.linkedin_url && (
                                            <a
                                                href={contact.linkedin_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Linkedin className="h-3 w-3" />
                                                LinkedIn
                                                <ExternalLink className="h-2.5 w-2.5" />
                                            </a>
                                        )}
                                        {contact.phone && (
                                            <span className="text-[10px] text-muted-foreground">{contact.phone}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Expand */}
                                <div className="shrink-0 mt-1">
                                    {isExpanded ? (
                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                </div>
                            </div>

                            {/* Expanded detail */}
                            {isExpanded && (
                                <div className="mt-3 ml-11 space-y-2 animate-in fade-in duration-200">
                                    {contact.outreach_snippet && (
                                        <div className="rounded-md bg-muted/20 border border-border/20 p-3">
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                                                <MessageSquare className="h-3 w-3" />
                                                Draft Message
                                            </p>
                                            <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">
                                                {contact.outreach_snippet}
                                            </p>
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        {contact.score !== undefined && (
                                            <div className="text-[11px] flex items-center gap-1">
                                                <span className="text-muted-foreground">Relevance Score:</span>
                                                <span className="font-medium">{contact.score}/10</span>
                                            </div>
                                        )}
                                        {contact.linkedin_validated !== undefined && (
                                            <div className="text-[11px] flex items-center gap-1">
                                                <span className="text-muted-foreground">LinkedIn:</span>
                                                {contact.linkedin_validated ? (
                                                    <span className="text-emerald-400 flex items-center gap-0.5">
                                                        <ShieldCheck className="h-3 w-3" /> Verified
                                                    </span>
                                                ) : (
                                                    <span className="text-rose-400 flex items-center gap-0.5">
                                                        <ShieldX className="h-3 w-3" /> Not found
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {contact.email_verified !== undefined && (
                                            <div className="text-[11px] flex items-center gap-1">
                                                <span className="text-muted-foreground">Email:</span>
                                                {contact.email_verified ? (
                                                    <span className="text-emerald-400 flex items-center gap-0.5">
                                                        <ShieldCheck className="h-3 w-3" /> Verified
                                                    </span>
                                                ) : (
                                                    <span className="text-amber-400 flex items-center gap-0.5">
                                                        <Info className="h-3 w-3" /> Unverified
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Raw JSON View (toggleable) ─────────────────────────────────────

function RawJsonView({ data, label }: { data: any; label?: string }) {
    const [copied, setCopied] = useState(false);
    const jsonStr = JSON.stringify(data, null, 2);

    return (
        <div className="p-4">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {label || "Raw JSON Output"}
                </h4>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                        navigator.clipboard.writeText(jsonStr);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                    }}
                >
                    {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                </Button>
            </div>
            <pre className="text-[11px] text-muted-foreground bg-muted/20 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
                {jsonStr}
            </pre>
        </div>
    );
}

// ─── Readable Output (non-contact fallback) ─────────────────────────

function ReadableOutput({ structured, text }: { structured: any; text?: string }) {
    if (!structured && !text) return null;

    const renderValue = (value: any, depth: number = 0): React.ReactElement => {
        if (value === null || value === undefined) return <span className="text-muted-foreground/50">-</span>;
        if (typeof value === "boolean") return <span className={value ? "text-emerald-400" : "text-rose-400"}>{value ? "Yes" : "No"}</span>;
        if (typeof value === "number") return <span className="text-blue-400">{value}</span>;
        if (typeof value === "string") {
            if (value.startsWith("http")) {
                return (
                    <a href={value} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-xs break-all">
                        {value}
                    </a>
                );
            }
            return <span className="text-foreground/80">{value}</span>;
        }
        if (Array.isArray(value)) {
            if (value.length === 0) return <span className="text-muted-foreground/50">Empty list</span>;
            if (depth > 1) return <span className="text-muted-foreground">{value.length} items</span>;
            return (
                <ul className="space-y-0.5 ml-2">
                    {value.slice(0, 10).map((item, i) => (
                        <li key={i} className="text-xs">
                            {typeof item === "string" ? item : renderValue(item, depth + 1)}
                        </li>
                    ))}
                    {value.length > 10 && <li className="text-xs text-muted-foreground">...and {value.length - 10} more</li>}
                </ul>
            );
        }
        if (typeof value === "object" && depth < 2) {
            return (
                <div className="space-y-1 ml-2 mt-1">
                    {Object.entries(value).slice(0, 8).map(([k, v]) => (
                        <div key={k} className="flex items-start gap-2 text-xs">
                            <span className="text-muted-foreground shrink-0 capitalize">{k.replace(/_/g, " ")}:</span>
                            {renderValue(v, depth + 1)}
                        </div>
                    ))}
                </div>
            );
        }
        return <span className="text-muted-foreground">{JSON.stringify(value).slice(0, 100)}</span>;
    };

    if (structured && typeof structured === "object") {
        return (
            <div className="p-4 space-y-3">
                {Object.entries(structured).map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-border/20 bg-muted/10 p-3">
                        <p className="text-xs font-medium text-foreground/70 capitalize mb-1">
                            {key.replace(/_/g, " ")}
                        </p>
                        <div className="text-xs">{renderValue(value)}</div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="p-4">
            <CompactMarkdown className="text-sm text-foreground/80">
                {text || ""}
            </CompactMarkdown>
        </div>
    );
}

// ─── Action Bar ─────────────────────────────────────────────────────

function ActionBar({
    contacts,
    structuredData,
    onRerun,
}: {
    contacts: Contact[];
    structuredData: any;
    onRerun?: () => void;
}) {
    const [copiedCsv, setCopiedCsv] = useState(false);
    const [copiedJson, setCopiedJson] = useState(false);

    const copyAsCsv = () => {
        if (contacts.length === 0) return;
        const headers = ["Name", "Title", "Company", "Email", "LinkedIn", "Phone", "Priority"];
        const rows = contacts.map((c) => [c.name, c.title, c.company, c.email || "", c.linkedin_url || "", c.phone || "", c.priority || ""]);
        const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(","))].join("\n");
        navigator.clipboard.writeText(csv);
        setCopiedCsv(true);
        setTimeout(() => setCopiedCsv(false), 2000);
    };

    const copyAsJson = () => {
        navigator.clipboard.writeText(JSON.stringify(structuredData, null, 2));
        setCopiedJson(true);
        setTimeout(() => setCopiedJson(false), 2000);
    };

    return (
        <div className="border-t border-border/30 px-4 py-3 flex items-center gap-2 bg-background/80 backdrop-blur-sm">
            {contacts.length > 0 && (
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={copyAsCsv}>
                    {copiedCsv ? <Check className="h-3 w-3 text-emerald-500" /> : <Download className="h-3 w-3" />}
                    Copy CSV
                </Button>
            )}
            {structuredData && (
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={copyAsJson}>
                    {copiedJson ? <Check className="h-3 w-3 text-emerald-500" /> : <FileJson className="h-3 w-3" />}
                    Copy JSON
                </Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 opacity-50 cursor-not-allowed" disabled title="Coming soon">
                <Zap className="h-3 w-3" />
                Push to Lemlist
            </Button>
            {onRerun && (
                <Button variant="default" size="sm" className="h-7 text-xs gap-1.5" onClick={onRerun}>
                    <Play className="h-3 w-3" />
                    Re-run
                </Button>
            )}
        </div>
    );
}

// ─── Main Component ─────────────────────────────────────────────────

export function WorkflowResultsPanel({ nodeRunDataMap, nodeOrder, nodeLogs, onRerun }: WorkflowResultsPanelProps) {
    const [viewMode, setViewMode] = useState<"pretty" | "json">("pretty");

    const projectNodes = useMemo(
        () => nodeOrder.filter((n) => n.type === "project"),
        [nodeOrder]
    );

    // Build pipeline stages with summaries
    const stages: PipelineStage[] = useMemo(() => {
        return projectNodes.map((node, i) => {
            const runData = nodeRunDataMap[node.id];
            const structured = runData?.output?.structured;
            const text = runData?.output?.text || "";
            const count = extractContactCount(structured);
            const stageType = getStageIcon(i, projectNodes.length);
            const nodeLog = nodeLogs.find((l) => l.nodeId === node.id);
            const isFailed = nodeLog?.status === "failed";

            return {
                nodeId: node.id,
                label: node.label,
                contactCount: count,
                icon: stageType,
                status: isFailed ? "failed" as const : "completed" as const,
                summary: isFailed
                    ? `Failed: ${nodeLog?.error || "Unknown error"}`
                    : generateNodeSummary(node.label, structured, text, stageType),
                error: nodeLog?.error,
                durationMs: nodeLog?.durationMs,
                aiSummary: nodeLog?.aiSummary || undefined,
                aiText: text || undefined,
            };
        });
    }, [projectNodes, nodeRunDataMap, nodeLogs]);

    // Final node output
    const finalNode = projectNodes[projectNodes.length - 1];
    const finalRunData = finalNode ? nodeRunDataMap[finalNode.id] : null;
    const finalStructured = finalRunData?.output?.structured;
    const finalText = finalRunData?.output?.text || "";
    const finalContacts = useMemo(() => extractContacts(finalStructured), [finalStructured]);

    const hasErrors = stages.some((s) => s.status === "failed") || nodeLogs.some((l) => l.status === "failed");
    const hasAnyData = stages.some((s) => s.contactCount > 0) || finalStructured || hasErrors;

    if (!hasAnyData) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center space-y-2">
                    <Info className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                    <p className="text-sm text-muted-foreground">No results yet</p>
                    <p className="text-xs text-muted-foreground/60">Run the workflow to see results here</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* View mode toggle */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-muted/5">
                <div className="flex items-center gap-1 bg-muted/20 rounded-md p-0.5">
                    <button
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                            viewMode === "pretty"
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setViewMode("pretty")}
                    >
                        <Eye className="h-3 w-3" />
                        Pretty
                    </button>
                    <button
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                            viewMode === "json"
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setViewMode("json")}
                    >
                        <Code2 className="h-3 w-3" />
                        JSON
                    </button>
                </div>
                {!hasErrors && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        All steps completed
                    </span>
                )}
                {hasErrors && (
                    <span className="text-[10px] text-rose-400 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Completed with errors
                    </span>
                )}
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {viewMode === "json" ? (
                    /* JSON VIEW */
                    <RawJsonView
                        data={Object.fromEntries(
                            projectNodes.map((n) => [
                                n.label,
                                {
                                    input: nodeRunDataMap[n.id]?.input?.structured || null,
                                    output: nodeRunDataMap[n.id]?.output?.structured || null,
                                },
                            ])
                        )}
                        label="Full Pipeline Data"
                    />
                ) : (
                    /* PRETTY VIEW */
                    <div className="flex flex-col">
                        {/* Errors first — most important */}
                        {hasErrors && <ErrorPanel stages={stages} nodeLogs={nodeLogs} />}

                        {/* Funnel */}
                        {stages.some((s) => s.contactCount > 0) && (
                            <PipelineFunnel stages={stages} />
                        )}

                        {/* Readable step-by-step summaries */}
                        <NodeSummaryCards stages={stages} />

                        {/* Smart contact table or readable fallback */}
                        {finalContacts.length > 0 ? (
                            <ContactTable contacts={finalContacts} />
                        ) : finalStructured ? (
                            <ReadableOutput structured={finalStructured} text={finalText} />
                        ) : !hasErrors ? (
                            <div className="py-8 flex items-center justify-center">
                                <p className="text-xs text-muted-foreground">No contact data in the final output</p>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            {/* Actions - pinned to bottom */}
            <ActionBar contacts={finalContacts} structuredData={finalStructured} onRerun={onRerun} />
        </div>
    );
}
