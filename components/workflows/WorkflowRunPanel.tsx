"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Activity, Clock, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Database, BarChart3, Maximize2, Minimize2, ArrowLeft, Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { WorkflowResultsPanel } from "./WorkflowResultsPanel";

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

interface Execution {
    id: string;
    status: string;
    created_at: string;
    finished_at: string | null;
    error: string | null;
    node_outputs?: Record<string, {
        structured: any;
        text: string;
        raw?: string;
    }>;
    input?: any;
    output?: any;
}

interface WorkflowRunPanelProps {
    isOpen: boolean;
    onClose: () => void;
    nodeLogs: NodeLog[];
    isRunning: boolean;
    executions: Execution[];
    nodeRunDataMap: Record<string, { input?: { structured: any; text: string } | null; output?: { structured: any; text: string } | null }>;
    nodeOrder: { id: string; label: string; type: string }[];
    onRerun?: () => void;
    initialTab?: "live" | "results" | "history";
}

export function WorkflowRunPanel({
    isOpen,
    onClose,
    nodeLogs,
    isRunning,
    executions,
    nodeRunDataMap,
    nodeOrder,
    onRerun,
    initialTab,
}: WorkflowRunPanelProps) {
    const [activeTab, setActiveTab] = useState<"live" | "results" | "history">("live");
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [viewingExecutionId, setViewingExecutionId] = useState<string | null>(null);

    // Switch to initialTab when panel opens with it set
    useEffect(() => {
        if (isOpen && initialTab) {
            setActiveTab(initialTab);
        }
    }, [isOpen, initialTab]);

    // Auto-switch to results tab when workflow finishes
    const workflowComplete = !isRunning && nodeLogs.length > 0 && nodeLogs.every((l) => l.status !== "running");
    const hasStructuredResults = Object.values(nodeRunDataMap).some((d) => d.output?.structured);

    useEffect(() => {
        if (workflowComplete && hasStructuredResults) {
            setViewingExecutionId(null); // Clear any history view
            setActiveTab("results");
        }
    }, [workflowComplete, hasStructuredResults]);

    // Switch to live when a new run starts
    useEffect(() => {
        if (isRunning) {
            setActiveTab("live");
            setViewingExecutionId(null);
        }
    }, [isRunning]);

    // Build nodeRunDataMap from a historical execution's node_outputs
    const viewingExecution = viewingExecutionId ? executions.find((e) => e.id === viewingExecutionId) : null;
    const historyNodeRunDataMap = useMemo(() => {
        if (!viewingExecution?.node_outputs) return {};
        const map: Record<string, { input?: { structured: any; text: string } | null; output?: { structured: any; text: string } | null }> = {};
        const nodeIds = Object.keys(viewingExecution.node_outputs);
        for (let i = 0; i < nodeIds.length; i++) {
            const nodeId = nodeIds[i];
            const nodeOut = viewingExecution.node_outputs[nodeId];
            // Previous node's output is this node's input
            const prevNodeId = i > 0 ? nodeIds[i - 1] : null;
            const prevOut = prevNodeId ? viewingExecution.node_outputs[prevNodeId] : null;
            map[nodeId] = {
                input: prevOut ? { structured: prevOut.structured, text: prevOut.text } : null,
                output: { structured: nodeOut.structured, text: nodeOut.text },
            };
        }
        return map;
    }, [viewingExecution]);

    // Build nodeOrder from history execution
    const historyNodeOrder = useMemo(() => {
        if (!viewingExecution?.node_outputs) return [];
        return Object.keys(viewingExecution.node_outputs).map((id) => {
            // Try to find label from current nodeOrder, fallback to id
            const existing = nodeOrder.find((n) => n.id === id);
            return { id, label: existing?.label || id, type: existing?.type || "project" };
        });
    }, [viewingExecution, nodeOrder]);

    if (!isOpen) return null;

    const toggleExpand = (nodeId: string) => {
        setExpandedNodes((prev) => {
            const next = new Set(prev);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
        });
    };

    const showResultsTab = (workflowComplete && hasStructuredResults) || viewingExecutionId !== null;

    // Determine which data to show in Results
    const activeNodeRunDataMap = viewingExecutionId ? historyNodeRunDataMap : nodeRunDataMap;
    const activeNodeOrder = viewingExecutionId ? historyNodeOrder : nodeOrder;
    const activeNodeLogs = viewingExecutionId ? [] : nodeLogs; // No live logs for history

    const handleViewExecution = (execId: string) => {
        setViewingExecutionId(execId);
        setActiveTab("results");
    };

    const handleBackToHistory = () => {
        setViewingExecutionId(null);
        setActiveTab("history");
    };

    // Duration helper for history
    const getDuration = (exec: Execution) => {
        if (!exec.finished_at || !exec.created_at) return null;
        const ms = new Date(exec.finished_at).getTime() - new Date(exec.created_at).getTime();
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${Math.round(ms / 1000)}s`;
        return `${Math.round(ms / 60000)}m`;
    };

    // Count nodes from execution
    const getNodeCount = (exec: Execution) => {
        if (!exec.node_outputs) return 0;
        return Object.keys(exec.node_outputs).filter((k) => {
            const out = exec.node_outputs![k];
            return out.structured || out.text;
        }).length;
    };

    return (
        <div className={`fixed top-0 h-screen border-l border-border bg-card z-50 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 transition-all ${
            isFullScreen
                ? "left-0 right-0 w-full border-l-0"
                : "right-0 w-[440px]"
        }`}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    {viewingExecutionId && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleBackToHistory}
                            title="Back to history"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    <h3 className="font-medium text-sm">
                        {viewingExecutionId
                            ? `Run — ${new Date(viewingExecution?.created_at || "").toLocaleString()}`
                            : "Execution"
                        }
                    </h3>
                </div>
                <div className="flex items-center gap-1">
                    {showResultsTab && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setIsFullScreen(!isFullScreen)}
                            title={isFullScreen ? "Collapse panel" : "Expand to full screen"}
                        >
                            {isFullScreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setIsFullScreen(false); setViewingExecutionId(null); onClose(); }}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
                {!viewingExecutionId && (
                    <button
                        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                            activeTab === "live"
                                ? "text-foreground border-b-2 border-primary"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("live")}
                    >
                        <Activity className="h-3.5 w-3.5 inline mr-1.5" />
                        Live
                    </button>
                )}
                {showResultsTab && (
                    <button
                        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                            activeTab === "results"
                                ? "text-foreground border-b-2 border-emerald-500"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("results")}
                    >
                        <BarChart3 className="h-3.5 w-3.5 inline mr-1.5" />
                        Results
                    </button>
                )}
                {!viewingExecutionId && (
                    <button
                        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                            activeTab === "history"
                                ? "text-foreground border-b-2 border-primary"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setActiveTab("history")}
                    >
                        <Clock className="h-3.5 w-3.5 inline mr-1.5" />
                        History
                    </button>
                )}
            </div>

            {/* Content */}
            {activeTab === "results" ? (
                <div className={isFullScreen ? "flex-1 min-h-0 flex justify-center" : "flex-1 min-h-0"}>
                    <div className={isFullScreen ? "w-full max-w-3xl flex-1 min-h-0 flex flex-col" : "flex-1 min-h-0 flex flex-col h-full"}>
                        <WorkflowResultsPanel
                            nodeRunDataMap={activeNodeRunDataMap}
                            nodeOrder={activeNodeOrder}
                            nodeLogs={activeNodeLogs}
                            onRerun={viewingExecutionId ? undefined : onRerun}
                        />
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-4">
                    {activeTab === "live" ? (
                        <div className="space-y-3">
                            {isRunning && nodeLogs.length === 0 && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Starting workflow...
                                </div>
                            )}
                            {nodeLogs.map((log, i) => {
                                const isExpanded = expandedNodes.has(`${log.nodeId}-${i}`);
                                return (
                                    <div
                                        key={`${log.nodeId}-${i}`}
                                        className="rounded-lg border border-border bg-muted/50 p-3"
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            {log.status === "running" && (
                                                <Loader2 className="h-3.5 w-3.5 text-sky-500 animate-spin" />
                                            )}
                                            {log.status === "completed" && (
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                            )}
                                            {log.status === "failed" && (
                                                <XCircle className="h-3.5 w-3.5 text-rose-500" />
                                            )}
                                            <span className="text-sm font-medium flex-1">{log.label}</span>
                                            {log.hasStructuredOutput && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-600 dark:text-violet-400 font-medium">
                                                    <Database className="h-2.5 w-2.5 inline mr-0.5" />
                                                    DATA
                                                </span>
                                            )}
                                        </div>
                                        {log.output && (
                                            <>
                                                <p className={`text-xs text-muted-foreground mt-1 whitespace-pre-wrap ${
                                                    isExpanded ? "" : "line-clamp-3"
                                                }`}>
                                                    {log.output}
                                                </p>
                                                {log.output.length > 150 && (
                                                    <button
                                                        className="text-[10px] text-primary hover:underline mt-1 flex items-center gap-0.5"
                                                        onClick={() => toggleExpand(`${log.nodeId}-${i}`)}
                                                    >
                                                        {isExpanded ? (
                                                            <>Show less <ChevronUp className="h-2.5 w-2.5" /></>
                                                        ) : (
                                                            <>Show more <ChevronDown className="h-2.5 w-2.5" /></>
                                                        )}
                                                    </button>
                                                )}
                                            </>
                                        )}
                                        {log.error && (
                                            <p className="text-xs text-rose-500 mt-1">{log.error}</p>
                                        )}
                                        <div className="flex items-center gap-2 mt-1">
                                            <p className="text-[10px] text-muted-foreground/50">
                                                {new Date(log.timestamp).toLocaleTimeString()}
                                            </p>
                                            {log.durationMs && (
                                                <p className="text-[10px] text-muted-foreground/40">
                                                    took {log.durationMs < 1000 ? `${log.durationMs}ms` : `${Math.round(log.durationMs / 1000)}s`}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {!isRunning && nodeLogs.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-8">
                                    Run the workflow to see live logs
                                </p>
                            )}
                        </div>
                    ) : (
                        /* History Tab */
                        <div className="space-y-2">
                            {executions.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">
                                    No execution history
                                </p>
                            ) : (
                                executions.map((exec) => (
                                    <button
                                        key={exec.id}
                                        className="w-full text-left rounded-lg border border-border bg-muted/50 p-3 hover:bg-accent/50 transition-colors cursor-pointer group"
                                        onClick={() => handleViewExecution(exec.id)}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {exec.status === "completed" && (
                                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                                )}
                                                {exec.status === "failed" && (
                                                    <XCircle className="h-3.5 w-3.5 text-rose-500" />
                                                )}
                                                {exec.status === "running" && (
                                                    <Loader2 className="h-3.5 w-3.5 text-sky-500 animate-spin" />
                                                )}
                                                <span className="text-sm font-medium capitalize">
                                                    {exec.status}
                                                </span>
                                                {getDuration(exec) && (
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {getDuration(exec)}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(exec.created_at).toLocaleString()}
                                                </span>
                                                <Eye className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </div>
                                        </div>
                                        {exec.error && (
                                            <p className="text-xs text-rose-500 mt-1 truncate">
                                                {exec.error}
                                            </p>
                                        )}
                                        {exec.node_outputs && (
                                            <p className="text-[10px] text-muted-foreground mt-1">
                                                {getNodeCount(exec)} node{getNodeCount(exec) !== 1 ? "s" : ""} executed
                                            </p>
                                        )}
                                    </button>
                                ))
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
