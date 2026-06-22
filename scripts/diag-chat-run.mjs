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
const CHAT = "32782458-4292-418e-98d2-01534078bb51";

const { data: chat } = await supabase.from("chats").select("*").eq("id", CHAT).maybeSingle();
console.log("CHAT row keys:", chat ? Object.keys(chat).join(", ") : "(none)");
if (chat) console.log("  title:", chat.title, "| project:", chat.project_id);

const { data: task } = await supabase.from("automation_tasks").select("id, status, stop_requested, last_phase_index, last_phase_total").eq("chat_id", CHAT).maybeSingle();
console.log("\nautomation_task:", task ? JSON.stringify(task) : "(none — chat-triggered, no task_id)");

const { data: msgs } = await supabase.from("chat_messages").select("role, type, content, metadata, created_at").eq("chat_id", CHAT).order("created_at", { ascending: false }).limit(8);
console.log(`\nlast ${(msgs||[]).length} messages (newest first):`);
for (const m of msgs || []) {
    const meta = m.metadata && Object.keys(m.metadata).length ? JSON.stringify(m.metadata).slice(0, 160) : "";
    console.log(`  [${m.role}/${m.type || "-"}] ${String(m.content || "").slice(0, 60).replace(/\n/g, " ")}  ${meta}`);
}
