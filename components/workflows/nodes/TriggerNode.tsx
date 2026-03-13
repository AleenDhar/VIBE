"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap, Clock, Timer } from "lucide-react";

function TriggerNodeComponent({ data, selected }: NodeProps) {
    const nodeData = data as any;
    const scheduleEnabled = nodeData.scheduleEnabled;
    const scheduleCron = nodeData.scheduleCronHuman; // Human-readable cron string

    return (
        <div
            className={`rounded-xl border-2 px-4 py-3 bg-card shadow-md min-w-[180px] transition-all ${
                selected ? "border-violet-500 shadow-lg shadow-violet-500/25" : "border-violet-400/50 dark:border-violet-500/40"
            }`}
        >
            <div className="flex items-center gap-2">
                <div className="rounded-lg bg-violet-500/15 dark:bg-violet-500/10 p-1.5">
                    {scheduleEnabled ? (
                        <Timer className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    ) : (
                        <Zap className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    )}
                </div>
                <div>
                    <p className="text-xs font-medium text-violet-600 dark:text-violet-400 uppercase tracking-wider">
                        Trigger
                    </p>
                    <p className="text-sm font-medium text-card-foreground">
                        {nodeData.label || "Manual Trigger"}
                    </p>
                </div>
            </div>
            {scheduleEnabled && scheduleCron && (
                <div className="mt-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-violet-500/10 dark:bg-violet-500/5">
                    <Clock className="h-3 w-3 text-violet-500" />
                    <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400">
                        {scheduleCron}
                    </span>
                </div>
            )}
            <Handle
                type="source"
                position={Position.Bottom}
                className="!w-3 !h-3 !bg-violet-500 !border-2 !border-card"
            />
        </div>
    );
}

export const TriggerNode = memo(TriggerNodeComponent);
