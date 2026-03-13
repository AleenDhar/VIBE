"use client";

import { useState, useCallback, useRef, useEffect, DragEvent } from "react";
import {
    ReactFlow,
    Controls,
    Background,
    BackgroundVariant,
    addEdge,
    useNodesState,
    useEdgesState,
    type Connection,
    type Edge,
    type Node,
    type ReactFlowInstance,
    MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
    Save,
    Play,
    Loader2,
    ArrowLeft,
    Zap,
    FolderOpen,
    CheckCircle2,
    GripVertical,
    Clock,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TriggerNode } from "./nodes/TriggerNode";
import { ProjectNode } from "./nodes/ProjectNode";
import { WorkflowRunPanel } from "./WorkflowRunPanel";
import { NodeInspectorPanel } from "./NodeInspectorPanel";
import { updateWorkflow, getWorkflowExecutions } from "@/lib/actions/workflows";
import { cronToHuman } from "@/lib/workflows/cron-match";
import Link from "next/link";

const nodeTypes = {
    trigger: TriggerNode,
    project: ProjectNode,
};

interface Project {
    id: string;
    name: string;
    description: string | null;
}

interface AIModel {
    id: string;
    name: string;
    provider: string;
    is_available_to_all: boolean;
    is_active: boolean;
}

interface WorkflowBuilderProps {
    workflow: {
        id: string;
        name: string;
        description: string | null;
        definition: { nodes: Node[]; edges: Edge[] };
        schedule_enabled?: boolean;
        schedule_cron?: string | null;
        schedule_input?: string | null;
        schedule_timezone?: string | null;
    };
    projects: Project[];
    models: AIModel[];
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

export function WorkflowBuilder({ workflow, projects, models }: WorkflowBuilderProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState(
        workflow.definition?.nodes || []
    );
    const [edges, setEdges, onEdgesChange] = useEdgesState(
        workflow.definition?.edges || []
    );
    const [reactFlowInstance, setReactFlowInstance] =
        useState<ReactFlowInstance | null>(null);
    const [name, setName] = useState(workflow.name);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [showRunPanel, setShowRunPanel] = useState(false);
    const [runPanelInitialTab, setRunPanelInitialTab] = useState<"live" | "results" | "history" | undefined>(undefined);
    const [nodeLogs, setNodeLogs] = useState<NodeLog[]>([]);
    const [executions, setExecutions] = useState<any[]>([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [showInspector, setShowInspector] = useState(false);
    const [nodeRunDataMap, setNodeRunDataMap] = useState<Record<string, {
        input?: { structured: any; text: string } | null;
        output?: { structured: any; text: string } | null;
    }>>({});

    // Schedule state
    const [scheduleEnabled, setScheduleEnabled] = useState(workflow.schedule_enabled || false);
    const [scheduleCron, setScheduleCron] = useState(workflow.schedule_cron || "");
    const [scheduleInput, setScheduleInput] = useState(workflow.schedule_input || "");
    const [scheduleTimezone, setScheduleTimezone] = useState(workflow.schedule_timezone || "UTC");
    const [schedulePreset, setSchedulePreset] = useState<string>("custom");

    const reactFlowWrapper = useRef<HTMLDivElement>(null);

    useEffect(() => {
        getWorkflowExecutions(workflow.id).then(setExecutions);
    }, [workflow.id]);

    const onConnect = useCallback(
        (connection: Connection) => {
            setEdges((eds) =>
                addEdge(
                    {
                        ...connection,
                        animated: true,
                        markerEnd: { type: MarkerType.ArrowClosed },
                        style: { strokeWidth: 2 },
                    },
                    eds
                )
            );
        },
        [setEdges]
    );

    const onDragOver = useCallback((event: DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    }, []);

    const onDrop = useCallback(
        (event: DragEvent) => {
            event.preventDefault();
            const type = event.dataTransfer.getData("application/reactflow");
            if (!type || !reactFlowInstance) return;

            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            const newNode: Node = {
                id: `node_${Date.now()}`,
                type,
                position,
                data: {
                    label: type === "trigger" ? "Manual Trigger" : "Project Node",
                },
            };

            setNodes((nds) => nds.concat(newNode));
        },
        [reactFlowInstance, setNodes]
    );

    const handleSave = async () => {
        setSaving(true);
        // Update trigger node data to reflect schedule state
        const updatedNodes = nodes.map((n) => {
            if (n.type === "trigger") {
                return {
                    ...n,
                    data: {
                        ...n.data,
                        scheduleEnabled: scheduleEnabled,
                        scheduleCronHuman: scheduleEnabled && scheduleCron ? cronToHuman(scheduleCron) : undefined,
                    },
                };
            }
            return n;
        });
        setNodes(updatedNodes);

        await updateWorkflow(workflow.id, {
            name,
            definition: { nodes: updatedNodes, edges },
            schedule_enabled: scheduleEnabled,
            schedule_cron: scheduleCron || null,
            schedule_input: scheduleInput || null,
            schedule_timezone: scheduleTimezone,
        });
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const [triggerInput, setTriggerInput] = useState("");
    const [showTriggerDialog, setShowTriggerDialog] = useState(false);

    const handleRunClick = () => {
        // Check if there's a trigger node — if so, ask for input
        const hasTrigger = nodes.some((n) => n.type === "trigger");
        if (hasTrigger) {
            setShowTriggerDialog(true);
        } else {
            executeRun("");
        }
    };

    const executeRun = async (input: string) => {
        setShowTriggerDialog(false);
        setIsRunning(true);
        setNodeLogs([]);
        setRunPanelInitialTab("live");
        setShowRunPanel(true);

        // Update node statuses to idle
        setNodes((nds) =>
            nds.map((n) => ({ ...n, data: { ...n.data, status: "idle" } }))
        );

        try {
            const response = await fetch("/api/workflows/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    workflowId: workflow.id,
                    nodes,
                    edges,
                    triggerInput: input || undefined,
                }),
            });

            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = decoder.decode(value);
                const lines = text.split("\n").filter((l) => l.startsWith("data: "));

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line.slice(6));

                        if (data.event === "node_started") {
                            setNodes((nds) =>
                                nds.map((n) =>
                                    n.id === data.nodeId
                                        ? { ...n, data: { ...n.data, status: "running" } }
                                        : n
                                )
                            );
                            setNodeLogs((prev) => [
                                ...prev,
                                {
                                    nodeId: data.nodeId,
                                    label: data.label || data.nodeId,
                                    status: "running",
                                    timestamp: new Date().toISOString(),
                                },
                            ]);
                        } else if (data.event === "node_finished") {
                            setNodes((nds) =>
                                nds.map((n) =>
                                    n.id === data.nodeId
                                        ? { ...n, data: { ...n.data, status: "completed" } }
                                        : n
                                )
                            );
                            setNodeLogs((prev) =>
                                prev.map((l) =>
                                    l.nodeId === data.nodeId && l.status === "running"
                                        ? {
                                            ...l,
                                            status: "completed",
                                            output: data.output,
                                            hasStructuredOutput: data.hasStructuredOutput,
                                            durationMs: data.durationMs,
                                            aiSummary: data.aiSummary,
                                        }
                                        : l
                                )
                            );
                            // Capture run data for inspector
                            if (data.inputData || data.outputData) {
                                setNodeRunDataMap((prev) => ({
                                    ...prev,
                                    [data.nodeId]: {
                                        input: data.inputData || null,
                                        output: data.outputData || null,
                                    },
                                }));
                            }
                        } else if (data.event === "workflow_finished") {
                            // Enrich nodeRunDataMap with full structured data from pipeline summary
                            if (data.pipelineSummary) {
                                setNodeRunDataMap((prev) => {
                                    const next = { ...prev };
                                    for (const stage of data.pipelineSummary) {
                                        if (next[stage.nodeId]) {
                                            next[stage.nodeId] = {
                                                ...next[stage.nodeId],
                                                output: {
                                                    structured: stage.structured || next[stage.nodeId]?.output?.structured || null,
                                                    text: stage.text || next[stage.nodeId]?.output?.text || "",
                                                },
                                            };
                                        }
                                    }
                                    return next;
                                });
                            }
                        } else if (data.event === "node_error") {
                            setNodes((nds) =>
                                nds.map((n) =>
                                    n.id === data.nodeId
                                        ? { ...n, data: { ...n.data, status: "failed" } }
                                        : n
                                )
                            );
                            setNodeLogs((prev) =>
                                prev.map((l) =>
                                    l.nodeId === data.nodeId && l.status === "running"
                                        ? { ...l, status: "failed", error: data.error, durationMs: data.durationMs }
                                        : l
                                )
                            );
                        }
                    } catch {
                        // Skip malformed SSE lines
                    }
                }
            }
        } catch (error: any) {
            console.error("Workflow run error:", error);
        } finally {
            setIsRunning(false);
            getWorkflowExecutions(workflow.id).then(setExecutions);
        }
    };

    const handleNodeClick = useCallback((_: any, node: Node) => {
        setSelectedNodeId(node.id);
        setShowInspector(true);
        setShowRunPanel(false);
    }, []);

    const handlePaneClick = useCallback(() => {
        setSelectedNodeId(null);
        setShowInspector(false);
    }, []);

    // Handle project assignment when a project node is selected
    const assignProject = (projectId: string, projectName: string) => {
        if (!selectedNodeId) return;
        setNodes((nds) =>
            nds.map((n) =>
                n.id === selectedNodeId
                    ? { ...n, data: { ...n.data, projectId, projectName } }
                    : n
            )
        );
    };

    const selectedNode = nodes.find((n) => n.id === selectedNodeId);

    return (
        <div className="h-screen flex flex-col">
            {/* Trigger Input Dialog */}
            {showTriggerDialog && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center">
                    <div className="bg-card border border-border rounded-xl p-6 w-[480px] shadow-2xl">
                        <h3 className="text-lg font-semibold mb-1">Workflow Input</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                            Provide the input for this workflow run (e.g., account name, Salesforce ID, or instructions).
                        </p>
                        <textarea
                            className="w-full h-28 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                            placeholder="e.g., Build an org chart and map the buying committee for Acme Corp. Salesforce Account ID: 001XXXXXXXXX"
                            value={triggerInput}
                            onChange={(e) => setTriggerInput(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    executeRun(triggerInput);
                                }
                            }}
                        />
                        <div className="flex justify-end gap-2 mt-4">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowTriggerDialog(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => executeRun(triggerInput)}
                            >
                                <Play className="h-3.5 w-3.5 mr-1.5" />
                                Run Workflow
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card z-10">
                <div className="flex items-center gap-3">
                    <Link href="/workflows">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    </Link>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="text-lg font-medium bg-transparent border-none outline-none focus:ring-0 w-64"
                        placeholder="Workflow name"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setRunPanelInitialTab("history"); setShowRunPanel(true); }}
                        title="View execution history"
                    >
                        <Clock className="h-4 w-4 mr-1.5" />
                        History
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        ) : saved ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 mr-1.5" />
                        ) : (
                            <Save className="h-4 w-4 mr-1.5" />
                        )}
                        {saving ? "Saving..." : saved ? "Saved" : "Save"}
                    </Button>
                    <Button size="sm" onClick={handleRunClick} disabled={isRunning}>
                        {isRunning ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        ) : (
                            <Play className="h-4 w-4 mr-1.5" />
                        )}
                        {isRunning ? "Running..." : "Run"}
                    </Button>
                </div>
            </div>

            <div className="flex-1 flex">
                {/* Node Palette Sidebar */}
                <div className="w-56 border-r border-border bg-card p-4 flex flex-col gap-3">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                        Components
                    </h4>
                    <DraggableNode type="trigger" label="Manual Trigger" icon={Zap} color="violet" />
                    <DraggableNode type="project" label="Project Node" icon={FolderOpen} color="primary" />

                    {/* Schedule config when trigger node is selected */}
                    {selectedNode && selectedNode.type === "trigger" && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                                Schedule
                            </h4>
                            {/* Enable toggle */}
                            <label className="flex items-center gap-2 cursor-pointer mb-3">
                                <input
                                    type="checkbox"
                                    checked={scheduleEnabled}
                                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                                    className="rounded border-border"
                                />
                                <span className="text-sm">Enable schedule</span>
                            </label>

                            {scheduleEnabled && (
                                <div className="space-y-3">
                                    {/* Preset picker */}
                                    <div>
                                        <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Frequency</label>
                                        <select
                                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                                            value={schedulePreset}
                                            onChange={(e) => {
                                                setSchedulePreset(e.target.value);
                                                const presets: Record<string, string> = {
                                                    daily: "0 9 * * *",
                                                    weekdays: "0 9 * * 1-5",
                                                    weekly: "0 9 * * 1",
                                                    monthly: "0 9 1 * *",
                                                    "every-6h": "0 */6 * * *",
                                                    "every-12h": "0 */12 * * *",
                                                };
                                                if (presets[e.target.value]) {
                                                    setScheduleCron(presets[e.target.value]);
                                                }
                                            }}
                                        >
                                            <option value="daily">Daily</option>
                                            <option value="weekdays">Weekdays</option>
                                            <option value="weekly">Weekly (Monday)</option>
                                            <option value="monthly">Monthly (1st)</option>
                                            <option value="every-6h">Every 6 hours</option>
                                            <option value="every-12h">Every 12 hours</option>
                                            <option value="custom">Custom cron</option>
                                        </select>
                                    </div>

                                    {/* Cron expression (shown for custom, editable for all) */}
                                    <div>
                                        <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">
                                            Cron Expression
                                        </label>
                                        <input
                                            type="text"
                                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono"
                                            value={scheduleCron}
                                            onChange={(e) => {
                                                setScheduleCron(e.target.value);
                                                setSchedulePreset("custom");
                                            }}
                                            placeholder="0 9 * * *"
                                        />
                                        {scheduleCron && (
                                            <p className="text-[10px] text-violet-600 dark:text-violet-400 mt-1">
                                                {cronToHuman(scheduleCron)}
                                            </p>
                                        )}
                                    </div>

                                    {/* Timezone */}
                                    <div>
                                        <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">Timezone</label>
                                        <select
                                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                                            value={scheduleTimezone}
                                            onChange={(e) => setScheduleTimezone(e.target.value)}
                                        >
                                            <option value="UTC">UTC</option>
                                            <option value="America/New_York">US Eastern</option>
                                            <option value="America/Chicago">US Central</option>
                                            <option value="America/Denver">US Mountain</option>
                                            <option value="America/Los_Angeles">US Pacific</option>
                                            <option value="Europe/London">London</option>
                                            <option value="Europe/Paris">Paris</option>
                                            <option value="Asia/Kolkata">India (IST)</option>
                                            <option value="Asia/Tokyo">Tokyo</option>
                                            <option value="Australia/Sydney">Sydney</option>
                                        </select>
                                    </div>

                                    {/* Default input */}
                                    <div>
                                        <label className="text-[10px] font-medium text-muted-foreground uppercase mb-1 block">
                                            Default Input
                                        </label>
                                        <textarea
                                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm resize-none h-16"
                                            value={scheduleInput}
                                            onChange={(e) => setScheduleInput(e.target.value)}
                                            placeholder="Input passed to workflow on each scheduled run..."
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Project selector when a project node is selected */}
                    {selectedNode && selectedNode.type === "project" && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                Assign Project
                            </h4>
                            <div className="space-y-1 max-h-60 overflow-y-auto">
                                {projects.map((p) => (
                                    <button
                                        key={p.id}
                                        className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                                            (selectedNode.data as any).projectId === p.id
                                                ? "bg-primary/10 text-primary"
                                                : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                        }`}
                                        onClick={() => assignProject(p.id, p.name)}
                                    >
                                        {p.name}
                                    </button>
                                ))}
                                {projects.length === 0 && (
                                    <p className="text-xs text-muted-foreground italic">
                                        No projects available
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Model selector for project nodes */}
                    {selectedNode && selectedNode.type === "project" && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                AI Model
                            </h4>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                {models.map((m) => (
                                    <button
                                        key={m.id}
                                        className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                                            ((selectedNode.data as any).model || "anthropic:claude-haiku-4-5") === m.id
                                                ? "bg-primary/10 text-primary"
                                                : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                        }`}
                                        onClick={() => {
                                            setNodes((nds) =>
                                                nds.map((n) =>
                                                    n.id === selectedNode.id
                                                        ? { ...n, data: { ...n.data, model: m.id, modelName: m.name } }
                                                        : n
                                                )
                                            );
                                        }}
                                    >
                                        <span className="font-medium">{m.name}</span>
                                        <span className="text-xs text-muted-foreground ml-1.5 capitalize">— {m.provider}</span>
                                    </button>
                                ))}
                                {models.length === 0 && (
                                    <p className="text-xs text-muted-foreground italic">No models available</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Delete selected node */}
                    {selectedNode && (
                        <div className="mt-4 pt-4 border-t border-border">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                                onClick={() => {
                                    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
                                    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                                    setSelectedNodeId(null);
                                    setShowInspector(false);
                                }}
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                                Delete Node
                            </Button>
                        </div>
                    )}
                </div>

                {/* Canvas */}
                <div className="flex-1" ref={reactFlowWrapper}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onInit={setReactFlowInstance}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        onNodeClick={handleNodeClick}
                        onPaneClick={handlePaneClick}
                        nodeTypes={nodeTypes}
                        fitView
                        deleteKeyCode={["Backspace", "Delete"]}
                        className="bg-muted/30 dark:bg-muted/20"
                    >
                        <Controls className="!bg-card !border-border !rounded-lg !shadow-md [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent" />
                        <Background
                            variant={BackgroundVariant.Dots}
                            gap={20}
                            size={1}
                            className="!bg-muted/30 dark:!bg-muted/20"
                        />
                    </ReactFlow>
                </div>
            </div>

            {/* Run Panel */}
            <WorkflowRunPanel
                isOpen={showRunPanel && !showInspector}
                onClose={() => { setShowRunPanel(false); setRunPanelInitialTab(undefined); }}
                nodeLogs={nodeLogs}
                isRunning={isRunning}
                executions={executions}
                nodeRunDataMap={nodeRunDataMap}
                nodeOrder={nodes.map((n) => ({ id: n.id, label: (n.data as any)?.label || n.id, type: n.type || "" }))}
                onRerun={() => handleRunClick()}
                initialTab={runPanelInitialTab}
            />

            {/* Node Inspector Panel */}
            <NodeInspectorPanel
                isOpen={showInspector}
                onClose={() => { setShowInspector(false); setSelectedNodeId(null); }}
                node={selectedNode || null}
                nodeRunData={selectedNodeId ? {
                    nodeId: selectedNodeId,
                    ...nodeRunDataMap[selectedNodeId],
                } : null}
                edges={edges.map(e => ({ source: e.source, target: e.target }))}
                nodes={nodes}
            />
        </div>
    );
}

function DraggableNode({
    type,
    label,
    icon: Icon,
    color,
}: {
    type: string;
    label: string;
    icon: any;
    color: string;
}) {
    const onDragStart = (event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.setData("application/reactflow", type);
        event.dataTransfer.effectAllowed = "move";
    };

    return (
        <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background cursor-grab hover:border-primary/40 hover:bg-accent transition-colors"
            draggable
            onDragStart={onDragStart}
        >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
            <Icon className={`h-4 w-4 ${color === "violet" ? "text-violet-500" : "text-primary"}`} />
            <span className="text-sm">{label}</span>
        </div>
    );
}
