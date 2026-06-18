"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { embedAndStoreDocumentChunks } from "@/lib/rag-utils";


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
        console.log(`[Extract] Parsing ${fileExt} file: ${filePath}`);

        if (fileExt === 'pdf') {
            // Use legacy build for better Node.js compatibility in some environments
            const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

            // Standard PDF.js parsing
            const loadingTask = pdfjs.getDocument({
                data: buffer,
                useWorkerFetch: false,
                isEvalSupported: false,
                useSystemFonts: true
            });

            const pdf = await loadingTask.promise;
            console.log(`[Extract] PDF loaded: ${pdf.numPages} pages`);

            let text = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items
                    .map((item: any) => item.str)
                    .join(" ");
                text += pageText + "\n";
            }

            console.log(`[Extract] PDF text extraction complete. Length: ${text.length}`);
            return text;
        }

        if (fileExt === 'docx') {
            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({ arrayBuffer: buffer });
            console.log(`[Extract] DOCX text extraction complete. Length: ${result.value.length}`);
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
            console.log(`[Extract] XLSX text extraction complete. Sheets: ${workbook.SheetNames.length}`);
            return text;
        }

        // Default to text parsing
        const textContent = new TextDecoder().decode(buffer);
        console.log(`[Extract] Text file extraction complete. Length: ${textContent.length}`);
        return textContent;

    } catch (e: any) {
        console.error(`[Extract] Error parsing ${fileExt} file:`, e);
        // Return a descriptive error that might be stored in the content if needed
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

    let indexedChunks = 0;
    if (finalContent) {
        try {
            indexedChunks = await embedAndStoreDocumentChunks(
                supabase, insertedDoc.id, projectId, finalContent,
            );
        } catch (e: any) {
            // Previously swallowed — this left a document with content but 0 chunks
            // that silently failed every RAG search. Surface it so the upload reports
            // failure and the user can re-index.
            console.error("Indexing failed for", name, e);
            return {
                success: false,
                error: `File uploaded but indexing failed: ${e.message}. ` +
                    `Open the project Files panel and use Re-index to retry.`,
                documentId: insertedDoc.id,
            };
        }
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true, indexed: indexedChunks };
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
            await embedAndStoreDocumentChunks(supabase, documentId, doc.project_id, content);
        } catch (e: any) {
            // Surface indexing failure instead of swallowing it (was leaving 0-chunk docs).
            console.error("Failed to update document embeddings:", e);
            return {
                success: false,
                error: `Content saved but indexing failed: ${e.message}. Use Re-index to retry.`,
            };
        }
    }

    revalidatePath(`/projects/${doc.project_id}`);
    return { success: true };
}

export async function reindexProjectDocuments(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    const { data: documents, error: docsError } = await supabase
        .from("documents")
        .select("id, name, file_path, content")
        .eq("project_id", projectId);

    if (docsError) {
        return { error: docsError.message };
    }

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const failures: { name: string; reason: string }[] = [];

    for (const doc of documents || []) {
        // Skip if chunks already exist
        const { count } = await supabase
            .from("document_chunks")
            .select("*", { count: "exact", head: true })
            .eq("document_id", doc.id);

        if (count && count > 0) {
            skipped++;
            continue;
        }

        try {
            // Extract content if missing
            let content = doc.content;
            if (!content && doc.file_path) {
                content = await extractTextFromFile(doc.file_path);
                await supabase
                    .from("documents")
                    .update({ content })
                    .eq("id", doc.id);
            }

            if (!content) {
                failed++;
                failures.push({ name: doc.name, reason: "No content to index" });
                continue;
            }

            const indexed = await embedAndStoreDocumentChunks(supabase, doc.id, projectId, content);
            if (indexed === 0) {
                skipped++;
                continue;
            }
            processed++;
        } catch (e: any) {
            console.error(`Re-index failed for ${doc.name}:`, e);
            failed++;
            failures.push({ name: doc.name, reason: e.message });
        }
    }

    revalidatePath(`/projects/${projectId}`);
    return { success: true, processed, skipped, failed, failures };
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
