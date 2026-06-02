import { redirect } from "next/navigation";
import { verifyAdmin } from "@/lib/actions/admin";
import { AnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";

export const dynamic = "force-dynamic";

export default async function AnalysisWorkspacePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    // Admin-only feature.
    if (!(await verifyAdmin())) redirect("/");
    const { id } = await params;
    return <AnalysisWorkspace analysisId={id} />;
}
