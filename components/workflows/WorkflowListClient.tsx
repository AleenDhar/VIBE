"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, GitBranch, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { createWorkflow, deleteWorkflow } from "@/lib/actions/workflows";

interface Workflow {
    id: string;
    name: string;
    description: string | null;
    updated_at: string;
    created_at: string;
}

export function WorkflowListClient({ workflows }: { workflows: Workflow[] }) {
    const router = useRouter();
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleCreate = async () => {
        setCreating(true);
        try {
            const result = await createWorkflow("Untitled Workflow");
            if (result.id) {
                router.push(`/workflow/${result.id}`);
            } else if (result.error) {
                console.error("Create workflow failed:", result.error);
                alert(`Failed to create workflow: ${result.error}`);
            }
        } catch (err) {
            console.error("Create workflow exception:", err);
            alert("Failed to create workflow. Please try again.");
        }
        setCreating(false);
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        await deleteWorkflow(id);
        router.refresh();
        setDeletingId(null);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Chain AI projects into automated sequences
                    </p>
                </div>
                <Button onClick={handleCreate} disabled={creating}>
                    {creating ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                        <Plus className="h-4 w-4 mr-2" />
                    )}
                    New Workflow
                </Button>
            </div>

            {workflows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="rounded-full bg-muted/50 p-4 mb-4">
                        <GitBranch className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <h3 className="text-lg font-medium mb-1">No workflows yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                        Create your first workflow to start automating AI tasks
                    </p>
                    <Button onClick={handleCreate} disabled={creating}>
                        <Plus className="h-4 w-4 mr-2" />
                        Create Workflow
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {workflows.map((workflow) => (
                        <Card
                            key={workflow.id}
                            className="group cursor-pointer transition-all hover:border-primary/50 hover:shadow-md relative"
                            onClick={() => router.push(`/workflow/${workflow.id}`)}
                        >
                            <CardHeader className="pb-2">
                                <div className="flex items-start justify-between">
                                    <CardTitle className="text-base font-medium truncate pr-8">
                                        {workflow.name}
                                    </CardTitle>
                                    <button
                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(workflow.id);
                                        }}
                                    >
                                        {deletingId === workflow.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <p className="text-xs text-muted-foreground">
                                    Updated {new Date(workflow.updated_at).toLocaleDateString()}
                                </p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
