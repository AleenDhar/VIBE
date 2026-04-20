"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Tag as TagIcon, X, Plus, Loader2 } from "lucide-react";
import {
    addTagToProject,
    getAllTagsWithUsage,
    removeTagFromProject,
    type Tag,
    type TagWithUsage,
} from "@/lib/actions/tags";

interface TagManagerProps {
    projectId: string;
    canEdit: boolean;
    initialTags: Tag[];
}

export function TagManager({ projectId, canEdit, initialTags }: TagManagerProps) {
    const router = useRouter();
    const [tags, setTags] = useState<Tag[]>(initialTags);
    const [adding, setAdding] = useState(false);
    const [input, setInput] = useState("");
    const [allTags, setAllTags] = useState<TagWithUsage[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!adding) return;
        getAllTagsWithUsage().then(setAllTags).catch(() => { });
    }, [adding]);

    useEffect(() => {
        if (!adding) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                closeAdd();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [adding]);

    const closeAdd = () => {
        setAdding(false);
        setInput("");
        setShowSuggestions(false);
    };

    const normalizedInput = input.trim().toLowerCase();
    const existingNames = new Set(tags.map(t => t.name.toLowerCase()));
    const suggestions = allTags
        .filter(t => !existingNames.has(t.name.toLowerCase()))
        .filter(t => !normalizedInput || t.name.toLowerCase().includes(normalizedInput))
        .slice(0, 8);
    const exactMatch = allTags.some(t => t.name.toLowerCase() === normalizedInput);
    const alreadyOnProject = existingNames.has(normalizedInput);

    const submit = async (name: string) => {
        const clean = name.trim();
        if (!clean || submitting) return;
        if (existingNames.has(clean.toLowerCase())) {
            closeAdd();
            return;
        }
        setSubmitting(true);
        try {
            const result = await addTagToProject(projectId, clean);
            if (!result.success || !result.tag) {
                alert(result.error || "Failed to add tag.");
                return;
            }
            setTags(prev => [...prev, result.tag!].sort((a, b) => a.name.localeCompare(b.name)));
            setInput("");
            setShowSuggestions(false);
            router.refresh();
            inputRef.current?.focus();
        } finally {
            setSubmitting(false);
        }
    };

    const handleRemove = async (tag: Tag) => {
        setRemovingId(tag.id);
        try {
            const result = await removeTagFromProject(projectId, tag.id);
            if (!result.success) {
                alert(result.error || "Failed to remove tag.");
                return;
            }
            setTags(prev => prev.filter(t => t.id !== tag.id));
            router.refresh();
        } finally {
            setRemovingId(null);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            submit(input);
        } else if (e.key === "Escape") {
            closeAdd();
        }
    };

    if (!canEdit && tags.length === 0) return null;

    return (
        <div ref={containerRef} className="flex flex-wrap items-center gap-1.5">
            <TagIcon className="h-3.5 w-3.5 text-muted-foreground/70 mr-0.5" />
            {tags.map(tag => (
                <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                >
                    {tag.name}
                    {canEdit && (
                        <button
                            type="button"
                            onClick={() => handleRemove(tag)}
                            disabled={removingId === tag.id}
                            aria-label={`Remove tag ${tag.name}`}
                            className="hover:text-destructive disabled:opacity-50"
                        >
                            {removingId === tag.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <X className="h-3 w-3" />
                            )}
                        </button>
                    )}
                </span>
            ))}
            {canEdit && !adding && (
                <button
                    type="button"
                    onClick={() => {
                        setAdding(true);
                        setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                    <Plus className="h-3 w-3" />
                    Add tag
                </button>
            )}
            {canEdit && adding && (
                <div className="relative">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={e => {
                            setInput(e.target.value);
                            setShowSuggestions(true);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type and press Enter…"
                        disabled={submitting}
                        className="text-xs px-2 py-0.5 rounded-full border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 min-w-[160px]"
                    />
                    {showSuggestions && (suggestions.length > 0 || (normalizedInput && !exactMatch && !alreadyOnProject)) && (
                        <div className="absolute top-full left-0 mt-1 w-60 max-h-60 overflow-auto rounded-lg border border-border bg-popover shadow-lg z-20">
                            {suggestions.map(s => (
                                <button
                                    key={s.id}
                                    type="button"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => submit(s.name)}
                                    className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-left hover:bg-muted"
                                >
                                    <span>{s.name}</span>
                                    <span className="text-[10px] text-muted-foreground">{s.usage_count}</span>
                                </button>
                            ))}
                            {normalizedInput && !exactMatch && !alreadyOnProject && (
                                <button
                                    type="button"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => submit(input)}
                                    className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-left hover:bg-muted border-t border-border"
                                >
                                    <Plus className="h-3 w-3" />
                                    Create "{normalizedInput}"
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
