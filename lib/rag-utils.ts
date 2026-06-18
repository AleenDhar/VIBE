import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";

// Single source of truth for the embedding model. The BACKEND query path
// (mase-dev/custom_tools/search_knowledge.py) MUST embed search queries with this
// SAME model — otherwise stored document vectors and query vectors live in
// different spaces and cosine similarity is meaningless. Both sides default to
// text-embedding-3-small and read the EMBEDDING_MODEL env var; keep them in sync.
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

export function chunkText(text: string, maxChunkSize = 1000): string[] {
    const chunks: string[] = [];
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = "";

    for (const paragraph of paragraphs) {
        if (paragraph.length > maxChunkSize) {
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = "";
            }
            // Naive split by sentences
            const sentences = paragraph.match(/[^.!?]+[.!?]+[\])'"`’”]*|.+/g) || [paragraph];
            for (const sentence of sentences) {
                if (currentChunk.length + sentence.length > maxChunkSize) {
                    if (currentChunk) chunks.push(currentChunk);
                    currentChunk = sentence.trim();
                } else {
                    currentChunk += (currentChunk ? " " : "") + sentence.trim();
                }
            }
        }
        else if (currentChunk.length + paragraph.length > maxChunkSize) {
            chunks.push(currentChunk);
            currentChunk = paragraph.trim();
        } else {
            currentChunk += (currentChunk ? "\n\n" : "") + paragraph.trim();
        }
    }
    if (currentChunk) chunks.push(currentChunk);

    // Filter out empty chunks
    return chunks.filter(c => c.trim().length > 0);
}

export async function generateEmbeddings(chunks: string[], apiKey?: string): Promise<number[][]> {
    if (chunks.length === 0) return [];

    let key = apiKey || process.env.OPENAI_API_KEY;

    // If no key provided, try to fetch from app_config
    if (!key) {
        const supabase = await createClient();
        const { data } = await supabase
            .from("app_config")
            .select("value")
            .eq("key", "openai_api_key")
            .single();
        if (data?.value) {
            key = data.value;
        }
    }

    if (!key) {
        throw new Error("OpenAI API key is missing. Cannot generate embeddings.");
    }

    const openai = new OpenAI({ apiKey: key });

    // Limit is typically ~2048 arrays at once, we should perform batching if exceeding, 
    // but assuming standard files we can just send it.
    const CHUNK_BATCH_SIZE = 1000;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
        const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
        const response = await openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: batch,
        });
        const embeddings = response.data.map(d => d.embedding);
        allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
}

/**
 * Insert chunk rows in small batches. A single large insert of many ~1536-dim
 * vector rows can exceed the Postgres statement timeout — the root cause of large
 * RAG files silently landing at 0 chunks. Batching keeps each statement small.
 * Throws on the first failing batch so callers can surface the error instead of
 * swallowing it.
 */
export async function insertChunksInBatches(
    supabase: any,
    rows: any[],
    batchSize = 100,
): Promise<void> {
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error } = await supabase.from("document_chunks").insert(batch);
        if (error) {
            throw new Error(
                `chunk insert failed at batch ${Math.floor(i / batchSize) + 1} ` +
                `(rows ${i}-${i + batch.length} of ${rows.length}): ${error.message}`,
            );
        }
    }
}

/**
 * Chunk + embed `content` and (re)store the vectors for a document. Idempotent:
 * deletes any existing chunks for the document first. Returns the number of
 * chunks stored (0 if the content produced no chunks). On any embed/insert
 * failure it cleans up partial chunks and rethrows — it never leaves a
 * half-indexed or silently-empty document behind.
 */
export async function embedAndStoreDocumentChunks(
    supabase: any,
    documentId: string,
    projectId: string,
    content: string,
): Promise<number> {
    const chunks = chunkText(content);
    if (chunks.length === 0) return 0;

    const embeddings = await generateEmbeddings(chunks);
    const rows = chunks.map((chunk, i) => ({
        document_id: documentId,
        project_id: projectId,
        content: chunk,
        embedding: embeddings[i],
    }));

    // Replace existing chunks so re-indexing is idempotent.
    await supabase.from("document_chunks").delete().eq("document_id", documentId);
    try {
        await insertChunksInBatches(supabase, rows, 100);
    } catch (e) {
        // Don't leave a partially-indexed document behind.
        await supabase.from("document_chunks").delete().eq("document_id", documentId);
        throw e;
    }
    return chunks.length;
}
