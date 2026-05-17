import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { getProjectMemories } from "@/lib/actions/memories";
import { getSystemPromptVersions } from "@/lib/actions/projects";
import { getProjectTags } from "@/lib/actions/tags";
import { listPhases } from "@/lib/actions/phases";
import { listAutomations } from "@/lib/actions/automations";
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

    // Check project membership for non-owners to determine if they are editors
    let isEditor = false;
    let hasAccess = isOwner || isAdmin;

    if (!isOwner) {
        const { data: membership } = await supabase
            .from('project_members')
            .select('role')
            .eq('project_id', id)
            .eq('user_id', user.id)
            .maybeSingle();

        if (membership) {
            hasAccess = true;
            isEditor = membership.role === 'editor';
        }
    }

    const canManageAccess = isOwner || isAdmin;
    const canEdit = isOwner || isEditor || isAdmin;

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

    // Surface per-account ABM runs as cards (one card per row in `abm_runs`)
    // for ANY project that has them — no longer gated by project name.
    // Projects with zero abm_runs fall back to the original chat list.
    //
    // Role-based scoping:
    //   - admin / super_admin → project-wide view (see all team activity)
    //   - normal users        → only chats they own
    let abmQuery = supabase
        .from("abm_runs")
        .select(`
            seq, account_id, account_name, campaign_id, pushed_count,
            started_at, completed_at, source,
            chat:chats!inner(id, title, project_id, user_id)
        `)
        .eq("chat.project_id", id);
    if (!isAdmin) {
        abmQuery = abmQuery.eq("chat.user_id", user.id);
    }
    const { data: abmRunsRaw } = await abmQuery.order("started_at", { ascending: false });
    const abmRuns: any[] = abmRunsRaw || [];
    const isAbmProject = abmRuns.length > 0;

    // Surface Opportunity Diagnosis runs as cards for any project that has
    // rows in lake.opportunity_diagnoses. Data-driven detection same as ABM.
    //
    // Role-based scoping (same as ABM):
    //   - admin / super_admin → project-wide
    //   - normal users        → only diagnoses tied to chats they own
    let odQuery = supabase
        .schema("lake")
        .from("opportunity_diagnoses")
        .select(`
            chat_id, run_at,
            account_id, account_name,
            opportunity_id, opportunity_name,
            stage, amount, close_date, owner_name,
            momentum_verdict, health_rating,
            top_risks, recommendations, key_themes,
            meeting_count_30d, last_meeting_date
        `)
        .eq("project_id", id);
    if (!isAdmin) {
        const userChatIds = filteredChats.map(c => c.id);
        if (userChatIds.length === 0) {
            // Short-circuit: user has no chats in this project → no diagnoses for them.
            odQuery = odQuery.eq("chat_id", "__none__");
        } else {
            odQuery = odQuery.in("chat_id", userChatIds);
        }
    }
    const { data: diagnosesRaw } = await odQuery.order("run_at", { ascending: false });
    const opportunityDiagnoses: any[] = diagnosesRaw || [];
    const isDiagnosisProject = !isAbmProject && opportunityDiagnoses.length > 0;

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

    // Fetch system prompt version history
    const promptVersions = await getSystemPromptVersions(id);

    // Fetch tags attached to this project
    const projectTags = await getProjectTags(id);

    // Fetch project phases (ordered pipeline of model+prompt+enabled stages).
    const projectPhases = await listPhases(id);

    // Fetch project automations (batch runners listed in the sidebar).
    const projectAutomations = await listAutomations(id);

    return (
        <ProjectPageClient
            project={project}
            isOwner={isOwner}
            canManageAccess={canManageAccess}
            canEdit={canEdit}
            initialChats={filteredChats}
            initialDocuments={documents || []}
            initialMemories={allMemories}
            initialVersions={promptVersions}
            initialTags={projectTags}
            initialPhases={projectPhases}
            initialAutomations={projectAutomations}
            isAbmProject={isAbmProject}
            initialAbmRuns={abmRuns}
            isDiagnosisProject={isDiagnosisProject}
            initialDiagnoses={opportunityDiagnoses}
        />
    );
}

