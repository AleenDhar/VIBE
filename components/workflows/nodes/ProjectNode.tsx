"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FolderOpen, Loader2, CheckCircle2, XCircle } from "lucide-react";

type NodeStatus = "idle" | "running" | "completed" | "failed";

function ProjectNodeComponent({ data, selected }: NodeProps) {
    const nodeData = data as any;
    const status: NodeStatus = nodeData.status || "idle";
    const projectName = nodeData.projectName || "Select Project";

    const statusStyles: Record<NodeStatus, string> = {
        idle: selected ? "border-primary shadow-lg shadow-primary/20" : "border-border dark:border-border",
        running: "border-sky-500 shadow-lg shadow-sky-500/25 animate-pulse",
        completed: "border-emerald-500 shadow-lg shadow-emerald-500/25",
        failed: "border-rose-500 shadow-lg shadow-rose-500/25",
    };

    const StatusIcon = () => {
        switch (status) {
            case "running":
                return <Loader2 className="h-3.5 w-3.5 text-sky-500 animate-spin" />;
            case "completed":
                return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
            case "failed":
                return <XCircle className="h-3.5 w-3.5 text-rose-500" />;
            default:
                return null;
        }
    };

    return (
        <div
            className={`rounded-xl border-2 px-4 py-3 bg-card shadow-md min-w-[200px] transition-all ${statusStyles[status]}`}
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!w-3 !h-3 !bg-primary !border-2 !border-card"
            />
            <div className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/15 dark:bg-primary/10 p-1.5">
                    <FolderOpen className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium text-primary uppercase tracking-wider">
                            Project
                        </p>
                        <StatusIcon />
                    </div>
                    <p className="text-sm font-medium text-card-foreground truncate">{projectName}</p>
                </div>
            </div>
            {nodeData.projectId && (
                <p className="text-[10px] text-muted-foreground mt-1 truncate">
                    ID: {nodeData.projectId}
                </p>
            )}
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-3 !h-3 !bg-primary !border-2 !border-card"
            />
        </div>
    );
}

export const ProjectNode = memo(ProjectNodeComponent);
