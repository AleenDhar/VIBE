"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type AutomationTaskStatus = "pending" | "running" | "completed" | "failed" | "stopped";

export interface ProjectAutomation {
    id: string;
    project_id: string;
    name: string | null;
    description: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface AutomationPhaseOutput {
    phase_index: number;
    phase_position: number;
    phase_name: string | null;
    phase_model_id: string | null;
    content: string;
    completed_at: string;
}

export interface AutomationTask {
    id: string;
    automation_id: string;
    position: number;
    prompt: string;
    enabled: boolean;
    status: AutomationTaskStatus;
    chat_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    last_phase_index: number | null;
    last_phase_total: number | null;
    last_phase_name: string | null;
    error: string | null;
    stop_requested: boolean;
    phase_outputs: AutomationPhaseOutput[];
    created_at: string;
    updated_at: string;
}

// Mirrors the canEdit logic in app/(platform)/projects/[id]/page.tsx.
//
// All three checks fire in parallel. Worst case is one project-not-found
// roundtrip; best case is three short-circuits in a single round-trip's
// worth of wall time. The redundant work is cheap (small indexed lookups)
// compared to sequential awaits that paid the full latency hit on every
// non-owner mutation.
async function userCanEditProject(projectId: string): Promise<boolean> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const [projectRes, profileRes, membershipRes] = await Promise.all([
        supabase.from("projects").select("owner_id").eq("id", projectId).single(),
        supabase.from("profiles").select("role").eq("id", user.id).single(),
        supabase.from("project_members").select("role")
            .eq("project_id", projectId).eq("user_id", user.id).maybeSingle(),
    ]);

    if (!projectRes.data) return false;
    if (projectRes.data.owner_id === user.id) return true;
    if (profileRes.data?.role === "admin" || profileRes.data?.role === "super_admin") return true;
    return membershipRes.data?.role === "editor";
}

async function automationProjectId(automationId: string): Promise<string | null> {
    const supabase = await createClient();
    const { data } = await supabase
        .from("project_automations")
        .select("project_id")
        .eq("id", automationId)
        .maybeSingle();
    return data?.project_id ?? null;
}

// ── automations ───────────────────────────────────────────────────────────

export async function listAutomations(projectId: string): Promise<ProjectAutomation[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("project_automations")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
    if (error) {
        console.error("listAutomations error:", error);
        return [];
    }
    return (data || []) as ProjectAutomation[];
}

export async function getAutomation(automationId: string): Promise<ProjectAutomation | null> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("project_automations")
        .select("*")
        .eq("id", automationId)
        .maybeSingle();
    if (error) {
        console.error("getAutomation error:", error);
        return null;
    }
    return (data as ProjectAutomation) ?? null;
}

export async function createAutomation(
    projectId: string,
    name?: string,
    description?: string
): Promise<{ success: boolean; automation?: ProjectAutomation; error?: string }> {
    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access to this project." };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
        .from("project_automations")
        .insert({
            project_id: projectId,
            name: name?.trim() || "Untitled automation",
            description: description?.trim() || null,
            created_by: user?.id ?? null,
        })
        .select("*")
        .single();

    if (error || !data) {
        console.error("createAutomation error:", error);
        return { success: false, error: error?.message || "Failed to create automation." };
    }

    revalidatePath(`/projects/${projectId}/automations`);
    return { success: true, automation: data as ProjectAutomation };
}

export async function renameAutomation(
    automationId: string,
    name: string
): Promise<{ success: boolean; error?: string }> {
    const projectId = await automationProjectId(automationId);
    if (!projectId) return { success: false, error: "Automation not found." };
    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access." };
    }

    const supabase = await createClient();
    const { error } = await supabase
        .from("project_automations")
        .update({ name: name.trim() || "Untitled automation" })
        .eq("id", automationId);
    if (error) return { success: false, error: error.message };

    revalidatePath(`/projects/${projectId}/automations`);
    revalidatePath(`/projects/${projectId}/automations/${automationId}`);
    return { success: true };
}

export async function deleteAutomation(
    automationId: string
): Promise<{ success: boolean; error?: string }> {
    const projectId = await automationProjectId(automationId);
    if (!projectId) return { success: false, error: "Automation not found." };
    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access." };
    }

    const supabase = await createClient();
    const { error } = await supabase
        .from("project_automations")
        .delete()
        .eq("id", automationId);
    if (error) return { success: false, error: error.message };

    revalidatePath(`/projects/${projectId}/automations`);
    return { success: true };
}

// ── tasks (rows) ──────────────────────────────────────────────────────────

export async function listTasks(automationId: string): Promise<AutomationTask[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("automation_tasks")
        .select("*")
        .eq("automation_id", automationId)
        .order("position", { ascending: true });
    if (error) {
        console.error("listTasks error:", error);
        return [];
    }
    return (data || []) as AutomationTask[];
}

export async function createTask(
    automationId: string,
    prompt: string = ""
): Promise<{ success: boolean; task?: AutomationTask; error?: string }> {
    const projectId = await automationProjectId(automationId);
    if (!projectId) return { success: false, error: "Automation not found." };

    const supabase = await createClient();

    // Run the permission check and the max-position lookup in parallel.
    // Wasted work if permission fails is cheap (single indexed lookup) and
    // we save a full roundtrip on every Add-row click.
    const [canEdit, positionRes] = await Promise.all([
        userCanEditProject(projectId),
        supabase
            .from("automation_tasks")
            .select("position")
            .eq("automation_id", automationId)
            .order("position", { ascending: false })
            .limit(1),
    ]);

    if (!canEdit) return { success: false, error: "You don't have edit access." };

    const nextPosition = (positionRes.data?.[0]?.position ?? 0) + 1;

    const { data, error } = await supabase
        .from("automation_tasks")
        .insert({
            automation_id: automationId,
            position: nextPosition,
            prompt,
            enabled: true,
            status: "pending",
        })
        .select("*")
        .single();

    if (error || !data) {
        console.error("createTask error:", error);
        return { success: false, error: error?.message || "Failed to create task." };
    }

    revalidatePath(`/projects/${projectId}/automations/${automationId}`);
    return { success: true, task: data as AutomationTask };
}

export async function updateTask(
    taskId: string,
    patch: { prompt?: string; enabled?: boolean }
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: task } = await supabase
        .from("automation_tasks")
        .select("automation_id")
        .eq("id", taskId)
        .maybeSingle();
    if (!task) return { success: false, error: "Task not found." };

    const projectId = await automationProjectId(task.automation_id);
    if (!projectId) return { success: false, error: "Automation not found." };
    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access." };
    }

    const update: Record<string, unknown> = {};
    if (patch.prompt !== undefined) update.prompt = patch.prompt;
    if (patch.enabled !== undefined) update.enabled = patch.enabled;
    if (Object.keys(update).length === 0) return { success: true };

    const { error } = await supabase
        .from("automation_tasks")
        .update(update)
        .eq("id", taskId);
    if (error) return { success: false, error: error.message };

    revalidatePath(`/projects/${projectId}/automations/${task.automation_id}`);
    return { success: true };
}

// Live-progress view for a phase that's currently running. Returns the
// assistant chat_messages tagged with that phase's position, in chronological
// order, so the UI can show tool calls + streamed text in the matching
// column while the agent is still working.
export interface LivePhaseRow {
    id: string;
    type: string | null;
    content: string | null;
    tool: string | null;
    args: any;
    created_at: string;
}

export async function getChatPhaseProgress(
    chatId: string,
    phasePosition: number
): Promise<LivePhaseRow[]> {
    const supabase = await createClient();
    // RLS will reject reads on chats the user can't see, so no extra ACL here.
    const { data, error } = await supabase
        .from("chat_messages")
        .select("id, type, content, metadata, created_at")
        .eq("chat_id", chatId)
        .eq("role", "assistant")
        .order("created_at", { ascending: true });
    if (error) {
        console.error("getChatPhaseProgress error:", error);
        return [];
    }
    const rows: LivePhaseRow[] = [];
    for (const m of data || []) {
        const meta = typeof m.metadata === "string"
            ? (() => { try { return JSON.parse(m.metadata) || {}; } catch { return {}; } })()
            : (m.metadata || {});
        if (meta?.phase?.position !== phasePosition) continue;
        rows.push({
            id: m.id,
            type: (m as any).type ?? meta.type ?? null,
            content: m.content ?? null,
            tool: meta.tool || meta.name || meta.tool_name || null,
            args: meta.args ?? null,
            created_at: m.created_at,
        });
    }
    return rows;
}

export async function deleteTask(
    taskId: string
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();
    const { data: task } = await supabase
        .from("automation_tasks")
        .select("automation_id")
        .eq("id", taskId)
        .maybeSingle();
    if (!task) return { success: false, error: "Task not found." };

    const projectId = await automationProjectId(task.automation_id);
    if (!projectId) return { success: false, error: "Automation not found." };
    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access." };
    }

    const { error } = await supabase
        .from("automation_tasks")
        .delete()
        .eq("id", taskId);
    if (error) return { success: false, error: error.message };

    revalidatePath(`/projects/${projectId}/automations/${task.automation_id}`);
    return { success: true };
}
