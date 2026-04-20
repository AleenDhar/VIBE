"use client";

import { useState } from "react";
import { Search, X, FolderPlus, Users } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ProjectCardActions } from "@/components/projects/ProjectCardActions";

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
}: {
    myProjects: Project[];
    sharedProjects: Project[];
    userId: string;
    isAdmin: boolean;
}) {
    const [searchQuery, setSearchQuery] = useState("");
    const lq = searchQuery.toLowerCase();

    const filterProjects = (projects: Project[]) => {
        if (!lq) return projects;
        return projects.filter(p =>
            p.name.toLowerCase().includes(lq) ||
            (p.description || "").toLowerCase().includes(lq)
        );
    };

    const filteredMy = filterProjects(myProjects);
    const filteredShared = filterProjects(sharedProjects);

    const ProjectCard = ({ project }: { project: Project }) => (
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
                    <CardContent>
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

    return (
        <>
            {/* Search bar */}
            <div className="relative max-w-md">
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

            {/* My Projects */}
            <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                    <FolderPlus className="h-5 w-5 text-primary" />
                    My Projects
                    {lq && <span className="text-sm font-normal text-muted-foreground">({filteredMy.length})</span>}
                </h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {filteredMy.length === 0 ? (
                        <div className="col-span-full py-12 text-center border rounded-xl bg-muted/20 border-dashed">
                            <p className="text-muted-foreground">
                                {lq ? "No matching projects found." : "You haven't created any projects yet."}
                            </p>
                            {!lq && isAdmin && (
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
                    {lq && <span className="text-sm font-normal text-muted-foreground">({filteredShared.length})</span>}
                </h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {filteredShared.length === 0 ? (
                        <div className="col-span-full py-8 text-center text-muted-foreground text-sm italic">
                            {lq ? "No matching shared projects." : "No projects have been shared with you yet."}
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
