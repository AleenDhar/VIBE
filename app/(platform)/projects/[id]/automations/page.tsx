import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { listAutomations } from "@/lib/actions/automations";
import { AutomationsListClient } from "@/components/automations/AutomationsListClient";

export const dynamic = "force-dynamic";

export default async function AutomationsListPage({
    params,
}: { params: Promise<{ id: string }> }) {
    const { id: projectId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/");

    const { data: project, error } = await supabase
        .from("projects")
        .select("id, name, owner_id, visibility")
        .eq("id", projectId)
        .maybeSingle();
    if (error || !project) notFound();

    // canEdit mirrors the project detail page.
    let canEdit = project.owner_id === user.id;
    if (!canEdit) {
        const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single();
        if (profile?.role === "admin" || profile?.role === "super_admin") {
            canEdit = true;
        } else {
            const { data: membership } = await supabase
                .from("project_members")
                .select("role")
                .eq("project_id", projectId)
                .eq("user_id", user.id)
                .maybeSingle();
            if (membership?.role === "editor") canEdit = true;
        }
    }

    const automations = await listAutomations(projectId);

    return (
        <div className="flex flex-col w-full max-w-screen-lg mx-auto px-4 py-6">
            <div className="mb-4">
                <Link
                    href={`/projects/${projectId}`}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    ← {project.name}
                </Link>
            </div>

            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl md:text-3xl font-serif font-medium tracking-tight text-foreground">
                    Automations
                </h1>
            </div>

            <AutomationsListClient
                projectId={projectId}
                initialAutomations={automations}
                canEdit={canEdit}
            />
        </div>
    );
}
