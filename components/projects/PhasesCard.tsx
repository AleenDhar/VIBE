"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/switch";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Plus,
    Trash2,
    ChevronDown,
    ChevronRight,
    ArrowUp,
    ArrowDown,
    Pencil,
    Save,
    X,
    Loader2,
} from "lucide-react";
import {
    createPhase,
    deletePhase,
    listPhases,
    reorderPhases,
    togglePhase,
    updatePhase,
    type ProjectPhase,
} from "@/lib/actions/phases";
import { createClient } from "@/lib/supabase/client";
import { getActiveModels, getUserAllowedModels, type AIModel } from "@/lib/actions/models";
import { getCurrentUserRole } from "@/lib/actions/admin";

interface PhasesCardProps {
    projectId: string;
    canEdit: boolean;
    initialPhases: ProjectPhase[];
}

export function PhasesCard({ projectId, canEdit, initialPhases }: PhasesCardProps) {
    const [phases, setPhases] = useState<ProjectPhase[]>(initialPhases);
    const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftPrompt, setDraftPrompt] = useState("");
    const [draftName, setDraftName] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        // Pull active models the current user is allowed to use, same logic as ChatInterface.
        const supabase = createClient();
        (async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const [models, allowed, role] = await Promise.all([
                    getActiveModels(),
                    getUserAllowedModels(user.id),
                    getCurrentUserRole(),
                ]);
                // Fireworks phase models are super-admin-only (mirror ChatInterface).
                const isSuper = role === 'super_admin';
                setAvailableModels(
                    models.filter(m => m.provider === 'fireworks' ? isSuper : (m.is_available_to_all || allowed.includes(m.id) || isSuper))
                );
            } catch (e) {
                console.error("PhasesCard: failed to load models", e);
            }
        })();
    }, []);

    const refresh = async () => {
        const fresh = await listPhases(projectId);
        setPhases(fresh);
    };

    const modelNameFor = (id: string | null) =>
        id ? (availableModels.find(m => m.id === id)?.name || id) : "No model";

    const handleAdd = async () => {
        if (!canEdit || adding) return;
        setAdding(true);
        try {
            const result = await createPhase(projectId, {});
            if (!result.success) {
                alert(`Failed to add phase: ${result.error}`);
            } else if (result.phase) {
                await refresh();
                setExpandedId(result.phase.id);
                setEditingId(result.phase.id);
                setDraftPrompt(result.phase.system_prompt || "");
                setDraftName(result.phase.name || "");
            }
        } finally {
            setAdding(false);
        }
    };

    const handleDelete = async (phase: ProjectPhase) => {
        if (!canEdit) return;
        if (!confirm(`Delete ${phase.name || `Phase ${phase.position}`}?`)) return;
        setBusyId(phase.id);
        try {
            const result = await deletePhase(phase.id);
            if (!result.success) alert(`Failed: ${result.error}`);
            await refresh();
        } finally {
            setBusyId(null);
        }
    };

    const handleToggle = async (phase: ProjectPhase, enabled: boolean) => {
        if (!canEdit) return;
        // Optimistic update.
        setPhases(prev => prev.map(p => (p.id === phase.id ? { ...p, enabled } : p)));
        const result = await togglePhase(phase.id, enabled);
        if (!result.success) {
            alert(`Failed: ${result.error}`);
            await refresh();
        }
    };

    const handleSetModel = async (phase: ProjectPhase, modelId: string) => {
        if (!canEdit) return;
        setPhases(prev => prev.map(p => (p.id === phase.id ? { ...p, model_id: modelId } : p)));
        const result = await updatePhase(phase.id, { model_id: modelId });
        if (!result.success) {
            alert(`Failed: ${result.error}`);
            await refresh();
        }
    };

    const handleStartEdit = (phase: ProjectPhase) => {
        setEditingId(phase.id);
        setExpandedId(phase.id);
        setDraftPrompt(phase.system_prompt || "");
        setDraftName(phase.name || "");
    };

    const handleSaveEdit = async (phase: ProjectPhase) => {
        if (!canEdit) return;
        setBusyId(phase.id);
        try {
            const result = await updatePhase(phase.id, {
                system_prompt: draftPrompt,
                name: draftName.trim() || null,
            });
            if (!result.success) {
                alert(`Failed: ${result.error}`);
            } else {
                setEditingId(null);
                await refresh();
            }
        } finally {
            setBusyId(null);
        }
    };

    const handleMove = async (phase: ProjectPhase, direction: -1 | 1) => {
        if (!canEdit) return;
        const idx = phases.findIndex(p => p.id === phase.id);
        const swapIdx = idx + direction;
        if (swapIdx < 0 || swapIdx >= phases.length) return;

        const reordered = [...phases];
        [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
        setPhases(reordered);

        const result = await reorderPhases(projectId, reordered.map(p => p.id));
        if (!result.success) {
            alert(`Failed: ${result.error}`);
            await refresh();
        } else {
            await refresh();
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base text-foreground">Phases</h3>
                {canEdit && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={handleAdd}
                        disabled={adding}
                    >
                        {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Add phase
                    </Button>
                )}
            </div>

            {phases.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 leading-relaxed">
                    No phases. Chats run as a single model call using the project Instructions above.
                </p>
            ) : (
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                    Phases run in order on every user message. Each phase sees the full chat history
                    plus prior phase outputs and the project documents.
                </p>
            )}

            <div className="space-y-2">
                {phases.map((phase, idx) => {
                    const isExpanded = expandedId === phase.id;
                    const isEditing = editingId === phase.id;
                    const isBusy = busyId === phase.id;

                    return (
                        <div
                            key={phase.id}
                            className={`border rounded-lg overflow-hidden ${
                                phase.enabled ? "border-border" : "border-border/40 opacity-60"
                            }`}
                        >
                            {/* Row header */}
                            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/20">
                                <button
                                    onClick={() => setExpandedId(isExpanded ? null : phase.id)}
                                    className="flex items-center gap-1 min-w-0 flex-1 text-left"
                                >
                                    {isExpanded ? (
                                        <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                                    ) : (
                                        <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                                    )}
                                    <span className="text-xs font-medium text-foreground truncate">
                                        {phase.position}. {phase.name || `Phase ${phase.position}`}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground/60 truncate">
                                        · {modelNameFor(phase.model_id)}
                                    </span>
                                </button>

                                {canEdit && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => handleMove(phase, -1)}
                                            disabled={idx === 0 || isBusy}
                                            title="Move up"
                                        >
                                            <ArrowUp className="h-3 w-3" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => handleMove(phase, 1)}
                                            disabled={idx === phases.length - 1 || isBusy}
                                            title="Move down"
                                        >
                                            <ArrowDown className="h-3 w-3" />
                                        </Button>
                                        <Switch
                                            size="sm"
                                            checked={phase.enabled}
                                            onCheckedChange={(checked) => handleToggle(phase, checked)}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-muted-foreground/60 hover:text-destructive"
                                            onClick={() => handleDelete(phase)}
                                            disabled={isBusy}
                                            title="Delete phase"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </>
                                )}
                            </div>

                            {/* Expanded body */}
                            {isExpanded && (
                                <div className="p-3 space-y-3 bg-background/30">
                                    {/* Name + model row */}
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                        <div className="flex-1">
                                            <label className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                                                Name
                                            </label>
                                            {isEditing ? (
                                                <input
                                                    type="text"
                                                    className="w-full bg-muted/40 border border-border rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                                    placeholder={`Phase ${phase.position}`}
                                                    value={draftName}
                                                    onChange={(e) => setDraftName(e.target.value)}
                                                />
                                            ) : (
                                                <p className="text-xs text-foreground">
                                                    {phase.name || <span className="text-muted-foreground/60">—</span>}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                                                Model
                                            </label>
                                            {canEdit ? (
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 w-full justify-between text-xs border border-border bg-muted/40"
                                                        >
                                                            <span className="truncate">{modelNameFor(phase.model_id)}</span>
                                                            <ChevronDown className="h-3 w-3 shrink-0 ml-1" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                                                        {availableModels.length === 0 ? (
                                                            <DropdownMenuItem disabled>No models available</DropdownMenuItem>
                                                        ) : (
                                                            availableModels.map(m => (
                                                                <DropdownMenuItem
                                                                    key={m.id}
                                                                    onClick={() => handleSetModel(phase, m.id)}
                                                                >
                                                                    {m.name}
                                                                </DropdownMenuItem>
                                                            ))
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            ) : (
                                                <p className="text-xs text-foreground">{modelNameFor(phase.model_id)}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* System prompt */}
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                                                System prompt
                                            </label>
                                            {canEdit && !isEditing && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground/60"
                                                    onClick={() => handleStartEdit(phase)}
                                                    title="Edit prompt"
                                                >
                                                    <Pencil className="h-3 w-3" />
                                                </Button>
                                            )}
                                            {isEditing && (
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6"
                                                        onClick={() => setEditingId(null)}
                                                        title="Cancel"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        className="h-6 px-2 text-[10px]"
                                                        onClick={() => handleSaveEdit(phase)}
                                                        disabled={isBusy}
                                                    >
                                                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                        {isEditing ? (
                                            <textarea
                                                className="w-full min-h-[120px] bg-muted/40 border border-border rounded-md p-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                                                value={draftPrompt}
                                                onChange={(e) => setDraftPrompt(e.target.value)}
                                                placeholder="Enter system instructions for this phase…"
                                            />
                                        ) : (
                                            <pre className="text-xs text-muted-foreground bg-muted/20 rounded-md p-2 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono leading-relaxed">
                                                {phase.system_prompt || <span className="text-muted-foreground/40">No prompt set.</span>}
                                            </pre>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
