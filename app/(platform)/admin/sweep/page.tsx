import { verifyAdmin } from "@/lib/actions/admin";
import { getTrackedOpps, getReruns, getErrors, getSweepPrompt } from "@/lib/actions/sweep";
import { redirect } from "next/navigation";
import { SweepAdmin } from "@/components/admin/SweepAdmin";

export const dynamic = "force-dynamic";

export default async function SweepAdminPage() {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
        redirect("/");
    }

    const [opps, reruns, errors, prompt] = await Promise.all([
        getTrackedOpps(),
        getReruns(150),
        getErrors(100),
        getSweepPrompt(),
    ]);

    return (
        <div className="flex flex-col gap-6 max-w-6xl mx-auto px-4 py-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Deal Sweep Admin</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Manage the tracked opportunity list (only these trigger auto re-analysis on
                    Salesforce changes), review reruns &amp; errors, and view the sweep system prompt.
                </p>
            </div>
            <SweepAdmin
                initialOpps={opps}
                initialReruns={reruns}
                initialErrors={errors}
                prompt={prompt}
            />
        </div>
    );
}
