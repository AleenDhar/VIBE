"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Plus, Trash2, Loader2 } from "lucide-react";
import {
    createAutomation,
    deleteAutomation,
    type ProjectAutomation,
} from "@/lib/actions/automations";
import { formatDistanceToNow } from "date-fns";

interface Props {
    projectId: string;
    initialAutomations: ProjectAutomation[];
    canEdit: boolean;
}

export function AutomationsListClient({ projectId, initialAutomations, canEdit }: Props) {
    const router = useRouter();
    const [automations, setAutomations] = useState(initialAutomations);
    const [creating, setCreating] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);

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

    const handleDelete = async (a: ProjectAutomation) => {
        if (!confirm(`Delete "${a.name || "automation"}" and all its tasks?`)) return;
        setBusyId(a.id);
        try {
            const result = await deleteAutomation(a.id);
            if (!result.success) {
                alert(`Failed: ${result.error}`);
            } else {
                setAutomations(prev => prev.filter(x => x.id !== a.id));
            }
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-end">
                {canEdit && (
                    <Button onClick={handleCreate} disabled={creating} className="gap-2">
                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        New automation
                    </Button>
                )}
            </div>

            {automations.length === 0 ? (
                <div className="border border-dashed border-border/50 rounded-xl p-10 text-center text-muted-foreground">
                    No automations yet. {canEdit && "Click New automation to create one."}
                </div>
            ) : (
                <div className="space-y-2">
                    {automations.map(a => (
                        <div
                            key={a.id}
                            className="flex items-center justify-between gap-3 border border-border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                        >
                            <Link
                                href={`/projects/${projectId}/automations/${a.id}`}
                                className="flex-1 min-w-0"
                            >
                                <div className="font-medium text-foreground truncate">
                                    {a.name || "Untitled automation"}
                                </div>
                                {a.description && (
                                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                                        {a.description}
                                    </div>
                                )}
                                <div className="text-[10px] text-muted-foreground/60 mt-1">
                                    Created {formatDistanceToNow(new Date(a.created_at))} ago
                                </div>
                            </Link>
                            {canEdit && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleDelete(a)}
                                    disabled={busyId === a.id}
                                >
                                    {busyId === a.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Trash2 className="h-4 w-4" />
                                    )}
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
