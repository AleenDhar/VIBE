import {
    verifySuperAdmin,
    getOmnivisionUserAggregates,
    getAbmRunCountsByUser,
} from "@/lib/actions/admin";
import { redirect } from "next/navigation";
import { OmnivisionDashboard } from "@/components/admin/OmnivisionDashboard";

export const dynamic = "force-dynamic";

export default async function OmnivisionPage() {
    const isSuperAdmin = await verifySuperAdmin();

    if (!isSuperAdmin) {
        redirect("/");
    }

    // Fetch user aggregates and per-user ABM reuse metrics in parallel for
    // "All time" (the default preset). Keeping both on a single SSR round-
    // trip so the reuse badges render in the first paint instead of
    // flashing in after a client-side request.
    const [initialAggregates, initialAbmReuse] = await Promise.all([
        getOmnivisionUserAggregates(),
        getAbmRunCountsByUser(),
    ]);

    return (
        <OmnivisionDashboard
            initialAggregates={initialAggregates}
            initialAbmReuse={initialAbmReuse}
        />
    );
}
