"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
    ArrowRight,
    Copy,
    Check,
    ExternalLink,
    Download,
    Play,
    ChevronDown,
    ChevronRight,
    Zap,
    FileJson,
    Eye,
    Code2,
    AlertTriangle,
    XCircle,
    CheckCircle2,
    Info,
    Lightbulb,
    MessageSquare,
    LayoutList,
    Send,
    Hash,
    Database,
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
    code: ({ node, inline, ...props }: any) =>
        inline ? (
            <code className="text-[0.9em] bg-muted/30 px-1 py-0.5 rounded" {...props} />
        ) : (
            <code className="block text-[0.9em] bg-muted/20 p-2 rounded mt-1 overflow-x-auto" {...props} />
        ),
    a: ({ node, ...props }: any) => (
        <a className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />
    ),
    table: ({ node, ...props }: any) => (
        <div className="overflow-x-auto my-2">
            <table className="text-xs border-collapse w-full" {...props} />
        </div>
    ),
    th: ({ node, ...props }: any) => <th className="border border-border/30 px-2 py-1 text-left bg-muted/20 font-medium" {...props} />,
    td: ({ node, ...props }: any) => <td className="border border-border/30 px-2 py-1" {...props} />,
};

function CompactMarkdown({ children, className }: { children: string; className?: string }) {
    return (
        <div className={className}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {children}
            </ReactMarkdown>
        </div>
    );
}

// ─── Types ───────────────────────────────────────────────────────────

interface NodeRunData {
    input?: { structured?: any; text?: string };
    output?: { structured?: any; text?: string };
}

interface NodeLog {
    nodeId: string;
    label: string;
    status: "running" | "completed" | "failed";
    error?: string;
    durationMs?: number;
    aiSummary?: string;
}

interface PipelineStage {
    nodeId: string;
    label: string;
    itemCount: number;
    status: "completed" | "failed" | "skipped";
    summary: string;
    error?: string;
    durationMs?: number;
    aiSummary?: string;
    aiText?: string;
}

interface WorkflowResultsPanelProps {
    nodeRunDataMap: Record<string, NodeRunData>;
    nodeOrder: { id: string; label: string; type: string }[];
    nodeLogs: NodeLog[];
    onRerun?: () => void;
}

// ─── Smart Data Detection ────────────────────────────────────────────

/** Detect what kind of array data exists in structured output */
function detectArrayData(structured: any): { key: string; items: any[] } | null {
    if (!structured || typeof structured !== "object") return null;

    // Find the largest array in the structured data
    let bestKey = "";
    let bestItems: any[] = [];

    for (const [key, value] of Object.entries(structured)) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
            if (value.length > bestItems.length) {
                bestKey = key;
                bestItems = value;
            }
        }
    }

    return bestItems.length > 0 ? { key: bestKey, items: bestItems } : null;
}

/** Count meaningful items in structured output */
function extractItemCount(structured: any): number {
    const arrayData = detectArrayData(structured);
    if (arrayData) return arrayData.items.length;

    // Check for common count fields
    for (const key of ["total", "count", "total_count", "total_contacts", "contact_count", "total_results"]) {
        if (typeof structured?.[key] === "number") return structured[key];
    }

    return 0;
}

/** Get a display label for the array data */
function getArrayLabel(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([A-Z])/g, " $1")
        .trim()
        .replace(/\b\w/g, (l) => l.toUpperCase());
}

/** Detect the best display name for an item */
function getItemDisplayName(item: any): string {
    for (const key of ["name", "full_name", "company_name", "title", "label", "subject", "email", "account_name"]) {
        if (typeof item[key] === "string" && item[key]) return item[key];
    }
    // Try composite
    if (item.firstName || item.lastName) {
        return `${item.firstName || ""} ${item.lastName || ""}`.trim();
    }
    return "";
}

/** Detect subtitle for an item */
function getItemSubtitle(item: any): string {
    const name = getItemDisplayName(item);
    for (const key of ["title", "role", "email", "company", "description", "type", "status", "industry", "sector"]) {
        if (typeof item[key] === "string" && item[key] && item[key] !== name) {
            const company = item.company || item.company_name || item.organization || "";
            if (key === "title" && company) return `${item[key]} at ${company}`;
            return item[key];
        }
    }
    return "";
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Generate a generic summary for any node output */
function generateNodeSummary(label: string, structured: any, text: string): string {
    if (!structured && !text) return "No output produced.";

    const itemCount = extractItemCount(structured);
    const arrayData = detectArrayData(structured);

    if (arrayData && itemCount > 0) {
        const arrayLabel = getArrayLabel(arrayData.key);
        return `Produced ${itemCount} ${arrayLabel.toLowerCase()}.`;
    }

    // Check for status/summary fields
    if (structured?.status) {
        const summary = structured.summary || structured.execution_summary || structured.message || "";
        if (summary && typeof summary === "string") return summary.slice(0, 200);
        return `Status: ${structured.status}`;
    }

    if (structured?.summary && typeof structured.summary === "string") {
        return structured.summary.slice(0, 200);
    }

    // Fall back to text preview
    if (text) {
        // Extract first meaningful line
        const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"));
        if (lines.length > 0) return lines[0].slice(0, 200).trim() + (lines[0].length > 200 ? "..." : "");
    }

    // Count top-level keys as a hint
    if (structured && typeof structured === "object") {
        const keys = Object.keys(structured);
        return `Produced output with ${keys.length} field${keys.length !== 1 ? "s" : ""}: ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? "..." : ""}.`;
    }

    return "Step completed.";
}

/** Generate troubleshooting hints for errors */
function getTroubleshootingHints(error: string, nodeLabel: string): string[] {
    const hints: string[] = [];
    const e = error.toLowerCase();

    if (e.includes("rate limit") || e.includes("429") || e.includes("over_request")) {
        hints.push("You've hit an API rate limit. Wait a few minutes and try again.");
    }
    if (e.includes("timeout") || e.includes("timed out") || e.includes("deadline")) {
        hints.push("The step took too long to complete. Try simplifying the input or breaking the task into smaller pieces.");
    }
    if (e.includes("token") || e.includes("context length") || e.includes("too long")) {
        hints.push("The data passed to this step was too large for the AI to process in one go.");
    }
    if (e.includes("no project") || e.includes("project not found")) {
        hints.push("This node isn't connected to a project. Open it and assign a project.");
    }
    if (e.includes("bdr not found")) {
        hints.push("The BDR email wasn't found in the app. Make sure the BDR has an account or enable auto-creation.");
    }
    if (e.includes("dispatch failed")) {
        hints.push("The async dispatch to the agent server failed. Check that the DeepAgent server is running.");
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

function formatDuration(ms?: number): string {
    if (!ms) return "";
    if (ms < 1000) return `${ms}ms`;
    const secs = Math.round(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}m ${remSecs}s`;
}

// ─── Pipeline Summary Bar ────────────────────────────────────────────

function PipelineSummary({ stages }: { stages: PipelineStage[] }) {
    const maxCount = Math.max(...stages.map((s) => s.itemCount), 1);

    return (
        <div className="px-4 py-4 border-b border-border/30">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Pipeline Summary</h4>
            <div className="flex items-center gap-2">
                {stages.map((stage, i) => {
                    const isFailed = stage.status === "failed";
                    const widthPct = Math.max((stage.itemCount / maxCount) * 100, 30);

                    return (
                        <div key={stage.nodeId} className="flex items-center gap-2 flex-1 min-w-0">
                            <div
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                                    isFailed
                                        ? "bg-rose-500/10 border-rose-500/30"
                                        : "bg-blue-500/10 border-blue-500/30"
                                }`}
                                style={{ width: `${widthPct}%`, minWidth: "fit-content" }}
                            >
                                {isFailed ? (
                                    <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                                ) : (
                                    <Database className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                                )}
                                <div className="min-w-0">
                                    <p className="text-[10px] text-muted-foreground truncate">{stage.label}</p>
                                    <p className={`text-sm font-bold ${isFailed ? "text-rose-400" : "text-blue-400"}`}>
                                        {isFailed ? "Error" : stage.itemCount > 0 ? stage.itemCount : "✓"}
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

// ─── Node Summary Cards ──────────────────────────────────────────────

function NodeSummaryCards({ stages }: { stages: PipelineStage[] }) {
    const [expandedStage, setExpandedStage] = useState<string | null>(null);

    return (
        <div className="px-4 py-3 space-y-2 border-b border-border/30">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">What Happened</h4>
            {stages.map((stage, i) => {
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
                                isFailed ? "bg-rose-500/15" : "bg-emerald-500/15"
                            }`}>
                                {isFailed ? (
                                    <XCircle className="h-3.5 w-3.5 text-rose-400" />
                                ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
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

// ─── Error Panel ─────────────────────────────────────────────────────

function ErrorPanel({ stages, nodeLogs }: { stages: PipelineStage[]; nodeLogs: NodeLog[] }) {
    const errors = useMemo(() => {
        const errs: { nodeLabel: string; error: string; hints: string[] }[] = [];

        for (const stage of stages) {
            if (stage.status === "failed" && stage.error) {
                errs.push({
                    nodeLabel: stage.label,
                    error: stage.error,
                    hints: getTroubleshootingHints(stage.error, stage.label),
                });
            }
        }

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

// ─── Smart Data Table (generic, auto-detects columns) ────────────────

function SmartDataTable({ arrayKey, items }: { arrayKey: string; items: any[] }) {
    const [expandedRow, setExpandedRow] = useState<number | null>(null);

    if (items.length === 0) return null;

    const label = getArrayLabel(arrayKey);

    return (
        <div>
            <div className="px-4 py-3 border-b border-border/30">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {label} — {items.length} total
                </h4>
            </div>
            <div className="divide-y divide-border/20">
                {items.map((item, i) => {
                    const isExpanded = expandedRow === i;
                    const displayName = getItemDisplayName(item);
                    const subtitle = getItemSubtitle(item);
                    const initials = displayName
                        ? displayName
                              .split(/[\s@.]+/)
                              .map((w: string) => w[0])
                              .filter(Boolean)
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()
                        : `${i + 1}`;

                    // Get extra fields for expanded view (skip name/title/subtitle fields)
                    const skipKeys = new Set(["name", "full_name", "firstName", "lastName", "title", "role", "company", "company_name", "organization"]);
                    const extraFields = Object.entries(item).filter(
                        ([k, v]) => !skipKeys.has(k) && v !== null && v !== undefined && v !== ""
                    );

                    return (
                        <div key={i} className="px-4 py-3 hover:bg-muted/10 transition-colors">
                            <div
                                className="flex items-start gap-3 cursor-pointer"
                                onClick={() => setExpandedRow(isExpanded ? null : i)}
                            >
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                                    <span className="text-xs font-bold text-primary">{initials}</span>
                                </div>

                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium truncate block">
                                        {displayName || `Item ${i + 1}`}
                                    </span>
                                    {subtitle && (
                                        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                                    )}
                                    {/* Show key badges inline */}
                                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                        {item.email && (
                                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                <Send className="h-3 w-3" />
                                                <span className="truncate max-w-[160px]">{item.email}</span>
                                            </span>
                                        )}
                                        {item.status && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                item.status === "active" || item.status === "success"
                                                    ? "text-emerald-400 bg-emerald-500/15"
                                                    : item.status === "failed" || item.status === "error"
                                                    ? "text-rose-400 bg-rose-500/15"
                                                    : "text-amber-400 bg-amber-500/15"
                                            }`}>
                                                {item.status}
                                            </span>
                                        )}
                                        {item.score !== undefined && (
                                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                                <Hash className="h-3 w-3" />
                                                {item.score}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="shrink-0 mt-1">
                                    {isExpanded ? (
                                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                </div>
                            </div>

                            {isExpanded && extraFields.length > 0 && (
                                <div className="mt-3 ml-11 space-y-1.5 animate-in fade-in duration-200">
                                    {extraFields.map(([key, value]) => (
                                        <div key={key} className="flex items-start gap-2 text-[11px]">
                                            <span className="text-muted-foreground shrink-0 capitalize min-w-[80px]">
                                                {key.replace(/_/g, " ")}:
                                            </span>
                                            <span className="text-foreground/80 break-all">
                                                {typeof value === "string" && value.startsWith("http") ? (
                                                    <a
                                                        href={value}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-400 hover:underline"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {value}
                                                        <ExternalLink className="h-2.5 w-2.5 inline ml-1" />
                                                    </a>
                                                ) : typeof value === "object" ? (
                                                    JSON.stringify(value).slice(0, 200)
                                                ) : (
                                                    String(value)
                                                )}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Raw JSON View ───────────────────────────────────────────────────

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

// ─── Readable Output (structured data fallback) ──────────────────────

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

// ─── Action Bar (generic) ────────────────────────────────────────────

function ActionBar({
    arrayData,
    structuredData,
    onRerun,
}: {
    arrayData: { key: string; items: any[] } | null;
    structuredData: any;
    onRerun?: () => void;
}) {
    const [copiedCsv, setCopiedCsv] = useState(false);
    const [copiedJson, setCopiedJson] = useState(false);

    const copyAsCsv = () => {
        if (!arrayData || arrayData.items.length === 0) return;
        // Auto-detect columns from first item
        const headers = Object.keys(arrayData.items[0]).filter(
            (k) => typeof arrayData.items[0][k] !== "object" || arrayData.items[0][k] === null
        );
        const rows = arrayData.items.map((item) =>
            headers.map((h) => {
                const v = item[h];
                return v === null || v === undefined ? "" : String(v);
            })
        );
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
            {arrayData && arrayData.items.length > 0 && (
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
            {onRerun && (
                <Button variant="default" size="sm" className="h-7 text-xs gap-1.5" onClick={onRerun}>
                    <Play className="h-3 w-3" />
                    Re-run
                </Button>
            )}
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────

export function WorkflowResultsPanel({ nodeRunDataMap, nodeOrder, nodeLogs, onRerun }: WorkflowResultsPanelProps) {
    const [viewMode, setViewMode] = useState<"pretty" | "json">("pretty");

    const projectNodes = useMemo(
        () => nodeOrder.filter((n) => n.type === "project"),
        [nodeOrder]
    );

    // Build pipeline stages with generic summaries
    const stages: PipelineStage[] = useMemo(() => {
        return projectNodes.map((node) => {
            const runData = nodeRunDataMap[node.id];
            const structured = runData?.output?.structured;
            const text = runData?.output?.text || "";
            const count = extractItemCount(structured);
            const nodeLog = nodeLogs.find((l) => l.nodeId === node.id);
            const isFailed = nodeLog?.status === "failed";

            return {
                nodeId: node.id,
                label: node.label,
                itemCount: count,
                status: isFailed ? "failed" as const : "completed" as const,
                summary: isFailed
                    ? `Failed: ${nodeLog?.error || "Unknown error"}`
                    : generateNodeSummary(node.label, structured, text),
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
    const finalArrayData = useMemo(() => detectArrayData(finalStructured), [finalStructured]);

    const hasErrors = stages.some((s) => s.status === "failed") || nodeLogs.some((l) => l.status === "failed");
    const hasAnyData = stages.some((s) => s.itemCount > 0) || finalStructured || hasErrors;

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
                    <div className="flex flex-col">
                        {/* Errors first */}
                        {hasErrors && <ErrorPanel stages={stages} nodeLogs={nodeLogs} />}

                        {/* Pipeline summary bar */}
                        {stages.some((s) => s.itemCount > 0) && (
                            <PipelineSummary stages={stages} />
                        )}

                        {/* Step-by-step summaries */}
                        <NodeSummaryCards stages={stages} />

                        {/* Smart data display — auto-detects array data or falls back to readable */}
                        {finalArrayData ? (
                            <SmartDataTable arrayKey={finalArrayData.key} items={finalArrayData.items} />
                        ) : finalStructured ? (
                            <ReadableOutput structured={finalStructured} text={finalText} />
                        ) : !hasErrors && finalText ? (
                            <div className="p-4">
                                <CompactMarkdown className="text-sm text-foreground/80">
                                    {finalText}
                                </CompactMarkdown>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            {/* Actions - pinned to bottom */}
            <ActionBar arrayData={finalArrayData} structuredData={finalStructured} onRerun={onRerun} />
        </div>
    );
}
