"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Loader2, Save, Brain, Settings } from "lucide-react";
import { updateExtractionPrompt } from "@/lib/actions/admin";

interface Props {
    initialSystem: string;
    initialAnalysis: string;
}

export function ExtractionPromptEditor({ initialSystem, initialAnalysis }: Props) {
    const [system, setSystem] = useState(initialSystem);
    const [analysis, setAnalysis] = useState(initialAnalysis);
    const [saving, setSaving] = useState<string | null>(null);

    const handleSave = async (key: "system" | "analysis") => {
        setSaving(key);
        const value = key === "system" ? system : analysis;
        const result = await updateExtractionPrompt(key, value);
        setSaving(null);

        if (result.success) {
            alert(`✅ ${key === "system" ? "System" : "Analysis"} prompt updated successfully!`);
        } else {
            alert("❌ Error updating prompt: " + result.error);
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex items-center gap-2 border-b pb-4">
                <Brain className="h-6 w-6 text-primary" />
                <h2 className="text-xl font-semibold text-foreground">Instruction Extraction Engine</h2>
            </div>

            {/* System Prompt Section */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Settings className="h-4 w-4 text-muted-foreground" />
                        <h3 className="font-medium">System Persona</h3>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => handleSave("system")}
                        disabled={saving !== null}
                    >
                        {saving === "system" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <Save className="mr-2 h-4 w-4" />
                                Save System Prompt
                            </>
                        )}
                    </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                    Defines the expertise and persona of the AI reviewer.
                </p>
                <textarea
                    className="w-full h-32 p-4 border rounded-md font-mono text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={system}
                    onChange={(e) => setSystem(e.target.value)}
                    placeholder="You are an expert Behavior Analyst..."
                />
            </div>

            {/* Analysis Prompt Section */}
            <div className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Brain className="h-4 w-4 text-muted-foreground" />
                        <h3 className="font-medium">Analysis Logic (Extraction Rules)</h3>
                    </div>
                    <Button
                        size="sm"
                        onClick={() => handleSave("analysis")}
                        disabled={saving !== null}
                    >
                        {saving === "analysis" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <Save className="mr-2 h-4 w-4" />
                                Save Analysis Rules
                            </>
                        )}
                    </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                    Tells the AI exactly what patterns, mistakes, and preferences to look for in the conversation.
                </p>
                <textarea
                    className="w-full h-64 p-4 border rounded-md font-mono text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none transition-all"
                    value={analysis}
                    onChange={(e) => setAnalysis(e.target.value)}
                    placeholder="Analyze the following conversation history..."
                />
            </div>
        </div>
    );
}
