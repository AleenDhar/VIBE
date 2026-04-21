"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, FolderPlus, Users, Tag as TagIcon, ChevronDown, Check } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProjectCardActions } from "@/components/projects/ProjectCardActions";
import type { Tag, TagWithUsage } from "@/lib/actions/tags";

interface Project {
    id: string;
    name: string;
    description: string | null;
    owner_id: string;
    visibility: string;
    status: string;
    created_at: string;
}

export function ProjectsGrid({
    myProjects,
    sharedProjects,
    userId,
    isAdmin,
    tagsByProject,
    allTags,
}: {
    myProjects: Project[];
    sharedProjects: Project[];
    userId: string;
    isAdmin: boolean;
    tagsByProject: Record<string, Tag[]>;
    allTags: TagWithUsage[];
}) {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
    const [tagFilterOpen, setTagFilterOpen] = useState(false);
    const tagFilterRef = useRef<HTMLDivElement>(null);
    const lq = searchQuery.toLowerCase();

    useEffect(() => {
        if (!tagFilterOpen) return;
        const handle = (e: MouseEvent) => {
            if (tagFilterRef.current && !tagFilterRef.current.contains(e.target as Node)) {
                setTagFilterOpen(false);
            }
        };
        document.addEventListener("mousedown", handle);
        return () => document.removeEventListener("mousedown", handle);
    }, [tagFilterOpen]);

    const toggleTag = (tagId: string) => {
        setSelectedTagIds(prev =>
            prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
        );
    };

    const filterProjects = (projects: Project[]) => {
        return projects.filter(p => {
            if (lq) {
                const matchesText =
                    p.name.toLowerCase().includes(lq) ||
                    (p.description || "").toLowerCase().includes(lq);
                if (!matchesText) return false;
            }
            if (selectedTagIds.length > 0) {
                const projTagIds = new Set((tagsByProject[p.id] || []).map(t => t.id));
                // Match if any selected tag is present (OR).
                if (!selectedTagIds.some(id => projTagIds.has(id))) return false;
            }
            return true;
        });
    };

    const filteredMy = filterProjects(myProjects);
    const filteredShared = filterProjects(sharedProjects);
    const filtersActive = lq.length > 0 || selectedTagIds.length > 0;
    const selectedTags = allTags.filter(t => selectedTagIds.includes(t.id));

    const ProjectCard = ({ project }: { project: Project }) => {
        const projectTags = tagsByProject[project.id] || [];
        return (
            <div className="relative group">
                <Link key={project.id} href={`/projects/${project.id}`}>
                    <Card className="h-full transition-all hover:border-primary hover:shadow-md cursor-pointer">
                        <CardHeader>
                            <div className="flex justify-between items-start">
                                <CardTitle className="break-words">{project.name}</CardTitle>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {project.visibility === 'public' && (
                                        <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full whitespace-nowrap">
                                            Public
                                        </span>
                                    )}
                                    {project.owner_id !== userId && (
                                        <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full whitespace-nowrap">
                                            Shared
                                        </span>
                                    )}
                                </div>
                            </div>
                            <CardDescription className="line-clamp-2">
                                {project.description || "No description provided."}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {projectTags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {projectTags.map(tag => (
                                        <span
                                            key={tag.id}
                                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                                        >
                                            {tag.name}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>
                                    {new Date(project.created_at).toLocaleDateString()}
                                </span>
                                <span className="capitalize px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">
                                    {project.status}
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                </Link>
                <div className="absolute top-3 right-3 z-10">
                    <ProjectCardActions projectId={project.id} projectName={project.name} />
                </div>
            </div>
        );
    };

    return (
        <>
            {/* Search + tag filter */}
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="relative max-w-md flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search projects…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full bg-muted/30 border border-border/20 rounded-xl py-2.5 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/40"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                <div ref={tagFilterRef} className="relative">
                    <button
                        type="button"
                        onClick={() => setTagFilterOpen(o => !o)}
                        className={`inline-flex items-center gap-2 text-sm px-3 py-2.5 rounded-xl border transition-colors ${selectedTagIds.length > 0
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-muted/30 border-border/20 text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        <TagIcon className="h-4 w-4" />
                        <span>
                            {selectedTagIds.length === 0
                                ? "Filter by tag"
                                : `${selectedTagIds.length} tag${selectedTagIds.length > 1 ? "s" : ""}`}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                    </button>
                    {tagFilterOpen && (
                        <div className="absolute top-full left-0 mt-1 w-64 max-h-72 overflow-auto rounded-xl border border-border bg-popover shadow-lg z-20 p-1">
                            {allTags.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground">
                                    No tags created yet.
                                </div>
                            ) : (
                                <>
                                    {selectedTagIds.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedTagIds([])}
                                            className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
                                        >
                                            Clear all
                                        </button>
                                    )}
                                    {allTags.map(t => {
                                        const selected = selectedTagIds.includes(t.id);
                                        return (
                                            <button
                                                key={t.id}
                                                type="button"
                                                onClick={() => toggleTag(t.id)}
                                                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted rounded-md"
                                            >
                                                <span className="flex items-center gap-2">
                                                    <span
                                                        className={`h-4 w-4 rounded border flex items-center justify-center ${selected
                                                            ? "bg-primary border-primary text-primary-foreground"
                                                            : "border-border"
                                                            }`}
                                                    >
                                                        {selected && <Check className="h-3 w-3" />}
                                                    </span>
                                                    {t.name}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground">
                                                    {t.usage_count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {selectedTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Filtering by:</span>
                    {selectedTags.map(t => (
                        <span
                            key={t.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
                        >
                            {t.name}
                            <button
                                type="button"
                                onClick={() => toggleTag(t.id)}
                                aria-label={`Remove filter ${t.name}`}
                                className="hover:text-destructive"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* My Projects */}
            <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                    <FolderPlus className="h-5 w-5 text-primary" />
                    My Projects
                    {filtersActive && <span className="text-sm font-normal text-muted-foreground">({filteredMy.length})</span>}
                </h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {filteredMy.length === 0 ? (
                        <div className="col-span-full py-12 text-center border rounded-xl bg-muted/20 border-dashed">
                            <p className="text-muted-foreground">
                                {filtersActive ? "No matching projects found." : "You haven't created any projects yet."}
                            </p>
                            {!filtersActive && isAdmin && (
                                <Button variant="link" asChild className="mt-2">
                                    <Link href="/projects/new">Create one now</Link>
                                </Button>
                            )}
                        </div>
                    ) : (
                        filteredMy.map((project) => (
                            <ProjectCard key={project.id} project={project} />
                        ))
                    )}
                </div>
            </div>

            {/* Shared With Me */}
            <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2 border-t pt-8">
                    <Users className="h-5 w-5 text-secondary-foreground" />
                    Shared With Me
                    {filtersActive && <span className="text-sm font-normal text-muted-foreground">({filteredShared.length})</span>}
                </h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {filteredShared.length === 0 ? (
                        <div className="col-span-full py-8 text-center text-muted-foreground text-sm italic">
                            {filtersActive ? "No matching shared projects." : "No projects have been shared with you yet."}
                        </div>
                    ) : (
                        filteredShared.map((project) => (
                            <ProjectCard key={project.id} project={project} />
                        ))
                    )}
                </div>
            </div>
        </>
    );
}
