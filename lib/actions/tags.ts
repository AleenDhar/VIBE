"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface Tag {
    id: string;
    name: string;
}

export interface TagWithUsage extends Tag {
    usage_count: number;
}

// Server-side mirror of the canEdit logic used in the project detail page:
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

function normalizeTagName(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

// List all tags with usage counts (for the filter dropdown + "add tag" combobox).
export async function getAllTagsWithUsage(): Promise<TagWithUsage[]> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_tags_with_usage");
    if (error) {
        console.error("getAllTagsWithUsage error:", error);
        return [];
    }
    return (data || []).map((t: { id: string; name: string; usage_count: number }) => ({
        id: t.id,
        name: t.name,
        usage_count: Number(t.usage_count),
    }));
}

// Tags attached to a single project.
export async function getProjectTags(projectId: string): Promise<Tag[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("project_tags")
        .select("tag:tags(id, name)")
        .eq("project_id", projectId);

    if (error) {
        console.error("getProjectTags error:", error);
        return [];
    }
    return (data || [])
        .map((row: any) => row.tag)
        .filter(Boolean)
        .sort((a: Tag, b: Tag) => a.name.localeCompare(b.name));
}

// Tags for many projects in one round trip — returns a map of projectId -> Tag[].
export async function getTagsForProjects(projectIds: string[]): Promise<Record<string, Tag[]>> {
    if (projectIds.length === 0) return {};
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("project_tags")
        .select("project_id, tag:tags(id, name)")
        .in("project_id", projectIds);

    if (error) {
        console.error("getTagsForProjects error:", error);
        return {};
    }

    const map: Record<string, Tag[]> = {};
    (data || []).forEach((row: any) => {
        if (!row.tag) return;
        (map[row.project_id] ||= []).push(row.tag);
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => a.name.localeCompare(b.name)));
    return map;
}

// Attach a tag to a project, creating the tag if it doesn't exist yet.
export async function addTagToProject(projectId: string, rawName: string) {
    const name = normalizeTagName(rawName);
    if (!name) return { success: false, error: "Tag name is empty." };
    if (name.length > 50) return { success: false, error: "Tag name too long (max 50 chars)." };

    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access to this project." };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Find-or-create tag.
    const { data: existing } = await supabase
        .from("tags")
        .select("id, name")
        .eq("name", name)
        .maybeSingle();

    let tagId = existing?.id;
    if (!tagId) {
        const { data: created, error: createError } = await supabase
            .from("tags")
            .insert({ name, created_by: user!.id })
            .select("id")
            .single();
        if (createError || !created) {
            return { success: false, error: createError?.message || "Failed to create tag." };
        }
        tagId = created.id;
    }

    const { error: linkError } = await supabase
        .from("project_tags")
        .upsert(
            { project_id: projectId, tag_id: tagId, created_by: user!.id },
            { onConflict: "project_id,tag_id" }
        );
    if (linkError) {
        return { success: false, error: linkError.message };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/projects");
    return { success: true, tag: { id: tagId, name } as Tag };
}

export async function removeTagFromProject(projectId: string, tagId: string) {
    if (!(await userCanEditProject(projectId))) {
        return { success: false, error: "You don't have edit access to this project." };
    }

    const supabase = await createClient();
    const { error } = await supabase
        .from("project_tags")
        .delete()
        .eq("project_id", projectId)
        .eq("tag_id", tagId);

    if (error) {
        return { success: false, error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/projects");
    return { success: true };
}
