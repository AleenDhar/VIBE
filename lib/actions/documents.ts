"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function addDocument(projectId: string, name: string, filePath: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    const { error } = await supabase
        .from("documents")
        .insert({
            project_id: projectId,
            name: name,
            file_path: filePath
        });

    if (error) {
        console.error("Add Document Error:", error);
        return { error: error.message };
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true };
}

export async function deleteDocument(documentId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    // Get the document to find its project
    const { data: doc } = await supabase
        .from("documents")
        .select("project_id")
        .eq("id", documentId)
        .single();

    if (!doc) {
        return { error: "Document not found" };
    }

    const { error } = await supabase
        .from("documents")
        .delete()
        .eq("id", documentId);

    if (error) {
        console.error("Delete Document Error:", error);
        return { error: error.message };
    }

    revalidatePath(`/projects/${doc.project_id}`);
    return { success: true };
}
