"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Loader2, Save, Eye, EyeOff } from "lucide-react";
import { updateApiKey } from "@/lib/actions/admin";

interface ApiKeyEditorProps {
    initialKeys: Record<string, string>;
}

export function ApiKeyList({ initialKeys }: ApiKeyEditorProps) {
    const [loading, setLoading] = useState<string | null>(null);

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold">LLM API Keys</h2>
            <p className="text-sm text-muted-foreground">
                Manage API keys for the AI models. These are stored securely in the database.
            </p>

            <div className="space-y-4">
                <ApiKeyRow
                    label="OpenAI (ChatGPT)"
                    dbKey="openai_api_key"
                    initialValue={initialKeys["openai_api_key"] || ""}
                />
                <ApiKeyRow
                    label="Google (Gemini)"
                    dbKey="google_api_key"
                    initialValue={initialKeys["google_api_key"] || ""}
                />
                <ApiKeyRow
                    label="Anthropic (Claude)"
                    dbKey="anthropic_api_key"
                    initialValue={initialKeys["anthropic_api_key"] || ""}
                />
                <hr className="my-2 border-muted" />
                <ApiKeyRow
                    label="Replit Agent API URL"
                    dbKey="agent_api_url"
                    initialValue={initialKeys["agent_api_url"] || "https://agent-salesforce-link.replit.app/api/chat/"}
                    isUrl={true}
                />
            </div>
        </div>
    );
}


function ApiKeyRow({ label, dbKey, initialValue, isUrl = false }: { label: string, dbKey: string, initialValue: string, isUrl?: boolean }) {
    const [value, setValue] = useState(initialValue);
    const [isSaving, setIsSaving] = useState(false);
    const [showKey, setShowKey] = useState(isUrl);
    const [hasChanged, setHasChanged] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const result = await updateApiKey(dbKey, value);
            if (result.success) {
                setHasChanged(false);
                alert("Saved successfully!");
            } else {
                alert("Error: " + result.error);
            }
        } catch (e) {
            console.error(e);
            alert("Failed to save.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-2 p-4 bg-muted/20 border rounded-lg">
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{label}</label>
                {hasChanged && (
                    <span className="text-xs text-amber-500 font-medium animate-pulse">Unsaved changes</span>
                )}
            </div>
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <input
                        type={showKey || isUrl ? "text" : "password"}
                        className="w-full bg-background border rounded-md px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder={`Enter ${label} Key...`}
                        value={value}
                        onChange={(e) => {
                            setValue(e.target.value);
                            setHasChanged(true);
                        }}
                    />
                    <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowKey(!showKey)}
                    >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
                <Button
                    onClick={handleSave}
                    disabled={!hasChanged || isSaving}
                    size="sm"
                    className="min-w-[80px]"
                >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                    Save
                </Button>
            </div>
        </div>
    );
}
