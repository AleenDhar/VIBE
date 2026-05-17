"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface ProjectPhase {
    id: string;
    project_id: string;
    name: string | null;
    position: number;
    model_id: string | null;
    system_prompt: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

// Product default model for newly-created phases. Mirrors the backfill in
// 20260517100000_backfill_default_phase.sql so projects created via the UI
// after the migration look identical to projects backfilled by it.
const DEFAULT_PHASE_MODEL_ID = "anthropic:claude-sonnet-4-6";

// Mirrors the canEdit logic in app/(platform)/projects/[id]/page.tsx:
// owner OR project_members.role = 'editor' OR profile role admin/super_admin.
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

export async function listPhases(projectId: string): Promise<ProjectPhase[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("project_phases")
        .select("*")
        .eq("project_id", projectId)
        .order("position", { ascending: true });

    if (error) {
        console.error("listPhases error:", error);
        return [];
    }
    return (data || []) as ProjectPhase[];
}

// Create a phase. One-time migration: if this is the FIRST phase added to a
// project that still has a non-empty legacy projects.system_prompt, seed the
// new phase from it and clear the legacy field so downstream code stops
// double-applying the same prompt. Callers can also pass explicit
// system_prompt/model_id/name/enabled to override.
export async function createPhase(
    projectId: string,
    opts: {
        name?: string | null;
        model_id?: string | null;
        system_prompt?: string;
        enabled?: boolean;
    } = {}
): Promise<{ success: boolean; phase?: ProjectPhase; error?: string }> {
    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access to this project." };
    }

    const supabase = await createClient();

    // Determine next position.
    const { data: existing } = await supabase
        .from("project_phases")
        .select("position")
        .eq("project_id", projectId)
        .order("position", { ascending: false })
        .limit(1);

    const nextPosition = (existing?.[0]?.position ?? 0) + 1;
    const isFirstPhase = nextPosition === 1;

    // One-time migration: seed from legacy projects.system_prompt.
    let seededPrompt = opts.system_prompt;
    let seededName = opts.name;
    let clearLegacy = false;

    if (isFirstPhase && opts.system_prompt === undefined) {
        const { data: project } = await supabase
            .from("projects")
            .select("system_prompt")
            .eq("id", projectId)
            .single();
        const legacy = (project?.system_prompt || "").trim();
        if (legacy) {
            seededPrompt = legacy;
            if (!seededName) seededName = "Phase 1";
            clearLegacy = true;
        }
    }

    const { data: inserted, error } = await supabase
        .from("project_phases")
        .insert({
            project_id: projectId,
            name: seededName ?? null,
            position: nextPosition,
            // Default to the product-wide Sonnet 4.6 baseline when the caller
            // didn't specify a model, matching the SQL backfill.
            model_id: opts.model_id ?? DEFAULT_PHASE_MODEL_ID,
            system_prompt: seededPrompt ?? "",
            enabled: opts.enabled ?? true,
        })
        .select("*")
        .single();

    if (error || !inserted) {
        console.error("createPhase error:", error);
        return { success: false, error: error?.message || "Failed to create phase." };
    }

    if (clearLegacy) {
        const { error: clearError } = await supabase
            .from("projects")
            .update({ system_prompt: null })
            .eq("id", projectId);
        if (clearError) {
            // Non-fatal: phase exists, but legacy prompt wasn't cleared. The
            // pipeline runner doesn't read projects.system_prompt when phases
            // exist anyway, so this is cosmetic — log and continue.
            console.warn("createPhase: failed to clear legacy system_prompt:", clearError);
        }
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true, phase: inserted as ProjectPhase };
}

export async function updatePhase(
    phaseId: string,
    patch: {
        name?: string | null;
        model_id?: string | null;
        system_prompt?: string;
        enabled?: boolean;
    }
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();

    const { data: phase } = await supabase
        .from("project_phases")
        .select("project_id")
        .eq("id", phaseId)
        .single();

    if (!phase) return { success: false, error: "Phase not found." };
    if (!(await userCanEditProject(phase.project_id))) {
        return { success: false, error: "You don't have edit access to this project." };
    }

    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.model_id !== undefined) update.model_id = patch.model_id;
    if (patch.system_prompt !== undefined) update.system_prompt = patch.system_prompt;
    if (patch.enabled !== undefined) update.enabled = patch.enabled;

    if (Object.keys(update).length === 0) {
        return { success: true };
    }

    const { data: updated, error } = await supabase
        .from("project_phases")
        .update(update)
        .eq("id", phaseId)
        .select("id");

    if (error) {
        console.error("updatePhase error:", error);
        return { success: false, error: error.message };
    }
    if (!updated || updated.length === 0) {
        return { success: false, error: "Update affected zero rows — permission denied or phase missing." };
    }

    revalidatePath(`/projects/${phase.project_id}`);
    return { success: true };
}

export async function togglePhase(
    phaseId: string,
    enabled: boolean
): Promise<{ success: boolean; error?: string }> {
    return updatePhase(phaseId, { enabled });
}

export async function deletePhase(phaseId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient();

    const { data: phase } = await supabase
        .from("project_phases")
        .select("project_id")
        .eq("id", phaseId)
        .single();

    if (!phase) return { success: false, error: "Phase not found." };
    if (!(await userCanEditProject(phase.project_id))) {
        return { success: false, error: "You don't have edit access to this project." };
    }

    const { error } = await supabase
        .from("project_phases")
        .delete()
        .eq("id", phaseId);

    if (error) {
        console.error("deletePhase error:", error);
        return { success: false, error: error.message };
    }

    // Compact positions so we don't leave gaps that confuse the UI's
    // displayed numbering. Done in a follow-up read+rewrite rather than a
    // trigger so the ordering semantics live in code we can change easily.
    await compactPositions(phase.project_id);

    revalidatePath(`/projects/${phase.project_id}`);
    return { success: true };
}

// Reorder phases by passing an array of phase ids in the desired final order.
// Positions are rewritten to 1..N in that order. Two-phase write to dodge the
// (project_id, position) UNIQUE constraint: first move every row into a
// disjoint negative-position scratch range, then assign final positions.
export async function reorderPhases(
    projectId: string,
    orderedPhaseIds: string[]
): Promise<{ success: boolean; error?: string }> {
    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access to this project." };
    }

    const supabase = await createClient();

    const { data: phases } = await supabase
        .from("project_phases")
        .select("id")
        .eq("project_id", projectId);

    const existingIds = new Set((phases || []).map(p => p.id));
    for (const id of orderedPhaseIds) {
        if (!existingIds.has(id)) {
            return { success: false, error: `Phase ${id} does not belong to this project.` };
        }
    }
    if (orderedPhaseIds.length !== existingIds.size) {
        return { success: false, error: "Reorder list must include every phase exactly once." };
    }

    // Phase 1: park each row at a unique negative position to avoid the
    // unique constraint colliding mid-rewrite.
    for (let i = 0; i < orderedPhaseIds.length; i++) {
        const { error } = await supabase
            .from("project_phases")
            .update({ position: -(i + 1) })
            .eq("id", orderedPhaseIds[i]);
        if (error) {
            console.error("reorderPhases (park) error:", error);
            return { success: false, error: error.message };
        }
    }

    // Phase 2: write the final 1..N positions.
    for (let i = 0; i < orderedPhaseIds.length; i++) {
        const { error } = await supabase
            .from("project_phases")
            .update({ position: i + 1 })
            .eq("id", orderedPhaseIds[i]);
        if (error) {
            console.error("reorderPhases (final) error:", error);
            return { success: false, error: error.message };
        }
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true };
}

// Internal: collapse any gaps in position. Reuses reorderPhases' two-phase
// write strategy.
async function compactPositions(projectId: string): Promise<void> {
    const supabase = await createClient();
    const { data: phases } = await supabase
        .from("project_phases")
        .select("id, position")
        .eq("project_id", projectId)
        .order("position", { ascending: true });

    if (!phases || phases.length === 0) return;

    const needsCompact = phases.some((p, i) => p.position !== i + 1);
    if (!needsCompact) return;

    const orderedIds = phases.map(p => p.id);

    for (let i = 0; i < orderedIds.length; i++) {
        await supabase
            .from("project_phases")
            .update({ position: -(i + 1) })
            .eq("id", orderedIds[i]);
    }
    for (let i = 0; i < orderedIds.length; i++) {
        await supabase
            .from("project_phases")
            .update({ position: i + 1 })
            .eq("id", orderedIds[i]);
    }
}
