"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";
import { resolveToolIntegration, summariseIntegrations, humanizeToolName } from "./tool-integrations";

export interface ToolStepPair {
    call: { tool?: string; args?: string | object | null };
    result: { content?: string } | null;
}

interface ToolTimelineProps {
    pairs: ToolStepPair[];
    initiallyOpen?: boolean;
    /** True only while this message is actively streaming. When false, missing
     *  results are treated as historical no-ops, not "still running". */
    isStreaming?: boolean;
}

const VISIBLE_LIMIT = 10;

export function ToolTimeline({ pairs, initiallyOpen = true, isStreaming = false }: ToolTimelineProps) {
    const [groupOpen, setGroupOpen] = useState(initiallyOpen);
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
    const [showAll, setShowAll] = useState(false);

    if (!pairs || pairs.length === 0) return null;

    const toolNames = pairs.map((p) => p.call?.tool || "tool");
    const integrationLabel = summariseIntegrations(toolNames);
    const totalCount = pairs.length;
    const anyRunning = isStreaming && pairs.some((p) => !hasResult(p.result));

    const toggleRow = (idx: number) => {
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    };

    const visiblePairs = !groupOpen
        ? []
        : !showAll && totalCount > VISIBLE_LIMIT
            ? pairs.slice(0, VISIBLE_LIMIT)
            : pairs;
    const hiddenCount = groupOpen ? totalCount - visiblePairs.length : 0;
    const showDoneRow = groupOpen && !isStreaming && hiddenCount === 0;

    return (
        <div className="my-3">
            <button
                type="button"
                onClick={() => setGroupOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground/80 transition-colors py-1"
            >
                <span>
                    Used {integrationLabel} · {totalCount} {totalCount === 1 ? "tool" : "tools"}
                </span>
                <ChevronDown
                    className="h-3.5 w-3.5 transition-transform"
                    style={{ transform: groupOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                />
                {anyRunning && (
                    <span className="text-[10px] text-muted-foreground/60">running…</span>
                )}
            </button>

            {groupOpen && (
                <div className="mt-1 relative">
                    <div
                        className="absolute left-[7px] top-3 bottom-3 w-px bg-border/50"
                        aria-hidden
                    />

                    <div>
                        {visiblePairs.map((pair, idx) => {
                            const toolName = pair.call?.tool || "tool";
                            const { icon: Icon, color } = resolveToolIntegration(toolName);
                            const displayName = humanizeToolName(toolName);
                            const expanded = expandedRows.has(idx);
                            const running = isStreaming && !hasResult(pair.result);
                            const argsDisplay = formatPayload(pair.call?.args);
                            const resultText = parseResultText(pair.result?.content || "");
                            const hasContent = !!argsDisplay || !!resultText;

                            return (
                                <div key={idx} className="relative">
                                    <button
                                        type="button"
                                        onClick={() => toggleRow(idx)}
                                        disabled={!hasContent && !running}
                                        className="flex items-center gap-3 w-full text-left py-1.5 group/tt disabled:cursor-default"
                                    >
                                        <span className="relative z-10 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center bg-background">
                                            <Icon className={`h-3.5 w-3.5 ${color} group-hover/tt:opacity-100 opacity-90 transition-opacity`} />
                                        </span>
                                        <span className="text-sm text-muted-foreground/85 group-hover/tt:text-foreground/95 transition-colors">
                                            {displayName}
                                        </span>
                                        {running && (
                                            <span className="text-[10px] text-muted-foreground/60 italic">running…</span>
                                        )}
                                    </button>

                                    {expanded && hasContent && (
                                        <div className="pl-7 pb-2 space-y-1.5">
                                            {argsDisplay && (
                                                <PayloadBlock
                                                    label="Request"
                                                    text={argsDisplay}
                                                    accent="sky"
                                                />
                                            )}
                                            {resultText && (
                                                <PayloadBlock
                                                    label="Response"
                                                    text={resultText}
                                                    accent="emerald"
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {hiddenCount > 0 && (
                            <button
                                type="button"
                                onClick={() => setShowAll(true)}
                                className="flex items-center gap-3 w-full text-left py-1.5 text-xs text-muted-foreground/60 hover:text-foreground/80 transition-colors"
                            >
                                <span className="relative z-10 h-3.5 w-3.5 flex-shrink-0 bg-background" />
                                <span>Show {hiddenCount} more</span>
                            </button>
                        )}

                        {showDoneRow && (
                            <div className="flex items-center gap-3 py-1.5">
                                <span className="relative z-10 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center bg-background">
                                    <Check className="h-3.5 w-3.5 text-muted-foreground/60" />
                                </span>
                                <span className="text-sm text-muted-foreground/70">Done</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

const ACCENT_CLASSES = {
    sky: {
        border: "border-sky-500/15",
        bg: "bg-sky-500/[0.04]",
        label: "text-sky-400/80",
    },
    emerald: {
        border: "border-emerald-500/15",
        bg: "bg-emerald-500/[0.04]",
        label: "text-emerald-400/80",
    },
} as const;

function PayloadBlock({
    label,
    text,
    accent,
}: {
    label: string;
    text: string;
    accent: keyof typeof ACCENT_CLASSES;
}) {
    const cls = ACCENT_CLASSES[accent];
    const json = isJsonLike(text) ? text : null;
    return (
        <div className={`rounded-md border ${cls.border} ${cls.bg} overflow-hidden`}>
            <div className={`px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider ${cls.label}`}>
                {label}
            </div>
            <pre className="px-3 pb-2 text-[11.5px] font-mono text-foreground/85 leading-relaxed m-0 whitespace-pre-wrap break-words max-h-[360px] overflow-auto">
                {json ? <HighlightedJson text={json} /> : text}
            </pre>
        </div>
    );
}

const JSON_TOKEN_RE =
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g;

function HighlightedJson({ text }: { text: string }) {
    const parts: ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    JSON_TOKEN_RE.lastIndex = 0;
    while ((m = JSON_TOKEN_RE.exec(text)) !== null) {
        if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
        const [, str, colon, kw, num, punct] = m;
        if (str !== undefined) {
            if (colon) {
                parts.push(
                    <span key={key++} className="text-sky-300/85">
                        {str}
                    </span>
                );
                parts.push(
                    <span key={key++} className="text-muted-foreground/60">
                        {colon}
                    </span>
                );
            } else {
                parts.push(
                    <span key={key++} className="text-emerald-300/85">
                        {str}
                    </span>
                );
            }
        } else if (kw !== undefined) {
            parts.push(
                <span key={key++} className="text-purple-300/85">
                    {kw}
                </span>
            );
        } else if (num !== undefined) {
            parts.push(
                <span key={key++} className="text-amber-300/85">
                    {num}
                </span>
            );
        } else if (punct !== undefined) {
            parts.push(
                <span key={key++} className="text-muted-foreground/60">
                    {punct}
                </span>
            );
        }
        lastIdx = JSON_TOKEN_RE.lastIndex;
    }
    if (lastIdx < text.length) parts.push(text.slice(lastIdx));
    return <>{parts}</>;
}

function isJsonLike(s: string): boolean {
    const trimmed = s.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function hasResult(result: ToolStepPair["result"]): boolean {
    if (!result) return false;
    const c = result.content;
    if (c == null) return false;
    return typeof c === "string" ? c.trim().length > 0 : true;
}

/** Pretty-print a request/args payload. Tries JSON-parse and re-stringify with
 *  indentation. Hides empty objects. */
function formatPayload(raw: unknown): string {
    if (raw == null || raw === "") return "";
    let parsed: unknown = raw;
    if (typeof raw === "string") {
        try {
            parsed = JSON.parse(raw);
        } catch {
            return raw;
        }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed as object).length === 0) {
        return "";
    }
    try {
        return JSON.stringify(parsed, null, 2);
    } catch {
        return typeof raw === "string" ? raw : String(raw);
    }
}

/** Parse and pretty-print a tool_result content. The agent often wraps results
 *  in an outer JSON envelope of `[{type:"text", text:"<inner>"}]` where the
 *  inner text is itself a JSON-stringified payload. We unwrap one envelope and
 *  if the inner payload is JSON, pretty-print it too. */
function parseResultText(raw: string): string {
    if (!raw) return "";

    let extracted = raw;
    let parsedOk = false;

    try {
        const parsed = JSON.parse(raw);
        parsedOk = true;
        if (Array.isArray(parsed)) {
            extracted = parsed
                .map((b: any) => b?.text ?? b?.content ?? (typeof b === "string" ? b : JSON.stringify(b)))
                .join("\n")
                .trim();
        } else if (typeof parsed === "string") {
            extracted = parsed;
        } else {
            return JSON.stringify(parsed, null, 2);
        }
    } catch {
        const matches = [...raw.matchAll(/'text'\s*:\s* '((?:[^'\\]|\\.)*)'/g)];
        if (matches.length > 0) {
            extracted = matches
                .map((m) =>
                    m[1]
                        .replace(/\\n/g, "\n")
                        .replace(/\\t/g, "\t")
                        .replace(/\\'/g, "'")
                        .replace(/\\\\/g, "\\")
                )
                .join("\n")
                .trim();
        }
    }

    const trimmed = extracted.trim();
    if (parsedOk && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        try {
            const inner = JSON.parse(trimmed);
            return JSON.stringify(inner, null, 2);
        } catch {
            // Not valid JSON; fall through.
        }
    }
    return extracted;
}
