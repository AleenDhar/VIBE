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
const CHAT = process.argv[2] || "f9876584-39e0-4aba-9f5f-5bd03abe114d";

const { data: task } = await supabase.from("automation_tasks").select("status, last_phase_index, phase_outputs").eq("chat_id", CHAT).maybeSingle();
console.log("automation_task:", task ? JSON.stringify({status:task.status, phase:task.last_phase_index}) : "(none)");

const { data: msgs } = await supabase.from("chat_messages").select("role, type, content, metadata, created_at").eq("chat_id", CHAT).order("created_at", { ascending: true });
console.log(`\n=== ${(msgs||[]).length} messages (oldest first) ===\n`);
for (const m of msgs || []) {
    let c = m.content;
    if (Array.isArray(c)) c = c.map(b => (b && b.text) || JSON.stringify(b)).join(" ");
    c = String(c || "").replace(/\s+/g, " ").trim();
    const meta = m.metadata && Object.keys(m.metadata).length ? ` {${Object.keys(m.metadata).map(k=>`${k}:${JSON.stringify(m.metadata[k]).slice(0,60)}`).join(", ")}}` : "";
    console.log(`[${m.role}/${m.type||"-"}]${meta}`);
    console.log("   " + c.slice(0, 500));
    console.log("");
}
