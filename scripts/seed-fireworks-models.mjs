// Seed the Fireworks AI models + (optionally) the Fireworks API key into the
// shared Supabase, using the service-role key from .env.local (bypasses RLS).
//
// Usage (PowerShell):
//   $env:FIREWORKS_API_KEY="fw_..."; node scripts/seed-fireworks-models.mjs
//   node scripts/seed-fireworks-models.mjs            # rows only, no key
//
// Idempotent: existing rows keep their is_active / is_available_to_all toggles;
// only name/provider are refreshed. The key is only written when FIREWORKS_API_KEY
// is present in the environment. Nothing secret is hardcoded in this file.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── parse .env.local ──────────────────────────────────────────────
const env = {};
try {
    const raw = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i === -1) continue;
        env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
} catch (e) {
    console.error("Could not read .env.local:", e.message);
    process.exit(1);
}

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
}

const supabase = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

const MODELS = [
    { id: "fireworks:accounts/fireworks/models/gpt-oss-120b", name: "GPT-OSS 120B ⚡ Fireworks", provider: "fireworks", is_available_to_all: false, is_active: true },
    { id: "fireworks:accounts/fireworks/models/gpt-oss-20b",  name: "GPT-OSS 20B ⚡ Fireworks",  provider: "fireworks", is_available_to_all: false, is_active: true },
    { id: "fireworks:accounts/fireworks/models/kimi-k2-instruct", name: "Kimi K2 Instruct ⚡ Fireworks", provider: "fireworks", is_available_to_all: false, is_active: false },
    { id: "fireworks:accounts/fireworks/models/deepseek-v3",  name: "DeepSeek V3 ⚡ Fireworks",  provider: "fireworks", is_available_to_all: false, is_active: false },
    { id: "fireworks:accounts/fireworks/models/qwen3-235b-a22b", name: "Qwen3 235B ⚡ Fireworks", provider: "fireworks", is_available_to_all: false, is_active: false },
];

async function main() {
    // 1. Insert new rows without clobbering existing toggles, then refresh name/provider.
    const { data: existing } = await supabase
        .from("ai_models")
        .select("id")
        .in("id", MODELS.map(m => m.id));
    const have = new Set((existing || []).map(r => r.id));

    const toInsert = MODELS.filter(m => !have.has(m.id));
    if (toInsert.length) {
        const { error } = await supabase.from("ai_models").insert(toInsert);
        if (error) { console.error("Insert failed:", error.message); process.exit(1); }
        console.log(`Inserted ${toInsert.length} new model(s):`, toInsert.map(m => m.id).join(", "));
    }
    for (const m of MODELS.filter(m => have.has(m.id))) {
        await supabase.from("ai_models").update({ name: m.name, provider: m.provider }).eq("id", m.id);
    }
    if (have.size) console.log(`Refreshed name/provider on ${have.size} existing row(s) (toggles preserved).`);

    // 2. Ensure the app_config placeholder exists; set the real key if provided.
    const fwKey = process.env.FIREWORKS_API_KEY || "";
    const { data: cfg } = await supabase.from("app_config").select("key").eq("key", "fireworks_api_key").maybeSingle();
    if (!cfg) {
        await supabase.from("app_config").insert({ key: "fireworks_api_key", value: fwKey });
        console.log(fwKey ? "Created fireworks_api_key WITH provided key." : "Created empty fireworks_api_key placeholder.");
    } else if (fwKey) {
        await supabase.from("app_config").update({ value: fwKey, updated_at: new Date().toISOString() }).eq("key", "fireworks_api_key");
        console.log("Updated fireworks_api_key with provided key.");
    } else {
        console.log("fireworks_api_key row already exists; no key provided, left as-is.");
    }

    // 3. Report super_admins (they are who can see/use Fireworks).
    const { data: supers } = await supabase.from("profiles").select("id, full_name, role").eq("role", "super_admin");
    console.log(`\nsuper_admins (${(supers || []).length}):`);
    for (const s of supers || []) console.log(`  - ${s.full_name || "(no name)"}  ${s.id}`);

    // 4. Final catalog snapshot.
    const { data: fw } = await supabase.from("ai_models").select("id, name, is_active, is_available_to_all").eq("provider", "fireworks").order("name");
    console.log(`\nFireworks models in catalog (${(fw || []).length}):`);
    for (const m of fw || []) console.log(`  - [${m.is_active ? "active" : "inactive"}] ${m.name}`);
    console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
