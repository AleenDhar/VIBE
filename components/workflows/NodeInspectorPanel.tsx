"use client";

import { useState, useMemo } from "react";
import {
    X,
    ChevronRight,
    ChevronDown,
    Copy,
    Check,
    ArrowDownToLine,
    ArrowUpFromLine,
    FolderOpen,
    Zap,
    Info,
    Database,
    FileText,
    ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Node } from "@xyflow/react";

// ---------- Collapsible JSON Tree ----------

function JsonValue({ value, depth }: { value: any; depth: number }) {
    if (value === null) return <span className="text-orange-400">null</span>;
    if (value === undefined) return <span className="text-muted-foreground">undefined</span>;
    if (typeof value === "boolean")
        return <span className="text-amber-400">{value.toString()}</span>;
    if (typeof value === "number")
        return <span className="text-cyan-400">{value}</span>;
    if (typeof value === "string") {
        if (value.length > 120) {
            return <span className="text-emerald-400">&quot;{value.slice(0, 120)}...&quot;</span>;
        }
        // URL detection
        if (value.startsWith("http://") || value.startsWith("https://")) {
            return (
                <a
                    href={value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-400 hover:underline inline-flex items-center gap-1"
                >
                    &quot;{value}&quot;
                    <ExternalLink className="h-2.5 w-2.5" />
                </a>
            );
        }
        return <span className="text-emerald-400">&quot;{value}&quot;</span>;
    }
    if (Array.isArray(value)) return <JsonArray arr={value} depth={depth} />;
    if (typeof value === "object") return <JsonObject obj={value} depth={depth} />;
    return <span>{String(value)}</span>;
}

function JsonArray({ arr, depth }: { arr: any[]; depth: number }) {
    const [expanded, setExpanded] = useState(depth < 2);

    if (arr.length === 0) return <span className="text-muted-foreground">[]</span>;

    if (!expanded) {
        return (
            <button
                onClick={() => setExpanded(true)}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            >
                <ChevronRight className="h-3 w-3" />
                <span className="text-xs">Array[{arr.length}]</span>
            </button>
        );
    }

    return (
        <div>
            <button
                onClick={() => setExpanded(false)}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            >
                <ChevronDown className="h-3 w-3" />
                <span className="text-xs">Array[{arr.length}]</span>
            </button>
            <div className="ml-4 border-l border-border/20 pl-3 mt-0.5 space-y-0.5">
                {arr.map((item, i) => (
                    <div key={i} className="flex gap-1.5">
                        <span className="text-xs text-muted-foreground/50 select-none min-w-[1.5rem] text-right">{i}</span>
                        <JsonValue value={item} depth={depth + 1} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function JsonObject({ obj, depth }: { obj: Record<string, any>; depth: number }) {
    const [expanded, setExpanded] = useState(depth < 2);
    const keys = Object.keys(obj);

    if (keys.length === 0) return <span className="text-muted-foreground">{"{}"}</span>;

    if (!expanded) {
        return (
            <button
                onClick={() => setExpanded(true)}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            >
                <ChevronRight className="h-3 w-3" />
                <span className="text-xs">{`{${keys.length} keys}`}</span>
            </button>
        );
    }

    return (
        <div>
            <button
                onClick={() => setExpanded(false)}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            >
                <ChevronDown className="h-3 w-3" />
                <span className="text-xs">{`{${keys.length} keys}`}</span>
            </button>
            <div className="ml-4 border-l border-border/20 pl-3 mt-0.5 space-y-0.5">
                {keys.map((key) => (
                    <div key={key} className="flex gap-1.5 flex-wrap">
                        <span className="text-xs text-violet-400 font-medium">{key}:</span>
                        <JsonValue value={obj[key]} depth={depth + 1} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function CollapsibleJsonTree({ data, label }: { data: any; label?: string }) {
    const [copied, setCopied] = useState(false);

    const copyJson = () => {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!data) {
        return (
            <div className="text-xs text-muted-foreground italic py-4 text-center">
                No data available
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                {label && <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>}
                <button
                    onClick={copyJson}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                    {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy JSON"}
                </button>
            </div>
            <div className="rounded-lg bg-black/30 border border-border/20 p-3 text-xs font-mono overflow-auto max-h-[400px]">
                <JsonValue value={data} depth={0} />
            </div>
        </div>
    );
}

// ---------- Data Summary Stats ----------

function DataSummary({ data }: { data: any }) {
    const stats = useMemo(() => {
        if (!data) return null;
        const result: { label: string; value: string | number; color?: string }[] = [];

        if (data.contacts && Array.isArray(data.contacts)) {
            result.push({ label: "Contacts", value: data.contacts.length });
            const validated = data.contacts.filter((c: any) => c.validation_status === "CONFIRMED_ACTIVE").length;
            const unvalidated = data.contacts.filter((c: any) => c.validation_status === "UNVALIDATED").length;
            if (validated > 0) result.push({ label: "Validated", value: validated, color: "text-emerald-400" });
            if (unvalidated > 0) result.push({ label: "Unvalidated", value: unvalidated, color: "text-amber-400" });

            const withLinkedin = data.contacts.filter((c: any) => c.linkedin_url || c.linkedinUrl).length;
            result.push({ label: "LinkedIn", value: `${withLinkedin}/${data.contacts.length}` });

            const withEmail = data.contacts.filter((c: any) => c.email).length;
            result.push({ label: "Emails", value: `${withEmail}/${data.contacts.length}` });
        }

        if (data.contacts_pushed && Array.isArray(data.contacts_pushed)) {
            const pushed = data.contacts_pushed.filter((c: any) => c.push_status === "PUSHED").length;
            const failed = data.contacts_pushed.filter((c: any) => c.push_status === "FAILED").length;
            result.push({ label: "Pushed", value: pushed, color: "text-emerald-400" });
            if (failed > 0) result.push({ label: "Failed", value: failed, color: "text-rose-400" });
        }

        if (data.enrichment_summary) {
            const es = data.enrichment_summary;
            if (es.linkedin_verified) result.push({ label: "Verified", value: es.linkedin_verified, color: "text-emerald-400" });
            if (es.linkedin_replaced) result.push({ label: "Replaced", value: es.linkedin_replaced, color: "text-cyan-400" });
            if (es.linkedin_not_found) result.push({ label: "Not Found", value: es.linkedin_not_found, color: "text-amber-400" });
        }

        if (data.metadata) {
            const m = data.metadata;
            if (m.core_count) result.push({ label: "Core", value: m.core_count });
            if (m.non_core_count) result.push({ label: "Non-Core", value: m.non_core_count });
        }

        return result.length > 0 ? result : null;
    }, [data]);

    if (!stats) return null;

    return (
        <div className="flex flex-wrap gap-2 mt-2">
            {stats.map((s, i) => (
                <div key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/30 border border-border/20">
                    <span className="text-[10px] text-muted-foreground">{s.label}</span>
                    <span className={`text-[10px] font-semibold ${s.color || "text-foreground"}`}>{s.value}</span>
                </div>
            ))}
        </div>
    );
}

// ---------- Main Panel ----------

interface NodeRunData {
    nodeId: string;
    input?: { structured: any; text: string } | null;
    output?: { structured: any; text: string } | null;
}

interface NodeInspectorPanelProps {
    isOpen: boolean;
    onClose: () => void;
    node: Node | null;
    nodeRunData: NodeRunData | null;
    edges: { source: string; target: string }[];
    nodes: Node[];
}

export function NodeInspectorPanel({
    isOpen,
    onClose,
    node,
    nodeRunData,
    edges,
    nodes,
}: NodeInspectorPanelProps) {
    const [activeTab, setActiveTab] = useState<"details" | "data">("details");

    if (!isOpen || !node) return null;

    const nodeData = node.data as any;
    const isProject = node.type === "project";
    const isTrigger = node.type === "trigger";
    const isDispatch = node.type === "dispatch";

    // Find connected nodes
    const parentEdges = edges.filter((e) => e.target === node.id);
    const childEdges = edges.filter((e) => e.source === node.id);
    const parentNodes = parentEdges.map((e) => nodes.find((n) => n.id === e.source)).filter(Boolean);
    const childNodes = childEdges.map((e) => nodes.find((n) => n.id === e.target)).filter(Boolean);

    const inputStructured = nodeRunData?.input?.structured;
    const outputStructured = nodeRunData?.output?.structured;
    const inputText = nodeRunData?.input?.text;
    const outputText = nodeRunData?.output?.text;

    return (
        <div className="fixed right-0 top-0 h-screen w-[440px] border-l border-border/30 bg-background/95 backdrop-blur-md z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                <div className="flex items-center gap-2">
                    <div className={`rounded-lg p-1.5 ${isTrigger ? "bg-violet-500/10" : isDispatch ? "bg-sky-500/10" : "bg-primary/10"}`}>
                        {isTrigger ? (
                            <Zap className="h-4 w-4 text-violet-500" />
                        ) : (
                            <FolderOpen className="h-4 w-4 text-primary" />
                        )}
                    </div>
                    <div>
                        <h3 className="font-medium text-sm">
                            {nodeData.projectName || nodeData.label || node.type}
                        </h3>
                        <p className="text-[10px] text-muted-foreground">
                            {isTrigger ? "Trigger Node" : isDispatch ? "Dispatch Node" : "Project Node"} · {node.id.slice(0, 16)}
                        </p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border/30">
                <button
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === "details"
                            ? "text-foreground border-b-2 border-primary"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setActiveTab("details")}
                >
                    <Info className="h-3.5 w-3.5 inline mr-1.5" />
                    Details
                </button>
                <button
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === "data"
                            ? "text-foreground border-b-2 border-primary"
                            : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setActiveTab("data")}
                >
                    <Database className="h-3.5 w-3.5 inline mr-1.5" />
                    Run Data
                    {(inputStructured || outputStructured) && (
                        <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-violet-500/20 text-[9px] text-violet-400 font-bold">
                            ✓
                        </span>
                    )}
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {activeTab === "details" ? (
                    <div className="p-4 space-y-4">
                        {/* Node Info */}
                        <div className="space-y-3">
                            <div className="rounded-lg bg-muted/20 border border-border/20 p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Type</span>
                                    <span className="text-xs font-medium capitalize">{node.type}</span>
                                </div>
                                {isProject && nodeData.projectId && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">Project ID</span>
                                        <span className="text-[10px] font-mono text-muted-foreground">{nodeData.projectId.slice(0, 12)}...</span>
                                    </div>
                                )}
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Status</span>
                                    <span className={`text-xs font-medium capitalize ${
                                        nodeData.status === "completed" ? "text-emerald-400" :
                                        nodeData.status === "failed" ? "text-rose-400" :
                                        nodeData.status === "running" ? "text-sky-400" :
                                        "text-muted-foreground"
                                    }`}>
                                        {nodeData.status || "idle"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Connections */}
                        <div>
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Connections</h4>
                            <div className="space-y-2">
                                {parentNodes.length > 0 ? (
                                    parentNodes.map((pn: any) => (
                                        <div key={pn.id} className="flex items-center gap-2 rounded-lg bg-muted/20 border border-border/20 px-3 py-2">
                                            <ArrowDownToLine className="h-3 w-3 text-sky-400" />
                                            <span className="text-xs">Input from:</span>
                                            <span className="text-xs font-medium">{pn.data?.projectName || pn.data?.label || pn.type}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-xs text-muted-foreground italic px-3 py-2">No input connections</div>
                                )}
                                {childNodes.length > 0 ? (
                                    childNodes.map((cn: any) => (
                                        <div key={cn.id} className="flex items-center gap-2 rounded-lg bg-muted/20 border border-border/20 px-3 py-2">
                                            <ArrowUpFromLine className="h-3 w-3 text-violet-400" />
                                            <span className="text-xs">Output to:</span>
                                            <span className="text-xs font-medium">{cn.data?.projectName || cn.data?.label || cn.type}</span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-xs text-muted-foreground italic px-3 py-2">No output connections</div>
                                )}
                            </div>
                        </div>

                        {/* Expected Schema (from system instructions convention) */}
                        {isProject && (
                            <div>
                                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Data Contract</h4>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="rounded-lg bg-sky-500/5 border border-sky-500/20 p-3">
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <ArrowDownToLine className="h-3 w-3 text-sky-400" />
                                            <span className="text-[10px] font-medium text-sky-400 uppercase tracking-wider">Expects</span>
                                        </div>
                                        {inputStructured ? (
                                            <div className="space-y-0.5">
                                                {Object.keys(inputStructured).slice(0, 6).map((key) => (
                                                    <div key={key} className="text-[10px] text-muted-foreground font-mono truncate">
                                                        {key}: {typeof inputStructured[key] === "object"
                                                            ? Array.isArray(inputStructured[key])
                                                                ? `[${inputStructured[key].length}]`
                                                                : "{...}"
                                                            : String(inputStructured[key]).slice(0, 20)}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-[10px] text-muted-foreground italic">
                                                {parentNodes.length > 0 ? "Text input from previous node" : "Trigger input"}
                                            </p>
                                        )}
                                    </div>
                                    <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-3">
                                        <div className="flex items-center gap-1.5 mb-2">
                                            <ArrowUpFromLine className="h-3 w-3 text-violet-400" />
                                            <span className="text-[10px] font-medium text-violet-400 uppercase tracking-wider">Produces</span>
                                        </div>
                                        {outputStructured ? (
                                            <div className="space-y-0.5">
                                                {Object.keys(outputStructured).slice(0, 6).map((key) => (
                                                    <div key={key} className="text-[10px] text-muted-foreground font-mono truncate">
                                                        {key}: {typeof outputStructured[key] === "object"
                                                            ? Array.isArray(outputStructured[key])
                                                                ? `[${outputStructured[key].length}]`
                                                                : "{...}"
                                                            : String(outputStructured[key]).slice(0, 20)}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-[10px] text-muted-foreground italic">Run workflow to see output schema</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Run Data Tab */
                    <div className="p-4 space-y-4">
                        {!nodeRunData ? (
                            <div className="text-center py-12">
                                <Database className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                                <p className="text-sm text-muted-foreground">No run data yet</p>
                                <p className="text-xs text-muted-foreground/60 mt-1">Run the workflow to see input/output data</p>
                            </div>
                        ) : (
                            <>
                                {/* Input Section */}
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <ArrowDownToLine className="h-3.5 w-3.5 text-sky-400" />
                                        <span className="text-xs font-medium uppercase tracking-wider">Input</span>
                                    </div>
                                    {inputStructured ? (
                                        <>
                                            <CollapsibleJsonTree data={inputStructured} label="Structured Data" />
                                            <DataSummary data={inputStructured} />
                                        </>
                                    ) : inputText ? (
                                        <div className="rounded-lg bg-black/30 border border-border/20 p-3">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <FileText className="h-3 w-3 text-muted-foreground" />
                                                <span className="text-[10px] text-muted-foreground">Text Input</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">
                                                {inputText}
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground italic">No input data</p>
                                    )}
                                </div>

                                {/* Divider */}
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 h-px bg-border/30" />
                                    <span className="text-[10px] text-muted-foreground/50">→ processing →</span>
                                    <div className="flex-1 h-px bg-border/30" />
                                </div>

                                {/* Output Section */}
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <ArrowUpFromLine className="h-3.5 w-3.5 text-violet-400" />
                                        <span className="text-xs font-medium uppercase tracking-wider">Output</span>
                                        {outputStructured && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 font-medium">
                                                STRUCTURED
                                            </span>
                                        )}
                                    </div>
                                    {outputStructured ? (
                                        <>
                                            <CollapsibleJsonTree data={outputStructured} label="Structured Data" />
                                            <DataSummary data={outputStructured} />
                                        </>
                                    ) : outputText ? (
                                        <div className="rounded-lg bg-black/30 border border-border/20 p-3">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <FileText className="h-3 w-3 text-muted-foreground" />
                                                <span className="text-[10px] text-muted-foreground">Text Output</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-10">
                                                {outputText}
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground italic">No output data</p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
