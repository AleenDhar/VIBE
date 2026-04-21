import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { FolderPlus } from "lucide-react";
import { ProjectsGrid } from "@/components/projects/ProjectsGrid";
import { getAllTagsWithUsage, getTagsForProjects } from "@/lib/actions/tags";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let projects = [];
    let isAdmin = false;

    if (user) {
        const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single();

        isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

        const { data } = await supabase
            .from("projects")
            .select("*")
            .order("created_at", { ascending: false });
        projects = data || [];
    }

    const myProjects = projects.filter((p: any) => p.owner_id === user?.id);
    const sharedProjects = projects.filter((p: any) => p.owner_id !== user?.id);

    const allProjectIds = projects.map((p: any) => p.id);
    const [tagsByProject, allTags] = await Promise.all([
        getTagsForProjects(allProjectIds),
        getAllTagsWithUsage(),
    ]);

    return (
        <div className="flex flex-col gap-10">
            <div className="flex items-center justify-between border-b pb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
                    <p className="text-muted-foreground mt-1">Manage your deals and explore public insights.</p>
                </div>
                {isAdmin && (
                    <Button asChild>
                        <Link href="/projects/new">
                            <FolderPlus className="mr-2 h-4 w-4" />
                            New Project
                        </Link>
                    </Button>
                )}
            </div>

            <ProjectsGrid
                myProjects={myProjects}
                sharedProjects={sharedProjects}
                userId={user?.id || ""}
                isAdmin={isAdmin}
                tagsByProject={tagsByProject}
                allTags={allTags}
            />
        </div>
    );
}
