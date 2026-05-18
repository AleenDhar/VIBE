import { NextRequest, NextResponse } from "next/server";
import { runAutomationTaskPhase } from "@/lib/automation-runner";

export const dynamic = "force-dynamic";

// Re-runs a single phase for an existing task. Reuses the task's chat;
// replaces just that phase's output. The full pipeline runner remains the
// entry point for fresh runs — this is the per-cell ▶ inside the table.
export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ taskId: string; position: string }> }
) {
    const { taskId, position } = await params;
    const phasePosition = parseInt(position, 10);
    if (!Number.isFinite(phasePosition) || phasePosition < 1) {
        return NextResponse.json({ error: "Invalid phase position" }, { status: 400 });
    }

    // Fire-and-forget — keeps streaming on the server while the response
    // returns quickly.
    runAutomationTaskPhase(taskId, phasePosition).catch(err => {
        console.error(
            `[automation/run-phase] task ${taskId} phase ${phasePosition} crashed:`,
            err
        );
    });

    return NextResponse.json({ ok: true, started: true });
}
