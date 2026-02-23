"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Brain, Trash2, Loader2, Plus, X, Edit2 } from "lucide-react";
import { extractChatMemories, deleteMemory, addManualMemory, updateMemory } from "@/lib/actions/memories";

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
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [saving, setSaving] = useState(false);

    // Form state (Shared for Add/Edit)
    const [content, setContent] = useState("");
    const [type, setType] = useState<any>("insight");
    const [importance, setImportance] = useState(5);

    const handleExtractMemories = async () => {
        if (!chatId) return;

        setExtracting(true);
        const result = await extractChatMemories(projectId, chatId);
        setExtracting(false);

        if (result.success) {
            alert(`✅ Extracted ${result.count} memories from this chat!`);
            window.location.reload();
        } else {
            alert(`❌ Failed to extract memories: ${result.error}`);
        }
    };

    const handleAddManual = async () => {
        if (!content.trim()) return;

        setSaving(true);
        const result = await addManualMemory(projectId, {
            content,
            memory_type: type,
            importance: importance,
            sentiment: type === 'behavioral' ? 'rule' : 'neutral'
        });
        setSaving(false);

        if (result.success) {
            cancelAction();
            window.location.reload();
        } else {
            alert(`❌ Error: ${result.error}`);
        }
    };

    const handleUpdate = async () => {
        if (!editingId || !content.trim()) return;

        setSaving(true);
        const result = await updateMemory(editingId, projectId, {
            content,
            memory_type: type,
            importance: importance,
            sentiment: type === 'behavioral' ? 'rule' : 'neutral'
        });
        setSaving(false);

        if (result.success) {
            cancelAction();
            window.location.reload();
        } else {
            alert(`❌ Error: ${result.error}`);
        }
    };

    const startEditing = (memory: Memory) => {
        setEditingId(memory.id);
        setIsAdding(false);
        setContent(memory.content);
        setType(memory.memory_type);
        setImportance(memory.importance);
    };

    const cancelAction = () => {
        setIsAdding(false);
        setEditingId(null);
        setContent("");
        setType("insight");
        setImportance(5);
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

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-primary" />
                    <h3 className="font-semibold">Project Memory</h3>
                    <span className="text-xs text-muted-foreground">({memories.length})</span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
                        onClick={() => {
                            if (isAdding || editingId) cancelAction();
                            else setIsAdding(true);
                        }}
                    >
                        {(isAdding || editingId) ? <X className="h-3 w-3" /> : <Plus className="h-3.5 w-3.5" />}
                    </Button>
                </div>

                {chatId && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-8"
                        onClick={handleExtractMemories}
                        disabled={extracting}
                    >
                        {extracting ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                            <Brain className="h-3 w-3 mr-1" />
                        )}
                        Extract
                    </Button>
                )}
            </div>

            {/* Add/Edit Form */}
            {(isAdding || editingId) && (
                <div className="p-4 border rounded-lg bg-primary/5 dark:bg-primary/10 border-primary/20 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary">
                            {editingId ? "Edit Memory" : "Add New Memory"}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <select
                            className="bg-background border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary outline-none"
                            value={type}
                            onChange={(e) => setType(e.target.value)}
                        >
                            <option value="insight">Insight</option>
                            <option value="preference">Preference</option>
                            <option value="behavioral">Behavioral Rule</option>
                            <option value="issue">Issue</option>
                            <option value="solution">Solution</option>
                            <option value="feedback">Feedback</option>
                        </select>
                        <select
                            className="bg-background border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary outline-none"
                            value={importance}
                            onChange={(e) => setImportance(parseInt(e.target.value))}
                        >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                <option key={n} value={n}>Imp: {n}</option>
                            ))}
                        </select>
                    </div>
                    <textarea
                        className="w-full bg-background border rounded-lg p-3 text-sm min-h-[100px] focus:ring-1 focus:ring-primary outline-none resize-none"
                        placeholder="What should the AI remember?"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        autoFocus
                    />
                    <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={cancelAction}>Cancel</Button>
                        <Button size="sm" onClick={editingId ? handleUpdate : handleAddManual} disabled={saving || !content.trim()}>
                            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                            {saving ? "Saving..." : (editingId ? "Update Memory" : "Add Memory")}
                        </Button>
                    </div>
                </div>
            )}

            {memories.length === 0 && !isAdding ? (
                <p className="text-sm text-muted-foreground italic">
                    No memories yet. Chat with the AI and extract insights!
                </p>
            ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {memories.map((memory) => (
                        <div
                            key={memory.id}
                            className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors group"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${getTypeColor(memory.memory_type)}`}>
                                            {memory.memory_type}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground font-medium">
                                            Imp: {memory.importance}/10
                                        </span>
                                    </div>
                                    <p className="text-sm leading-relaxed">{memory.content}</p>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-primary transition-colors"
                                        onClick={() => startEditing(memory)}
                                    >
                                        <Edit2 className="h-3 w-3" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-destructive transition-colors"
                                        onClick={() => handleDeleteMemory(memory.id)}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
