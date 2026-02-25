import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { chunkText, generateEmbeddings } from "@/lib/rag-utils";

export async function GET(req: Request) {
    const supabase = await createClient();

    // Auth check - ensure only admins can run this
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // Find documents that have content but no chunks
        // we can find docs missing chunks using a left join or just getting all and checking if chunks exist
        // The simplest way to backfill everything missing is fetching documents with content
        const { data: documents, error: docsError } = await supabase
            .from("documents")
            .select("id, project_id, content")
            .not("content", "is", null);

        if (docsError) throw docsError;

        const results = [];

        for (const doc of documents) {
            if (!doc.content) continue;

            // Check if it already has chunks
            const { count } = await supabase
                .from("document_chunks")
                .select("*", { count: 'exact', head: true })
                .eq("document_id", doc.id);

            if (count && count > 0) {
                results.push({ id: doc.id, status: "skipped (already chunked)" });
                continue;
            }

            // Chunk and embed
            const chunks = chunkText(doc.content);
            if (chunks.length === 0) {
                results.push({ id: doc.id, status: "skipped (empty chunks)" });
                continue;
            }

            try {
                const embeddings = await generateEmbeddings(chunks);

                const chunkRows = chunks.map((chunk, i) => ({
                    document_id: doc.id,
                    project_id: doc.project_id,
                    content: chunk,
                    embedding: embeddings[i]
                }));

                const { error: insertError } = await supabase
                    .from("document_chunks")
                    .insert(chunkRows);

                if (insertError) throw insertError;

                results.push({ id: doc.id, status: `success (added ${chunks.length} chunks)` });

            } catch (embedError: any) {
                console.error("Error processing doc", doc.id, embedError);
                results.push({ id: doc.id, status: `failed: ${embedError.message}` });
            }
        }

        return NextResponse.json({ success: true, processed: results.length, results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
