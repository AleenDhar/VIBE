import { NextRequest, NextResponse } from "next/server";
import { runAutomationTask } from "@/lib/automation-runner";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Kicks off a single automation task. Returns as soon as the runner has
// stamped chat_id onto the task row (usually < 500ms) so the client can
// show the Open link in the Chat column immediately. The phase pipeline
// keeps running in the background on this server process, updating the
// task row as phases complete; the client polls listTasks() every 2s to
// pick up status + last_phase_* changes.
export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    const { taskId } = await params;

    // Fire-and-forget the runner. It does its own auth checks via
    // createClient() which reads the request's auth cookies before the
    // response returns, so user identity is correct.
    runAutomationTask(taskId).catch(err => {
        console.error(`[automation/run] task ${taskId} crashed:`, err);
    });

    // Poll the task row for chat_id appearing. The runner stamps it very
    // early (right after creating the chat), so this usually returns within
    // a few hundred ms. Hard cap of 2s — if chat creation is slow for any
    // reason, return anyway and let the client's regular polling discover
    // the chat_id when it eventually lands.
    const supabase = await createClient();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const { data } = await supabase
            .from("automation_tasks")
            .select("chat_id")
            .eq("id", taskId)
            .maybeSingle();
        if (data?.chat_id) {
            return NextResponse.json({ ok: true, chatId: data.chat_id });
        }
        await new Promise(r => setTimeout(r, 100));
    }

    return NextResponse.json({ ok: true, started: true });
}
