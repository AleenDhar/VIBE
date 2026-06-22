// Add the Qwen models verified reachable on the account (2026-06-22):
//   qwen3p7-plus -> active (latest);  qwen3p6-plus -> inactive (deprecated).
// Qwen 3.5 / 235B / VL variants all 404 on this account, so they're skipped.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const P = "fireworks:accounts/fireworks/models/";
const ADD = [
    { id: `${P}qwen3p7-plus`, name: "Qwen 3.7 Plus ⚡ Fireworks", active: true },
    { id: `${P}qwen3p6-plus`, name: "Qwen 3.6 Plus ⚡ Fireworks (deprecated)", active: false },
];

for (const m of ADD) {
    const { data: exists } = await supabase.from("ai_models").select("id").eq("id", m.id).maybeSingle();
    if (exists) {
        await supabase.from("ai_models").update({ name: m.name, provider: "fireworks", is_active: m.active }).eq("id", m.id);
        console.log(`updated ${m.id} (active=${m.active})`);
    } else {
        const { error } = await supabase.from("ai_models").insert({ id: m.id, name: m.name, provider: "fireworks", is_available_to_all: false, is_active: m.active });
        console.log(error ? `insert FAIL ${m.id}: ${error.message}` : `inserted ${m.id} (active=${m.active})`);
    }
}

const { data: fw } = await supabase.from("ai_models").select("id, name, is_active").eq("provider", "fireworks").order("name");
console.log(`\nFireworks catalog now (${(fw || []).length}):`);
for (const m of fw || []) console.log(`  [${m.is_active ? "active" : "inactive"}] ${m.name}`);
