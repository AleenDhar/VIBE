"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Copy, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ProjectCardActionsProps {
    projectId: string;
    projectName: string;
}

export function ProjectCardActions({ projectId, projectName }: ProjectCardActionsProps) {
    const router = useRouter();
    const [cloning, setCloning] = useState(false);

    const handleClone = async () => {
        if (cloning) return;
        setCloning(true);
        try {
            const { cloneProject } = await import("@/lib/actions/projects");
            const result = await cloneProject(projectId);
            if (result.error) {
                alert(`Clone failed: ${result.error}`);
            } else if (result.newProjectId) {
                router.push(`/projects/${result.newProjectId}`);
            }
        } catch (err) {
            console.error("Error cloning project:", err);
            alert("Failed to clone project.");
        } finally {
            setCloning(false);
        }
    };

    const handleRename = async () => {
        const newName = prompt("Enter new project name:", projectName);
        if (!newName || newName.trim() === projectName) return;
        try {
            const { renameProject } = await import("@/lib/actions/projects");
            const result = await renameProject(projectId, newName.trim());
            if (result.error) {
                alert(`Rename failed: ${result.error}`);
            } else {
                router.refresh();
            }
        } catch (err) {
            console.error("Error renaming project:", err);
            alert("Failed to rename project.");
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                >
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRename(); }}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleClone(); }}
                    disabled={cloning}
                >
                    {cloning ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <Copy className="mr-2 h-4 w-4" />
                    )}
                    {cloning ? "Cloning..." : "Clone Project"}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
