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

    // Check if current user is admin/super_admin
    const { data: currentProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    const isAdmin = currentProfile?.role === 'admin' || currentProfile?.role === 'super_admin';

    // Check if this admin user is a member of the project (has access)
    let isAdminWithAccess = false;
    if (isAdmin && !isOwner) {
        const { data: membership } = await supabase
            .from('project_members')
            .select('id')
            .eq('project_id', id)
            .eq('user_id', user.id)
            .maybeSingle();

        isAdminWithAccess = !!membership;
    }

    const canManageAccess = isOwner || isAdminWithAccess;

    // Fetch active chats for this project
    const { data: chats } = await supabase
        .from("chats")
        .select("id, title, created_at")
        .eq("project_id", id)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

    // Filter out agent-generated chats:
    // 1. New ones (prefixed with hidden \u200B)
    // 2. Legacy ones matching the Salesforce lookup pattern seen in clutter
    const filteredChats = (chats || []).filter(c =>
        !c.title?.startsWith("\u200B") &&
        !c.title?.startsWith("Look up Salesforce Opportu")
    );

    // Fetch documents
    const { data: documents } = await supabase
        .from("documents")
        .select("*")
        .eq("project_id", id)
        .order("created_at", { ascending: false });

    // Fetch memories
    const projectMemories = await getProjectMemories(id);

    // Fetch agent instructions linked to this project
    const { data: agentInstructions } = await supabase
        .from("agent_instructions")
        .select("id, instruction, created_at, is_active")
        .eq("project_id", id)
        .eq("is_active", true);

    // Map instructions to memory format for unified display
    const mappedInstructions = (agentInstructions || []).map(inst => ({
        id: inst.id,
        memory_type: 'behavioral',
        content: inst.instruction,
        sentiment: 'neutral',
        importance: 10,
        created_at: inst.created_at
    }));

    const allMemories = [...mappedInstructions, ...projectMemories];

    return (
        <ProjectPageClient
            project={project}
            isOwner={isOwner}
            canManageAccess={canManageAccess}
            initialChats={filteredChats}
            initialDocuments={documents || []}
            initialMemories={allMemories}
        />
    );
}

