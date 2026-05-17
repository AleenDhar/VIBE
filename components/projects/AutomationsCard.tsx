"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Plus, Loader2, Workflow } from "lucide-react";
import { createAutomation, type ProjectAutomation } from "@/lib/actions/automations";
import { formatDistanceToNow } from "date-fns";

interface Props {
    projectId: string;
    canEdit: boolean;
    initialAutomations: ProjectAutomation[];
}

export function AutomationsCard({ projectId, canEdit, initialAutomations }: Props) {
    const router = useRouter();
    const [creating, setCreating] = useState(false);

    const handleCreate = async () => {
        if (!canEdit || creating) return;
        setCreating(true);
        try {
            const result = await createAutomation(projectId);
            if (!result.success || !result.automation) {
                alert(`Failed: ${result.error}`);
                return;
            }
            router.push(`/projects/${projectId}/automations/${result.automation.id}`);
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base text-foreground">Automations</h3>
                {canEdit && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={handleCreate}
                        disabled={creating}
                    >
                        {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        New
                    </Button>
                )}
            </div>

            {initialAutomations.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 leading-relaxed">
                    No automations yet. Batch-run prompts through the phase pipeline.
                </p>
            ) : (
                <div className="space-y-1.5">
                    {initialAutomations.map(a => (
                        <Link
                            key={a.id}
                            href={`/projects/${projectId}/automations/${a.id}`}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border hover:bg-muted/40 transition-colors"
                        >
                            <Workflow className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                            <span className="text-xs text-foreground truncate flex-1">
                                {a.name || "Untitled automation"}
                            </span>
                            <span className="text-[10px] text-muted-foreground/50 shrink-0">
                                {formatDistanceToNow(new Date(a.created_at))} ago
                            </span>
                        </Link>
                    ))}
                    <Link
                        href={`/projects/${projectId}/automations`}
                        className="block text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors pt-1"
                    >
                        View all →
                    </Link>
                </div>
            )}
        </div>
    );
}
