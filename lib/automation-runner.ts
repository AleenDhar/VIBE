// Server-side runner for a single automation task.
// =============================================================================
// Creates a chat in the parent project, inserts the user prompt as a message,
// then runs the project's phase pipeline using the shared helper. As phases
// complete, updates the automation_tasks row so the UI can show progress.
// Cooperative stop via task.stop_requested polled between phases.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import {
    buildPipelineContext,
    runPhasePipeline,
    validatePhaseModels,
    type Phase,
    type PhaseMeta,
} from "@/lib/phase-pipeline";

interface RunOutcome {
    ok: boolean;
    chatId?: string;
    error?: string;
}

export async function runAutomationTask(taskId: string): Promise<RunOutcome> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Unauthorized" };

    // 1. Load task + automation + project.
    const { data: task } = await supabase
        .from("automation_tasks")
        .select("id, automation_id, prompt, enabled, status")
        .eq("id", taskId)
        .maybeSingle();
    if (!task) return { ok: false, error: "Task not found" };
    if (!task.enabled) return { ok: false, error: "Task is disabled" };
    if (task.status === "running") return { ok: false, error: "Task is already running" };

    const { data: automation } = await supabase
        .from("project_automations")
        .select("project_id, name")
        .eq("id", task.automation_id)
        .maybeSingle();
    if (!automation) return { ok: false, error: "Automation not found" };
    const projectId = automation.project_id as string;

    // Flip to 'running' BEFORE the heavy setup work (RAG, chat creation,
    // phase validation, etc.) so the UI sees the state change within the
    // first 2-second poll tick instead of staring at 'pending' for several
    // seconds. chat_id is filled in by a follow-up update once the chat row
    // exists. If any setup step fails below we overwrite to 'failed'.
    await markTask(supabase, taskId, {
        status: "running",
        started_at: new Date().toISOString(),
        completed_at: null,
        last_phase_index: null,
        last_phase_total: null,
        last_phase_name: null,
        error: null,
        stop_requested: false,
        phase_outputs: [],
        chat_id: null,
    });

    // 2. Pull profile + base prompt + api keys, mirroring /api/chat setup.
    const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role, allowed_models")
        .eq("id", user.id)
        .single();
    const allowedModels: string[] = profile?.allowed_models || [];

    const { data: basePromptData } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "agent_base_prompt")
        .single();
    const basePrompt = basePromptData?.value || "You are a helpful AI assistant.";

    const { data: configData } = await supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["openai_api_key", "google_api_key", "anthropic_api_key", "agent_api_url"]);
    const apiKeys: Record<string, string> = {};
    let agentApiUrl = process.env.AGENT_API_URL || "https://agent-salesforce-link.replit.app";
    if (!agentApiUrl.endsWith("/api/chat") && !agentApiUrl.endsWith("/api/chat/")) {
        agentApiUrl = `${agentApiUrl.replace(/\/$/, "")}/api/chat`;
    }
    (configData || []).forEach((row: any) => {
        if (row.key === "agent_api_url" && row.value) agentApiUrl = row.value;
        else if (row.value) apiKeys[row.key] = row.value;
    });

    // 3. Load enabled phases.
    const { data: phaseRows } = await supabase
        .from("project_phases")
        .select("id, name, position, model_id, system_prompt, enabled")
        .eq("project_id", projectId)
        .eq("enabled", true)
        .order("position", { ascending: true });
    const phases = (phaseRows || []) as Phase[];

    if (phases.length === 0) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: "Project has no enabled phases — cannot run.",
            completed_at: new Date().toISOString(),
        });
        return { ok: false, error: "No enabled phases" };
    }

    const validation = await validatePhaseModels(supabase, phases, allowedModels);
    if (validation.ok === false) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: validation.error,
            completed_at: new Date().toISOString(),
        });
        return { ok: false, error: validation.error };
    }

    // 4. Create chat + insert the user message.
    const chatTitle = (task.prompt || "Automation task").slice(0, 50);
    const { data: chat, error: chatErr } = await supabase
        .from("chats")
        .insert({
            user_id: user.id,
            project_id: projectId,
            title: chatTitle,
        })
        .select("id")
        .single();
    if (chatErr || !chat) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: `Failed to create chat: ${chatErr?.message || "unknown"}`,
            completed_at: new Date().toISOString(),
        });
        return { ok: false, error: chatErr?.message };
    }
    const chatId = chat.id as string;

    const { error: msgErr } = await supabase.from("chat_messages").insert({
        chat_id: chatId,
        role: "user",
        content: task.prompt || "",
        metadata: {},
    });
    if (msgErr) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: `Failed to insert prompt: ${msgErr.message}`,
            chat_id: chatId,
            completed_at: new Date().toISOString(),
        });
        return { ok: false, error: msgErr.message };
    }

    // 5. Build the shared system prefix.
    const userContextStr = `You are talking to an authenticated user with email: ${user.email}.\nUser Details:\n- Name: ${profile?.full_name || "Unknown"}\n- Email: ${user.email}\n- Role/Permissions: ${profile?.role || "user"}\n\n(Run from automation: "${automation.name || "untitled"}")`;
    const initialPrompt = `${basePrompt}\n\n## User Context\n${userContextStr}\n\n`;

    const sharedSystemPrefix = await buildPipelineContext({
        supabase,
        projectId,
        userId: user.id,
        latestUserContent: task.prompt || "",
        apiKeys,
        initialPrompt,
        includeLegacyProjectPrompt: false, // phases always exist here
    });

    // 6. Status already flipped to 'running' above; now just attach the chat
    // link and the total phase count for progress display.
    await markTask(supabase, taskId, {
        chat_id: chatId,
        last_phase_total: phases.length,
    });

    // 7. Run the phase pipeline with progress callbacks.
    let lastPhase: PhaseMeta | undefined;
    let collectedError: string | undefined;
    const messagesPayload = [{ role: "user", content: task.prompt || "" }];

    const result = await runPhasePipeline(
        {
            supabase,
            chatId,
            projectId,
            sharedSystemPrefix,
            messagesPayload,
            phases,
            apiKeys,
            agentApiUrl,
        },
        {
            onPhaseStart: async (phase) => {
                lastPhase = phase;
                await markTask(supabase, taskId, {
                    last_phase_index: phase.index,
                    last_phase_total: phase.total,
                    last_phase_name: phase.name,
                });
            },
            onPhaseEnd: async (phase, accumulatedText) => {
                lastPhase = phase;
                // Append this phase's output to the task's phase_outputs
                // array. Read-modify-write — fine since a single task only
                // ever runs one pipeline at a time.
                const { data: current } = await supabase
                    .from("automation_tasks")
                    .select("phase_outputs")
                    .eq("id", taskId)
                    .maybeSingle();
                const prior = Array.isArray(current?.phase_outputs) ? current!.phase_outputs : [];
                const nextOutputs = [...prior, {
                    phase_index: phase.index,
                    phase_position: phase.position,
                    phase_name: phase.name,
                    phase_model_id: phase.model_id,
                    content: accumulatedText,
                    completed_at: new Date().toISOString(),
                }];
                await markTask(supabase, taskId, {
                    last_phase_index: phase.index,
                    last_phase_total: phase.total,
                    last_phase_name: phase.name,
                    phase_outputs: nextOutputs,
                });
            },
            onError: (msg) => {
                collectedError = msg;
            },
            shouldStop: async () => {
                const { data } = await supabase
                    .from("automation_tasks")
                    .select("stop_requested")
                    .eq("id", taskId)
                    .maybeSingle();
                return !!data?.stop_requested;
            },
        }
    );

    // 8. Finalize.
    const finishedAt = new Date().toISOString();
    if (result.stopped) {
        await markTask(supabase, taskId, {
            status: "stopped",
            completed_at: finishedAt,
        });
    } else if (result.failed) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: result.error || collectedError || "Pipeline failed",
            completed_at: finishedAt,
        });
    } else {
        await markTask(supabase, taskId, {
            status: "completed",
            completed_at: finishedAt,
            last_phase_index: lastPhase?.index ?? null,
            last_phase_total: lastPhase?.total ?? phases.length,
            last_phase_name: lastPhase?.name ?? null,
        });
    }

    return { ok: true, chatId };
}

async function markTask(supabase: any, taskId: string, patch: Record<string, unknown>) {
    try {
        const { error } = await supabase.from("automation_tasks").update(patch).eq("id", taskId);
        if (error) {
            // Loud log so missing-column / RLS issues surface in the server
            // console instead of silently corrupting the task row. The most
            // common cause is a migration that hasn't been applied yet.
            console.error(
                `[automation-runner] markTask UPDATE failed for task ${taskId}. ` +
                `Patch keys: ${Object.keys(patch).join(", ")}. ` +
                `Error: ${error.message}`
            );
        }
    } catch (e) {
        console.error(`[automation-runner] markTask threw for task ${taskId}:`, e);
    }
}
