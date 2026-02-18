"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Pencil, Save, X } from "lucide-react";

interface SystemPromptCardProps {
    projectId: string;
    initialPrompt: string | null;
}

export function SystemPromptCard({ projectId, initialPrompt }: SystemPromptCardProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [prompt, setPrompt] = useState(initialPrompt || "");
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        const { updateSystemPrompt } = await import("@/lib/actions/projects");
        const result = await updateSystemPrompt(projectId, prompt);
        if (result.success) {
            setIsEditing(false);
        } else {
            alert("Failed to save: " + result.error);
        }
        setSaving(false);
    };

    const displayText = prompt
        ? prompt.length > 120 ? prompt.slice(0, 120) + "\u2026" : prompt
        : "No instructions set.";

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base text-foreground">Instructions</h3>
                {!isEditing ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => setIsEditing(true)}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
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
        </div>
    );
}
