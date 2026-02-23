"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Brain, Trash2, Loader2 } from "lucide-react";
import { extractChatMemories, deleteMemory } from "@/lib/actions/memories";

interface Memory {
    id: string;
    memory_type: string;
    content: string;
    sentiment: string;
    importance: number;
    created_at: string;
}

interface MemoryManagerProps {
    projectId: string;
    chatId?: string;
    memories: Memory[];
}

export function MemoryManager({ projectId, chatId, memories: initialMemories }: MemoryManagerProps) {
    const [memories, setMemories] = useState(initialMemories);
    const [extracting, setExtracting] = useState(false);

    const handleExtractMemories = async () => {
        if (!chatId) return;

        setExtracting(true);
        const result = await extractChatMemories(projectId, chatId);
        setExtracting(false);

        if (result.success) {
            alert(`✅ Extracted ${result.count} memories from this chat!`);
            window.location.reload(); // Refresh to show new memories
        } else {
            alert(`❌ Failed to extract memories: ${result.error}`);
        }
    };

    const handleDeleteMemory = async (memoryId: string) => {
        if (!confirm("Delete this memory?")) return;

        const result = await deleteMemory(memoryId);
        if (result.success) {
            setMemories(memories.filter(m => m.id !== memoryId));
        }
    };

    const getTypeColor = (type: string) => {
        const colors: Record<string, string> = {
            insight: "bg-blue-500/10 text-blue-500",
            preference: "bg-purple-500/10 text-purple-500",
            behavioral: "bg-amber-500/10 text-amber-500",
            issue: "bg-red-500/10 text-red-500",
            solution: "bg-green-500/10 text-green-500",
            feedback: "bg-yellow-500/10 text-yellow-500"
        };
        return colors[type] || "bg-gray-500/10 text-gray-500";
    };

    const getSentimentEmoji = (sentiment: string) => {
        const emojis: Record<string, string> = {
            positive: "😊",
            negative: "😞",
            neutral: "😐",
            rule: "⚡"
        };
        return emojis[sentiment] || "•";
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold">Project Memory</h3>
                    <span className="text-xs text-muted-foreground">({memories.length})</span>
                </div>
                {chatId && (
                    <Button
                        size="sm"
                        onClick={handleExtractMemories}
                        disabled={extracting}
                    >
                        {extracting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Extracting...
                            </>
                        ) : (
                            <>
                                <Brain className="h-4 w-4 mr-2" />
                                Extract Memories
                            </>
                        )}
                    </Button>
                )}
            </div>

            {memories.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                    No memories yet. Chat with the AI and extract insights!
                </p>
            ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                    {memories.map((memory) => (
                        <div
                            key={memory.id}
                            className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getTypeColor(memory.memory_type)}`}>
                                            {memory.memory_type}
                                        </span>
                                        <span className="text-xs">
                                            {getSentimentEmoji(memory.sentiment)}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            Importance: {memory.importance}/10
                                        </span>
                                    </div>
                                    <p className="text-sm">{memory.content}</p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 flex-shrink-0"
                                    onClick={() => handleDeleteMemory(memory.id)}
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
