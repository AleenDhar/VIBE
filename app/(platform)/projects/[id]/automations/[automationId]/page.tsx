import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getAutomation, listTasks } from "@/lib/actions/automations";
import { listPhases } from "@/lib/actions/phases";
import { AutomationDetailClient } from "@/components/automations/AutomationDetailClient";

export const dynamic = "force-dynamic";

export default async function AutomationDetailPage({
    params,
}: { params: Promise<{ id: string; automationId: string }> }) {
    const { id: projectId, automationId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/");

    const automation = await getAutomation(automationId);
    if (!automation || automation.project_id !== projectId) notFound();

    const { data: project } = await supabase
        .from("projects")
        .select("id, name, owner_id")
        .eq("id", projectId)
        .maybeSingle();
    if (!project) notFound();

    // canEdit, same shape as elsewhere.
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

    const tasks = await listTasks(automationId);
    // Phases are loaded so the task table can render a column per phase using
    // current phase names (renaming a phase updates the header live; historical
    // outputs in phase_outputs keep the name they had at run time).
    const phases = await listPhases(projectId);

    return (
        <div className="flex flex-col w-full max-w-screen-2xl mx-auto px-4 py-6">
            <div className="mb-4">
                <Link
                    href={`/projects/${projectId}/automations`}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    ← Automations
                </Link>
            </div>

            <AutomationDetailClient
                projectId={projectId}
                automation={automation}
                initialTasks={tasks}
                initialPhases={phases}
                canEdit={canEdit}
            />
        </div>
    );
}
