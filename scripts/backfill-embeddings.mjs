// Standalone script: find every document with content but no chunks,
// chunk + embed via OpenAI, and insert into document_chunks.
// Uses the Supabase service role key so it bypasses RLS.
//
// Run with:  node scripts/backfill-embeddings.mjs

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- Load .env.local manually (no dotenv dependency) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m && !process.env[m[1]]) {
            process.env[m[1]] = m[2];
        }
    }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
}
if (!OPENAI_KEY) {
    console.error("Missing OPENAI_API_KEY in .env.local");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// --- chunkText: ported from lib/rag-utils.ts ---
function chunkText(text, maxChunkSize = 1000) {
    const chunks = [];
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = "";

    for (const paragraph of paragraphs) {
        if (paragraph.length > maxChunkSize) {
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = "";
            }
            const sentences = paragraph.match(/[^.!?]+[.!?]+[\])'"`’”]*|.+/g) || [paragraph];
            for (const sentence of sentences) {
                if (currentChunk.length + sentence.length > maxChunkSize) {
                    if (currentChunk) chunks.push(currentChunk);
                    currentChunk = sentence.trim();
                } else {
                    currentChunk += (currentChunk ? " " : "") + sentence.trim();
                }
            }
        } else if (currentChunk.length + paragraph.length > maxChunkSize) {
            chunks.push(currentChunk);
            currentChunk = paragraph.trim();
        } else {
            currentChunk += (currentChunk ? "\n\n" : "") + paragraph.trim();
        }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks.filter(c => c.trim().length > 0);
}

async function embedChunks(chunks) {
    const BATCH = 1000;
    const all = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH);
        const res = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: batch
        });
        all.push(...res.data.map(d => d.embedding));
    }
    return all;
}

async function main() {
    console.log("Fetching documents with content...");
    const { data: documents, error } = await supabase
        .from("documents")
        .select("id, project_id, name, content")
        .not("content", "is", null);

    if (error) {
        console.error("Failed to fetch documents:", error.message);
        process.exit(1);
    }

    console.log(`Found ${documents.length} documents with content.\n`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let skippedEmpty = 0;

    for (const doc of documents) {
        const label = `${doc.name} (${doc.id.slice(0, 8)})`;

        // Skip if already has chunks
        const { count, error: countErr } = await supabase
            .from("document_chunks")
            .select("*", { count: "exact", head: true })
            .eq("document_id", doc.id);

        if (countErr) {
            console.error(`  [FAIL] ${label} — chunk count: ${countErr.message}`);
            failed++;
            continue;
        }
        if (count && count > 0) {
            console.log(`  [SKIP] ${label} — already has ${count} chunks`);
            skipped++;
            continue;
        }

        const chunks = chunkText(doc.content);
        if (chunks.length === 0) {
            console.log(`  [SKIP] ${label} — empty after chunking`);
            skippedEmpty++;
            continue;
        }

        try {
            const embeddings = await embedChunks(chunks);
            const rows = chunks.map((chunk, i) => ({
                document_id: doc.id,
                project_id: doc.project_id,
                content: chunk,
                embedding: embeddings[i]
            }));
            const { error: insertErr } = await supabase
                .from("document_chunks")
                .insert(rows);
            if (insertErr) throw insertErr;
            console.log(`  [OK]   ${label} — ${chunks.length} chunks indexed`);
            processed++;
        } catch (e) {
            console.error(`  [FAIL] ${label} — ${e.message}`);
            failed++;
        }
    }

    console.log(`\nDone. processed=${processed} skipped=${skipped + skippedEmpty} failed=${failed}`);
}

main().catch(e => {
    console.error("Script crashed:", e);
    process.exit(1);
});
