// One-off: (1) repoint the one phase pinned to the unavailable anthropic:claude-fable-5
// off it to the ABM standard sonnet-4-6, and (2) deactivate claude-fable-5 in the
// catalog so it can't be selected (the Anthropic account 404s on it: "use Opus 4.8").
// Reversible: a super_admin can re-activate fable from the admin panel if access returns.
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

const FABLE = "anthropic:claude-fable-5";
const REPLACEMENT = "anthropic:claude-sonnet-4-6";
const PID = "85cf7960-f9cd-49a7-b38b-93b1a8cc2c7d"; // On Demand APAC Campaign ABM Connect VBeta

// 1. Repoint the approved project's fable phase(s) -> sonnet (scoped to PID).
const { data: before } = await supabase.from("project_phases").select("id, project_id, position").eq("model_id", FABLE).eq("project_id", PID);
console.log(`Phases on ${FABLE} in project ${PID}: ${(before || []).length}`);
if ((before || []).length) {
    const { error } = await supabase.from("project_phases").update({ model_id: REPLACEMENT }).eq("model_id", FABLE).eq("project_id", PID);
    if (error) { console.error("phase update failed:", error.message); process.exit(1); }
    console.log(`Repointed ${(before || []).length} phase(s) -> ${REPLACEMENT}`);
}

// 2. Deactivate fable in the catalog.
const { error: e2 } = await supabase.from("ai_models").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", FABLE);
if (e2) { console.error("model deactivate failed:", e2.message); process.exit(1); }
console.log(`Deactivated ${FABLE} (is_active=false).`);

// 3. Verify.
const { data: stillFable } = await supabase.from("project_phases").select("id").eq("model_id", FABLE);
const { data: fableRow } = await supabase.from("ai_models").select("id, is_active").eq("id", FABLE).single();
console.log(`\nVerify: phases still on fable = ${(stillFable || []).length}; fable is_active = ${fableRow?.is_active}`);
