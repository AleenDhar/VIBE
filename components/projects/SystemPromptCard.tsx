"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Pencil, Save, X, History, ChevronDown, ChevronRight, RotateCcw, Clock, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { SystemPromptVersion } from "@/lib/actions/projects";

interface SystemPromptCardProps {
    projectId: string;
    initialPrompt: string | null;
    canEdit: boolean;
    initialVersions: SystemPromptVersion[];
}

export function SystemPromptCard({ projectId, initialPrompt, canEdit, initialVersions }: SystemPromptCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [prompt, setPrompt] = useState(initialPrompt || "");
    const [saving, setSaving] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
    const [versions, setVersions] = useState<SystemPromptVersion[]>(initialVersions);

    const handleSave = async () => {
        setSaving(true);
        const { updateSystemPrompt, getSystemPromptVersions } = await import("@/lib/actions/projects");
        const result = await updateSystemPrompt(projectId, prompt);
        if (result.success) {
            setIsEditing(false);
            // Refresh versions
            const updated = await getSystemPromptVersions(projectId);
            setVersions(updated);
        } else {
            alert("Failed to save: " + result.error);
        }
        setSaving(false);
    };

    const handleRestore = (content: string) => {
        setPrompt(content);
        setIsEditing(true);
        setShowHistory(false);
    };

    const displayText = prompt
        ? prompt.length > 120 ? prompt.slice(0, 120) + "\u2026" : prompt
        : "No instructions set.";

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base text-foreground">Instructions</h3>
                <div className="flex items-center gap-1">
                    {versions.length > 0 && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowHistory(prev => !prev)}
                            title="Version history"
                        >
                            <History className="h-4 w-4" />
                        </Button>
                    )}
                    {!isEditing ? (
                        canEdit && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setIsEditing(true)}
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        )
                    ) : (
                        <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setPrompt(initialPrompt || ""); setIsEditing(false); }}>
                                <X className="h-4 w-4" />
                            </Button>
                            <Button size="sm" className="h-7 px-3 text-xs" onClick={handleSave} disabled={saving}>
                                {saving ? "Saving..." : "Save"}
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {isEditing ? (
                <textarea
                    className="w-full min-h-[160px] bg-muted/50 border border-border rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter system instructions for the AI..."
                    autoFocus
                />
            ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">
                    {displayText}
                </p>
            )}

            {/* Last edited info */}
            {versions.length > 0 && !isEditing && (
                <p className="text-[11px] text-muted-foreground/40 flex items-center gap-1 mt-1">
                    <User className="h-3 w-3" />
                    Last edited by <span className="text-muted-foreground/60">{versions[0].edited_by_name}</span>
                    <span className="mx-0.5">·</span>
                    <Clock className="h-2.5 w-2.5" />
                    {formatDistanceToNow(new Date(versions[0].created_at))} ago
                </p>
            )}

            {/* Version History */}
            {showHistory && versions.length > 0 && (
                <div className="border border-border/30 rounded-lg overflow-hidden mt-3">
                    <div className="px-3 py-2 bg-muted/30 border-b border-border/20 flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                            <History className="h-3 w-3" />
                            Version History ({versions.length})
                        </span>
                        <button onClick={() => setShowHistory(false)} className="text-muted-foreground/40 hover:text-foreground">
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                    <div className="divide-y divide-border/10 max-h-64 overflow-y-auto">
                        {versions.map((v, i) => {
                            const isExpanded = expandedVersion === v.id;
                            const isCurrent = i === 0;
                            return (
                                <div key={v.id} className="bg-background/40">
                                    <button
                                        onClick={() => setExpandedVersion(isExpanded ? null : v.id)}
                                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-accent/10 transition-colors text-left"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />}
                                            <span className="text-xs text-foreground/70 truncate">
                                                {v.edited_by_name}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground/40">·</span>
                                            <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                                                <Clock className="h-2.5 w-2.5" />
                                                {formatDistanceToNow(new Date(v.created_at))} ago
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                            {isCurrent && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/25 font-medium">
                                                    Current
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                    {isExpanded && (
                                        <div className="px-3 pb-3 space-y-2">
                                            <pre className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2.5 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono leading-relaxed">
                                                {v.content}
                                            </pre>
                                            {!isCurrent && canEdit && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                                                    onClick={() => handleRestore(v.content)}
                                                >
                                                    <RotateCcw className="h-3 w-3 mr-1" />
                                                    Restore this version
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
