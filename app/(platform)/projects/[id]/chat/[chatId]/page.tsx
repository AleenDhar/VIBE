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
    // button needs the taskId to invoke /api/automations/tasks/.../phases/.../run.
    // Cheap one-row lookup; null when the chat isn't tied to an automation.
    const { data: linkedTask } = await supabase
        .from("automation_tasks")
        .select("id")
        .eq("chat_id", chatId)
        .maybeSingle();

    return (
        <div className="flex flex-col h-full gap-2">
            <div className="h-full">
                <StandaloneChatClient
                    projectId={projectId}
                    chatId={chatId}
                    initialMessages={messages || []}
                    automationTaskId={linkedTask?.id || null}
                />
            </div>
        </div>
    );
}
