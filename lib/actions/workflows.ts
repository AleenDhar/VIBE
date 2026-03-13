"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

async function getUserWorkspaceId() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user.id)
        .limit(1)
        .single();

    return membership?.workspace_id || null;
}

export async function getWorkflows() {
    const supabase = await createClient();
    const workspaceId = await getUserWorkspaceId();
    if (!workspaceId) return [];

    const { data } = await supabase
        .from("workflows")
        .select("id, name, description, updated_at, created_at")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false });

    return data || [];
}

export async function getWorkflow(id: string) {
    const supabase = await createClient();
    const { data } = await supabase
        .from("workflows")
        .select("*")
        .eq("id", id)
        .single();

    return data;
}

export async function createWorkflow(name: string) {
    const supabase = await createClient();
    const workspaceId = await getUserWorkspaceId();
    if (!workspaceId) return { error: "No workspace found" };

    const { data, error } = await supabase
        .from("workflows")
        .insert({
            name,
            workspace_id: workspaceId,
            definition: {
                nodes: [],
                edges: [],
            },
        })
        .select("id")
        .single();

    if (error) {
        console.error("Create workflow error:", error);
        return { error: error.message };
    }

    revalidatePath("/workflows");
    return { id: data.id };
}

export async function updateWorkflow(
    id: string,
    updates: {
        name?: string;
        description?: string;
        definition?: any;
        schedule_enabled?: boolean;
        schedule_cron?: string | null;
        schedule_input?: string | null;
        schedule_timezone?: string;
    }
) {
    const supabase = await createClient();

    const { error } = await supabase
        .from("workflows")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);

    if (error) {
        console.error("Update workflow error:", error);
        return { error: error.message };
    }

    revalidatePath("/workflows");
    return { success: true };
}

export async function deleteWorkflow(id: string) {
    const supabase = await createClient();

    const { error } = await supabase
        .from("workflows")
        .delete()
        .eq("id", id);

    if (error) {
        console.error("Delete workflow error:", error);
        return { error: error.message };
    }

    revalidatePath("/workflows");
    return { success: true };
}

export async function getWorkflowExecutions(workflowId: string) {
    const supabase = await createClient();

    const { data } = await supabase
        .from("workflow_executions")
        .select("*")
        .eq("workflow_id", workflowId)
        .order("created_at", { ascending: false })
        .limit(20);

    return data || [];
}

export async function getProjects() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data } = await supabase
        .from("projects")
        .select("id, name, description")
        .order("name");

    return data || [];
}
