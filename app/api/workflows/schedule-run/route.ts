import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { cronMatchesNow } from "@/lib/workflows/cron-match";
import { executeWorkflowHeadless } from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min max for scheduled runs

/**
 * Called by Vercel Cron every minute.
 * Finds workflows with active schedules that match the current time and executes them.
 */
export async function GET(req: NextRequest) {
    // Verify this is called by Vercel Cron (optional security)
    const authHeader = req.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createClient();

    // Fetch all workflows with active schedules
    const { data: workflows, error } = await supabase
        .from("workflows")
        .select("id, definition, schedule_cron, schedule_input, schedule_timezone")
        .eq("schedule_enabled", true)
        .not("schedule_cron", "is", null);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!workflows || workflows.length === 0) {
        return NextResponse.json({ message: "No scheduled workflows", ran: 0 });
    }

    const results: { workflowId: string; status: string; error?: string }[] = [];
    const baseUrl = new URL(req.url).origin;

    for (const wf of workflows) {
        // Get current time in the workflow's timezone
        const now = new Date();
        let checkDate = now;
        if (wf.schedule_timezone && wf.schedule_timezone !== "UTC") {
            try {
                const tzStr = now.toLocaleString("en-US", { timeZone: wf.schedule_timezone });
                checkDate = new Date(tzStr);
            } catch {
                // Invalid timezone, use UTC
            }
        }

        if (!cronMatchesNow(wf.schedule_cron, checkDate)) {
            continue; // Not due yet
        }

        const definition = wf.definition as { nodes: any[]; edges: any[] } | null;
        if (!definition?.nodes || !definition?.edges) {
            results.push({ workflowId: wf.id, status: "skipped", error: "No definition" });
            continue;
        }

        try {
            const result = await executeWorkflowHeadless({
                workflowId: wf.id,
                nodes: definition.nodes,
                edges: definition.edges,
                triggerInput: wf.schedule_input || "Scheduled workflow run",
                baseUrl,
                cookieHeader: req.headers.get("cookie") || "",
                supabase,
                triggeredBy: "schedule",
            });
            results.push({ workflowId: wf.id, ...result });
        } catch (err: any) {
            results.push({ workflowId: wf.id, status: "failed", error: err.message });
        }
    }

    return NextResponse.json({
        message: `Checked ${workflows.length} workflows, ran ${results.length}`,
        results,
    });
}
