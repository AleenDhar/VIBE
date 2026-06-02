import { redirect } from "next/navigation";
import { verifyAdmin } from "@/lib/actions/admin";
import { AnalysisListClient } from "@/components/analysis/AnalysisListClient";

export const dynamic = "force-dynamic";

export default async function AnalysisIndexPage() {
    // Admin-only feature.
    if (!(await verifyAdmin())) redirect("/");
    return <AnalysisListClient />;
}
