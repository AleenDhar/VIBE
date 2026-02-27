import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import Link from "next/link";
import { FolderPlus, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let projects = [];
    let isAdmin = false;

    if (user) {
        // Fetch user profile to check role
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

    const ProjectCard = ({ project }: { project: any }) => (
        <Link key={project.id} href={`/projects/${project.id}`}>
            <Card className="h-full transition-all hover:border-primary hover:shadow-md cursor-pointer">
                <CardHeader>
                    <div className="flex justify-between items-start">
                        <CardTitle className="line-clamp-1">{project.name}</CardTitle>
                        {project.visibility === 'public' && (
                            <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                                Public
                            </span>
                        )}
                        {project.owner_id !== user?.id && (
                            <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                                Shared
                            </span>
                        )}
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
    );

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

            <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                    <FolderPlus className="h-5 w-5 text-primary" />
                    My Projects
                </h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {myProjects.length === 0 ? (
                        <div className="col-span-full py-12 text-center border rounded-xl bg-muted/20 border-dashed">
                            <p className="text-muted-foreground">You haven't created any projects yet.</p>
                            {isAdmin && (
                                <Button variant="link" asChild className="mt-2">
                                    <Link href="/projects/new">Create one now</Link>
                                </Button>
                            )}
                        </div>
                    ) : (
                        myProjects.map((project: any) => (
                            <ProjectCard key={project.id} project={project} />
                        ))
                    )}
                </div>
            </div>

            <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2 border-t pt-8">
                    <Users className="h-5 w-5 text-secondary-foreground" />
                    Shared With Me
                </h2>
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {sharedProjects.length === 0 ? (
                        <div className="col-span-full py-8 text-center text-muted-foreground text-sm italic">
                            No projects have been shared with you yet.
                        </div>
                    ) : (
                        sharedProjects.map((project: any) => (
                            <ProjectCard key={project.id} project={project} />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
