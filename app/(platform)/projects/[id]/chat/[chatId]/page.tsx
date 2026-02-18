import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { StandaloneChatClient } from "@/components/chat/StandaloneChatClient";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ id: string; chatId: string }> }) {
    const { id: projectId, chatId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return <div>Please login first.</div>;
    }

    // Verify project access
    const { data: project } = await supabase
        .from("projects")
        .select("id, name")
        .eq("id", projectId)
        .single();

    if (!project) notFound();

    // Verify chat access
    const { data: chat } = await supabase
        .from("chats")
        .select("*")
        .eq("id", chatId)
        .eq("project_id", projectId)
        .single();

    if (!chat) notFound();

    // Fetch messages
    const { data: messages } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

    return (
        <div className="flex flex-col h-full gap-2">
            <div className="h-full">
                <StandaloneChatClient
                    projectId={projectId}
                    chatId={chatId}
                    initialMessages={messages || []}
                />
            </div>
        </div>
    );
}
