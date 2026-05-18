import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { StandaloneChatClient } from "@/components/chat/StandaloneChatClient";
import { verifySuperAdmin } from "@/lib/actions/admin";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ id: string; chatId: string }> }) {
    const { id: projectId, chatId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return <div>Please login first.</div>;
    }

    const isSuperAdmin = await verifySuperAdmin();

    // Super admins can access any project and chat; regular users must own it
    const { data: project } = await supabase
        .from("projects")
        .select("id, name")
        .eq("id", projectId)
        .single();

    if (!project) notFound();

    // Build chat query — super admins bypass user_id check
    const chatQuery = supabase
        .from("chats")
        .select("*")
        .eq("id", chatId)
        .eq("project_id", projectId);

    const { data: chat } = await chatQuery.single();

    if (!chat) notFound();

    // Fetch messages — order by sequence (server contract); created_at as tiebreaker.
    const { data: messages } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("sequence", { ascending: true })
        .order("created_at", { ascending: true });

    // If this chat was created by an automation task, the per-phase Rerun
    // button needs the taskId. We also fetch phase_outputs + the project's
    // phases so the chat UI can compute phase boundaries by created_at
    // (the automation table already does this — apply the same logic to
    // the chat so dividers render correctly regardless of whether Replit
    // has finished tagging chat_messages.metadata.phase yet).
    const { data: linkedTask } = await supabase
        .from("automation_tasks")
        .select("id, phase_outputs, last_phase_index, last_phase_total, last_phase_name, status")
        .eq("chat_id", chatId)
        .maybeSingle();

    let phaseBoundaries: Array<{
        position: number;
        name: string | null;
        model_id: string | null;
        after_ms: number;
    }> = [];

    if (linkedTask) {
        const { data: projectPhases } = await supabase
            .from("project_phases")
            .select("position, name, model_id, enabled")
            .eq("project_id", projectId)
            .eq("enabled", true)
            .order("position", { ascending: true });

        const outputs = Array.isArray(linkedTask.phase_outputs) ? linkedTask.phase_outputs : [];
        const completedByPosition = new Map<number, string>();
        for (const o of outputs as any[]) {
            if (typeof o?.phase_position === "number" && o?.completed_at) {
                completedByPosition.set(o.phase_position, o.completed_at);
            }
        }

        // Sort completed_at timestamps to derive cumulative boundaries.
        const completedTimes = [...completedByPosition.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, t]) => new Date(t).getTime());

        const lastIndex = linkedTask.last_phase_index ?? 0;
        const enabledPhases = (projectPhases || []) as Array<{
            position: number; name: string | null; model_id: string | null;
        }>;

        for (let i = 0; i < enabledPhases.length; i++) {
            const p = enabledPhases[i];
            // A phase's after_ms = the completion timestamp of the previous
            // completed phase, or 0 for phase 1.
            const after_ms = i === 0 ? 0 : (completedTimes[i - 1] ?? 0);
            // Skip phases that haven't started yet (position > last_phase_index
            // AND not in completed). Otherwise late messages would get
            // incorrectly assigned to a future phase.
            const isCompleted = completedByPosition.has(p.position);
            const isCurrent = p.position === lastIndex;
            if (!isCompleted && !isCurrent) continue;
            phaseBoundaries.push({
                position: p.position,
                name: p.name,
                model_id: p.model_id,
                after_ms,
            });
        }
    }

    return (
        <div className="flex flex-col h-full gap-2">
            <div className="h-full">
                <StandaloneChatClient
                    projectId={projectId}
                    chatId={chatId}
                    initialMessages={messages || []}
                    automationTaskId={linkedTask?.id || null}
                    phaseBoundaries={phaseBoundaries}
                />
            </div>
        </div>
    );
}
