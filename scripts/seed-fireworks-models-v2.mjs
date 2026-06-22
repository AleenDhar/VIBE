// Add the current Fireworks models the user requested (IDs verified live, 2026-06-22):
// reachable on the account -> active; supersede the earlier wrong-guess placeholders.
// Requested-but-NOT-on-account (404): Kimi K2.7 / K2 Thinking, Qwen — skipped (can't
// be made to work until enabled on the Fireworks account; not a naming issue).
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
// Earlier inactive guesses with wrong/superseded IDs — remove them.
const REMOVE = [`${P}deepseek-v3`, `${P}kimi-k2-instruct`, `${P}qwen3-235b-a22b`];
// Verified-reachable models -> active.
const ADD = [
    { id: `${P}deepseek-v4-pro`,   name: "DeepSeek V4 Pro ⚡ Fireworks (1M ctx)" },
    { id: `${P}deepseek-v4-flash`, name: "DeepSeek V4 Flash ⚡ Fireworks" },
    { id: `${P}glm-5p2`,           name: "GLM 5.2 ⚡ Fireworks" },
    { id: `${P}glm-5p1`,           name: "GLM 5.1 ⚡ Fireworks" },
    { id: `${P}kimi-k2p6`,         name: "Kimi K2.6 ⚡ Fireworks" },
    { id: `${P}minimax-m2p7`,      name: "MiniMax M2.7 ⚡ Fireworks" },
];

const { error: delErr } = await supabase.from("ai_models").delete().in("id", REMOVE);
console.log(delErr ? `delete warn: ${delErr.message}` : `Removed ${REMOVE.length} stale placeholder(s).`);

for (const m of ADD) {
    const { data: exists } = await supabase.from("ai_models").select("id").eq("id", m.id).maybeSingle();
    if (exists) {
        await supabase.from("ai_models").update({ name: m.name, provider: "fireworks", is_active: true }).eq("id", m.id);
        console.log(`updated ${m.id}`);
    } else {
        const { error } = await supabase.from("ai_models").insert({ id: m.id, name: m.name, provider: "fireworks", is_available_to_all: false, is_active: true });
        console.log(error ? `insert FAIL ${m.id}: ${error.message}` : `inserted ${m.id}`);
    }
}

const { data: fw } = await supabase.from("ai_models").select("id, name, is_active").eq("provider", "fireworks").order("name");
console.log(`\nFireworks catalog now (${(fw || []).length}):`);
for (const m of fw || []) console.log(`  [${m.is_active ? "active" : "inactive"}] ${m.name}`);
