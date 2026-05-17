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
    created_at: string;
    updated_at: string;
}

// Mirrors the canEdit logic in app/(platform)/projects/[id]/page.tsx.
async function userCanEditProject(projectId: string): Promise<boolean> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: project } = await supabase
        .from("projects")
        .select("owner_id")
        .eq("id", projectId)
        .single();
    if (!project) return false;
    if (project.owner_id === user.id) return true;

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
    if (profile?.role === "admin" || profile?.role === "super_admin") return true;

    const { data: membership } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();

    return membership?.role === "editor";
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
    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access." };
    }

    const supabase = await createClient();

    const { data: existing } = await supabase
        .from("automation_tasks")
        .select("position")
        .eq("automation_id", automationId)
        .order("position", { ascending: false })
        .limit(1);
    const nextPosition = (existing?.[0]?.position ?? 0) + 1;

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
