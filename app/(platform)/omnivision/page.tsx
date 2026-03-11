import { verifySuperAdmin, getOmnivisionUserAggregates } from "@/lib/actions/admin";
import { redirect } from "next/navigation";
import { OmnivisionDashboard } from "@/components/admin/OmnivisionDashboard";

export const dynamic = "force-dynamic";

export default async function OmnivisionPage() {
    const isSuperAdmin = await verifySuperAdmin();

    if (!isSuperAdmin) {
        redirect("/");
    }

    const initialAggregates = await getOmnivisionUserAggregates();

    return <OmnivisionDashboard initialAggregates={initialAggregates} />;
}
