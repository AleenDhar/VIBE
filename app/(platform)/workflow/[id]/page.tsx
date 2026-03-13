import { getWorkflow, getProjects } from "@/lib/actions/workflows";
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function WorkflowPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const [workflow, projects] = await Promise.all([
        getWorkflow(id),
        getProjects(),
    ]);

    if (!workflow) {
        redirect("/workflows");
    }

    return <WorkflowBuilder workflow={workflow} projects={projects} />;
}
