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
const PID = "85cf7960-f9cd-49a7-b38b-93b1a8cc2c7d";
const { data: proj } = await supabase.from("projects").select("id, name, system_prompt").eq("id", PID).single();
console.log("PROJECT:", proj?.name, "| id:", proj?.id);
const { data: phases } = await supabase.from("project_phases").select("position, name, model_id, enabled").eq("project_id", PID).order("position");
console.log("PHASES:");
for (const p of phases || []) console.log(`  pos=${p.position} enabled=${p.enabled} name="${p.name||""}" model=${p.model_id}`);
