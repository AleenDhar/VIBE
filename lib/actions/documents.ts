"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { chunkText, generateEmbeddings } from "@/lib/rag-utils";


/**
 * Helper to extract text from various file types stored in Supabase Storage
 */
async function extractTextFromFile(filePath: string): Promise<string> {
    const supabase = await createClient();

    // 1. Download the file from Supabase Storage
    const { data, error } = await supabase.storage
        .from('project-files')
        .download(filePath);

    if (error || !data) {
        throw new Error(`Failed to download file: ${error?.message || 'Unknown error'}`);
    }

    const fileExt = filePath.split('.').pop()?.toLowerCase();
    const buffer = await data.arrayBuffer();

    try {
        if (fileExt === 'pdf') {
            const pdfjs = await import('pdfjs-dist');
            // Setting worker path might be needed depending on environment, 
            // but in Next.js it usually handles it or we use a basic approach.
            const loadingTask = pdfjs.getDocument({ data: buffer });
            const pdf = await loadingTask.promise;
            let text = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                text += content.items.map((item: any) => item.str).join(" ") + "\n";
            }
            return text;
        }

        if (fileExt === 'docx') {
            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({ arrayBuffer: buffer });
            return result.value;
        }

        if (fileExt === 'xlsx' || fileExt === 'xls') {
            const xlsx = await import('xlsx');
            const workbook = xlsx.read(buffer, { type: 'array' });
            let text = "";
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                text += `Sheet: ${sheetName}\n` + xlsx.utils.sheet_to_txt(sheet) + "\n\n";
            });
            return text;
        }

        // Default to text parsing
        const textContent = new TextDecoder().decode(buffer);
        return textContent;

    } catch (e: any) {
        console.error(`Error parsing ${fileExt} file:`, e);
        throw new Error(`Failed to parse ${fileExt} file: ${e.message}`);
    }
}

export async function addDocument(projectId: string, name: string, filePath: string, content?: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    let finalContent = content;

    // If no content provided (typical for direct uploads), extract it now
    if (!finalContent && filePath) {
        try {
            finalContent = await extractTextFromFile(filePath);
        } catch (e: any) {
            console.error("Content extraction failed:", e);
            // We'll still save the doc record but without content/embeddings if it fails
        }
    }

    const { data: insertedDoc, error } = await supabase
        .from("documents")
        .insert({
            project_id: projectId,
            name: name,
            file_path: filePath,
            content: finalContent || null
        })
        .select("id")
        .single();

    if (error) {
        console.error("Add Document Error:", error);
        return { error: error.message };
    }

    if (finalContent) {
        try {
            const chunks = chunkText(finalContent);
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
