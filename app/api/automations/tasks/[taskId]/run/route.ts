import { NextRequest, NextResponse } from "next/server";
import { runAutomationTask } from "@/lib/automation-runner";

export const dynamic = "force-dynamic";

// Kicks off a single automation task. Returns immediately with the chat_id
// once the chat is created; the phase pipeline keeps running in the background
// on this server process, updating the task row as phases complete.
//
// Polling model: the client refreshes the tasks list every couple of seconds
// while any row is 'running' to see status / last_phase_* updates.
export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    const { taskId } = await params;

    // Run async without blocking the response. The runner does its own auth
    // checks via createClient(), which reads the request's auth cookies before
    // the response returns — so the user identity is correct.
    const promise = runAutomationTask(taskId).catch(err => {
        console.error(`[automation/run] task ${taskId} crashed:`, err);
    });

    // We still want to return a useful body fast. Race the runner against a
    // small timeout so the response gives the caller the chat_id once it's
    // created (usually < 500ms), but doesn't wait for the full pipeline.
    const earlyResult = await Promise.race([
        promise,
        new Promise<undefined>(res => setTimeout(() => res(undefined), 1500)),
    ]);

    if (earlyResult && typeof earlyResult === "object" && "chatId" in earlyResult) {
        return NextResponse.json({ ok: true, chatId: (earlyResult as any).chatId });
    }
    return NextResponse.json({ ok: true, started: true });
}
