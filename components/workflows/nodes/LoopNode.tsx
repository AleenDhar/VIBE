"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Repeat, Loader2, CheckCircle2, XCircle } from "lucide-react";

type NodeStatus = "idle" | "running" | "completed" | "failed";

function LoopNodeComponent({ data, selected }: NodeProps) {
    const nodeData = data as any;
    const status: NodeStatus = nodeData.status || "idle";
    const arrayField = nodeData.arrayField || "items";
    const onError = nodeData.onError || "continue";
    const loopProgress = nodeData.loopProgress; // e.g. "3/54"

    const statusStyles: Record<NodeStatus, string> = {
        idle: selected ? "border-amber-500 shadow-lg shadow-amber-500/20" : "border-amber-400/50 dark:border-amber-500/40",
        running: "border-amber-500 shadow-lg shadow-amber-500/25 animate-pulse",
        completed: "border-emerald-500 shadow-lg shadow-emerald-500/25",
        failed: "border-rose-500 shadow-lg shadow-rose-500/25",
    };

    const StatusIcon = () => {
        switch (status) {
            case "running":
                return <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin" />;
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
                className="!w-3 !h-3 !bg-amber-500 !border-2 !border-card"
            />
            <div className="flex items-center gap-2">
                <div className="rounded-lg bg-amber-500/15 dark:bg-amber-500/10 p-1.5">
                    <Repeat className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                            Loop
                        </p>
                        <StatusIcon />
                    </div>
                    <p className="text-sm font-medium text-card-foreground truncate">
                        {nodeData.label || "Loop Over Items"}
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-1 mt-1.5">
                <span className="text-[10px] text-muted-foreground font-mono truncate">
                    field: {arrayField}
                </span>
            </div>
            {loopProgress && (
                <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 dark:bg-amber-500/5">
                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        Item {loopProgress}
                    </span>
                </div>
            )}
            <div className="flex items-center gap-1 mt-1">
                <span className="text-[10px] text-muted-foreground">
                    On error: {onError}
                </span>
            </div>
            {/* Body handle - left side of bottom */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="body"
                className="!w-3 !h-3 !bg-amber-500 !border-2 !border-card"
                style={{ left: '35%' }}
            />
            {/* Exit handle - right side of bottom */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="exit"
                className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-card"
                style={{ left: '65%' }}
            />
            {/* Labels for handles */}
            <div className="flex justify-between mt-1 px-1">
                <span className="text-[8px] text-amber-500 font-medium">body</span>
                <span className="text-[8px] text-emerald-500 font-medium">exit</span>
            </div>
        </div>
    );
}

export const LoopNode = memo(LoopNodeComponent);
