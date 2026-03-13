import { getWorkflows } from "@/lib/actions/workflows";
import { WorkflowListClient } from "@/components/workflows/WorkflowListClient";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
    const workflows = await getWorkflows();

    return (
        <div className="max-w-5xl mx-auto px-4 py-8">
            <WorkflowListClient workflows={workflows} />
        </div>
    );
}
