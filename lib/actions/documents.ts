"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { chunkText, generateEmbeddings } from "@/lib/rag-utils";

export async function addDocument(projectId: string, name: string, filePath: string, content?: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    const { data: insertedDoc, error } = await supabase
        .from("documents")
        .insert({
            project_id: projectId,
            name: name,
            file_path: filePath,
            content: content || null
        })
        .select("id")
        .single();

    if (error) {
        console.error("Add Document Error:", error);
        return { error: error.message };
    }

    if (content) {
        try {
            const chunks = chunkText(content);
            if (chunks.length > 0) {
                const embeddings = await generateEmbeddings(chunks);
                const chunkRows = chunks.map((chunk, i) => ({
                    document_id: insertedDoc.id,
                    project_id: projectId,
                    content: chunk,
                    embedding: embeddings[i]
                }));
                const { error: insertError } = await supabase.from("document_chunks").insert(chunkRows);
                if (insertError) console.error("Error inserting document chunks:", insertError);
            }
        } catch (e) {
            console.error("Failed to generate document embeddings:", e);
            // Non-fatal, let the doc upload succeed anyway
        }
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true };
}

export async function updateDocumentContent(documentId: string, content: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

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
        .update({ content })
        .eq("id", documentId);

    if (error) {
        console.error("Update Document Content Error:", error);
        return { error: error.message };
    }

    if (content) {
        try {
            // First clear existing chunks
            await supabase.from("document_chunks").delete().eq("document_id", documentId);

            const chunks = chunkText(content);
            if (chunks.length > 0) {
                const embeddings = await generateEmbeddings(chunks);
                const chunkRows = chunks.map((chunk, i) => ({
                    document_id: documentId,
                    project_id: doc.project_id,
                    content: chunk,
                    embedding: embeddings[i]
                }));
                const { error: insertError } = await supabase.from("document_chunks").insert(chunkRows);
                if (insertError) console.error("Error inserting updated chunks:", insertError);
            }
        } catch (e) {
            console.error("Failed to update document embeddings:", e);
        }
    }

    revalidatePath(`/projects/${doc.project_id}`);
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
