// Diagnostic: find where claude-fable-5 (or any unavailable model) is configured
// for phase pipelines / ABM. Read-only. Run with NODE_EXTRA_CA_CERTS set.
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

// 1. ai_models catalog (what's selectable + active)
const { data: models } = await supabase.from("ai_models").select("id, name, provider, is_active, is_available_to_all").order("provider");
console.log("=== ai_models catalog ===");
for (const m of models || []) console.log(`  [${m.is_active ? "A" : "-"}] ${m.id}  (${m.provider})  "${m.name}"`);

// 2. all project_phases with their model_id, flag unknown/inactive/fable
const { data: phases } = await supabase.from("project_phases").select("id, project_id, position, name, model_id, enabled").order("project_id").order("position");
const { data: projects } = await supabase.from("projects").select("id, name");
const pname = Object.fromEntries((projects || []).map(p => [p.id, p.name]));
const modelIds = new Set((models || []).map(m => m.id));

console.log(`\n=== project_phases (${(phases || []).length}) ===`);
const phaseModelCounts = {};
for (const ph of phases || []) {
    const known = ph.model_id ? modelIds.has(ph.model_id) : false;
    phaseModelCounts[ph.model_id || "(null)"] = (phaseModelCounts[ph.model_id || "(null)"] || 0) + 1;
    const flag = ph.model_id && /fable/i.test(ph.model_id) ? " <<< FABLE" : (!known && ph.model_id ? " <<< NOT IN ai_models" : "");
    console.log(`  proj="${pname[ph.project_id] || ph.project_id}" pos=${ph.position} enabled=${ph.enabled} name="${ph.name || ""}" model=${ph.model_id || "(null)"}${flag}`);
}

console.log("\n=== distinct phase model_ids ===");
for (const [mid, n] of Object.entries(phaseModelCounts).sort((a, b) => b[1] - a[1])) {
    const known = modelIds.has(mid);
    console.log(`  ${n}x  ${mid}  ${known ? "(in ai_models)" : "(NOT in ai_models)"}`);
}

// 3. app_config default model keys, if any
const { data: cfg } = await supabase.from("app_config").select("key, value").or("key.ilike.%model%,value.ilike.%fable%");
console.log("\n=== app_config rows mentioning model/fable ===");
for (const c of cfg || []) console.log(`  ${c.key} = ${String(c.value).slice(0, 80)}`);
