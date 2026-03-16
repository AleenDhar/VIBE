"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Send, Loader2, CheckCircle2, XCircle } from "lucide-react";

type NodeStatus = "idle" | "running" | "completed" | "failed";

function DispatchNodeComponent({ data, selected }: NodeProps) {
    const nodeData = data as any;
    const status: NodeStatus = nodeData.status || "idle";
    const dispatchCount = nodeData.dispatchCount; // e.g. "3/54 dispatched"

    const statusStyles: Record<NodeStatus, string> = {
        idle: selected ? "border-sky-500 shadow-lg shadow-sky-500/20" : "border-sky-400/50 dark:border-sky-500/40",
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
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-card"
            />
            <div className="flex items-center gap-2">
                <div className="rounded-lg bg-sky-500/15 dark:bg-sky-500/10 p-1.5">
                    <Send className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium text-sky-600 dark:text-sky-400 uppercase tracking-wider">
                            Dispatch
                        </p>
                        <StatusIcon />
                    </div>
                    <p className="text-sm font-medium text-card-foreground truncate">
                        {nodeData.label || "Dispatch to BDR"}
                    </p>
                </div>
            </div>
            {nodeData.model && (
                <div className="flex items-center gap-1 mt-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono truncate">
                        model: {nodeData.modelName || nodeData.model}
                    </span>
                </div>
            )}
            {dispatchCount && (
                <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-sky-500/10 dark:bg-sky-500/5">
                    <span className="text-[10px] font-medium text-sky-600 dark:text-sky-400">
                        {dispatchCount}
                    </span>
                </div>
            )}
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-3 !h-3 !bg-sky-500 !border-2 !border-card"
            />
        </div>
    );
}

export const DispatchNode = memo(DispatchNodeComponent);
