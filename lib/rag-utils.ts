import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";

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
            model: "text-embedding-3-small",
            input: batch,
        });
        const embeddings = response.data.map(d => d.embedding);
        allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
}
