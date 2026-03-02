"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function createProject(formData: FormData) {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        redirect("/");
    }

    const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
        redirect("/projects");
    }

    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const systemPrompt = formData.get("system_prompt") as string;
    const visibility = (formData.get("visibility") as string) || "private";

    if (!name) {
        console.error("Project name is required");
        // redirect("/projects/new"); // Removed redirect to return error instead if needed, but keeping consistent
        return;
    }

    const { error } = await supabase.from("projects").insert({
        name,
        description,
        system_prompt: systemPrompt,
        owner_id: user.id,
        visibility
    });

    if (error) {
        console.error("Create Project Error:", error);
        return;
    }

    revalidatePath("/projects");
    redirect("/projects");
}

export async function updateSystemPrompt(projectId: string, systemPrompt: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    const { error } = await supabase
        .from("projects")
        .update({ system_prompt: systemPrompt })
        .eq("id", projectId)
        .eq("owner_id", user.id);

    if (error) {
        console.error("Update System Prompt Error:", error);
        return { error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true };
}

export async function updateProjectVisibility(projectId: string, visibility: 'private' | 'public') {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    const { error } = await supabase
        .from("projects")
        .update({ visibility })
        .eq("id", projectId)
        .eq("owner_id", user.id);

    if (error) {
        console.error("Update Visibility Error:", error);
        return { error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects`);
    return { success: true };
}

export async function renameProject(projectId: string, newName: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    if (!newName || !newName.trim()) {
        return { error: "Project name is required" };
    }

    const { error } = await supabase
        .from("projects")
        .update({ name: newName.trim() })
        .eq("id", projectId);

    if (error) {
        console.error("Rename Project Error:", error);
        return { error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects`);
    return { success: true };
}

export async function cloneProject(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    // 1. Fetch source project
    const { data: source, error: fetchError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

    if (fetchError || !source) {
        return { error: "Project not found" };
    }

    // 2. Create new project
    const { data: newProject, error: createError } = await supabase
        .from("projects")
        .insert({
            name: `${source.name} (Copy)`,
            description: source.description,
            system_prompt: source.system_prompt,
            owner_id: user.id,
            visibility: source.visibility || "private",
            status: source.status || "active",
        })
        .select("id")
        .single();

    if (createError || !newProject) {
        console.error("Clone - Create Project Error:", createError);
        return { error: createError?.message || "Failed to create project" };
    }

    const newProjectId = newProject.id;

    // 3. Copy project_memories
    const { data: memories } = await supabase
        .from("project_memories")
        .select("memory_type, content, sentiment, importance")
        .eq("project_id", projectId);

    if (memories && memories.length > 0) {
        const newMemories = memories.map((m: any) => ({
            ...m,
            project_id: newProjectId,
        }));
        const { error: memError } = await supabase
            .from("project_memories")
            .insert(newMemories);
        if (memError) console.error("Clone - Memories Error:", memError);
    }

    // 4. Copy agent_instructions
    const { data: instructions } = await supabase
        .from("agent_instructions")
        .select("instruction, is_active")
        .eq("project_id", projectId);

    if (instructions && instructions.length > 0) {
        const newInstructions = instructions.map((i: any) => ({
            ...i,
            project_id: newProjectId,
            user_id: user.id,
        }));
        const { error: instError } = await supabase
            .from("agent_instructions")
            .insert(newInstructions);
        if (instError) console.error("Clone - Instructions Error:", instError);
    }

    // 5. Copy documents + chunks + storage files
    const { data: documents } = await supabase
        .from("documents")
        .select("*")
        .eq("project_id", projectId);

    if (documents && documents.length > 0) {
        for (const doc of documents) {
            // Copy file in storage
            let newFilePath = doc.file_path;
            if (doc.file_path) {
                // Replace old project id with new project id in path
                newFilePath = doc.file_path.replace(
                    `projects/${projectId}`,
                    `projects/${newProjectId}`
                );

                try {
                    const { error: copyError } = await supabase.storage
                        .from("project-files")
                        .copy(doc.file_path, newFilePath);
                    if (copyError) {
                        console.error("Clone - Storage Copy Error:", copyError);
                        newFilePath = doc.file_path; // Fall back to original path
                    }
                } catch (e) {
                    console.error("Clone - Storage Copy Exception:", e);
                    newFilePath = doc.file_path;
                }
            }

            // Insert new document
            const { data: newDoc, error: docError } = await supabase
                .from("documents")
                .insert({
                    project_id: newProjectId,
                    name: doc.name,
                    file_path: newFilePath,
                    content: doc.content,
                })
                .select("id")
                .single();

            if (docError || !newDoc) {
                console.error("Clone - Document Error:", docError);
                continue;
            }

            // Copy chunks with embeddings (no re-generation needed)
            const { data: chunks } = await supabase
                .from("document_chunks")
                .select("content, embedding")
                .eq("document_id", doc.id);

            if (chunks && chunks.length > 0) {
                const newChunks = chunks.map((c: any) => ({
                    document_id: newDoc.id,
                    project_id: newProjectId,
                    content: c.content,
                    embedding: c.embedding,
                }));
                const { error: chunkError } = await supabase
                    .from("document_chunks")
                    .insert(newChunks);
                if (chunkError) console.error("Clone - Chunks Error:", chunkError);
            }
        }
    }

    revalidatePath("/projects");
    return { success: true, newProjectId };
}
