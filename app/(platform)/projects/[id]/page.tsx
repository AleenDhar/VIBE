import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { getProjectMemories } from "@/lib/actions/memories";
import { ProjectPageClient } from "@/components/projects/ProjectPageClient";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return <div>Please login first.</div>;
    }

    // Fetch project details
    const { data: project, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .single();

    if (error || !project) {
        notFound();
    }

    const isOwner = project.owner_id === user.id;

    // Fetch active chats for this project
    const { data: chats } = await supabase
        .from("chats")
        .select("id, title, created_at")
        .eq("project_id", id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

    // Fetch documents
    const { data: documents } = await supabase
        .from("documents")
        .select("*")
        .eq("project_id", id)
        .order("created_at", { ascending: false });

    // Fetch memories
    const memories = await getProjectMemories(id);

    // Filter out agent-generated chats:
    // 1. New ones (prefixed with hidden \u200B)
    // 2. Legacy ones matching the Salesforce lookup pattern seen in clutter
    const filteredChats = (chats || []).filter(c =>
        !c.title?.startsWith("\u200B") &&
        !c.title?.startsWith("Look up Salesforce Opportu")
    );

    return (
        <ProjectPageClient
            project={project}
            isOwner={isOwner}
            initialChats={filteredChats}
            initialDocuments={documents || []}
            initialMemories={memories}
        />
    );
}
