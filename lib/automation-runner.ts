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
    validatePhaseModels,
    type Phase,
} from "@/lib/phase-pipeline";
import { dispatchPipeline, type DispatchPriorPhaseOutput } from "@/lib/dispatch-pipeline";

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

    // 1. Flip to 'running' immediately so the UI shows the state change on
    // the next poll tick instead of staring at 'pending'. If any setup step
    // fails below, we overwrite to 'failed'.
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

    // 2. Create the chat IMMEDIATELY and stamp it onto the task. This is
    // what the user sees in the Chat column — making it appear as fast as
    // possible matters more than the setup work that follows. Chat creation
    // only needs user.id + projectId + the prompt, all already in hand.
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

    // Stamp chat_id onto the task FIRST so the UI's next poll tick (within
    // ~2s of the click) sees it and the Open link appears. The user-message
    // insert and rest of the setup happen in parallel below.
    const chatStampPromise = markTask(supabase, taskId, { chat_id: chatId });

    // 3. Insert the user message + load profile / config / phases in
    // parallel. These have no dependencies on each other.
    const [
        ,
        msgRes,
        profileRes,
        basePromptRes,
        configRes,
        phaseRowsRes,
    ] = await Promise.all([
        chatStampPromise,
        supabase.from("chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: task.prompt || "",
            metadata: {},
        }),
        supabase.from("profiles").select("full_name, role, allowed_models").eq("id", user.id).single(),
        supabase.from("app_config").select("value").eq("key", "agent_base_prompt").single(),
        supabase.from("app_config").select("key, value").in("key", [
            "openai_api_key", "google_api_key", "anthropic_api_key", "agent_api_url",
        ]),
        supabase.from("project_phases")
            .select("id, name, position, model_id, system_prompt, enabled")
            .eq("project_id", projectId).eq("enabled", true)
            .order("position", { ascending: true }),
    ]);

    if (msgRes.error) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: `Failed to insert prompt: ${msgRes.error.message}`,
            completed_at: new Date().toISOString(),
        });
        return { ok: false, error: msgRes.error.message };
    }

    const profile = profileRes.data;
    const allowedModels: string[] = profile?.allowed_models || [];
    const basePrompt = basePromptRes.data?.value || "You are a helpful AI assistant.";

    const apiKeys: Record<string, string> = {};
    let agentApiUrl = process.env.AGENT_API_URL || "http://mase-alb-1262623499.ap-south-1.elb.amazonaws.com";
    if (!agentApiUrl.endsWith("/api/chat") && !agentApiUrl.endsWith("/api/chat/")) {
        agentApiUrl = `${agentApiUrl.replace(/\/$/, "")}/api/chat`;
    }
    (configRes.data || []).forEach((row: any) => {
        if (row.key === "agent_api_url" && row.value) agentApiUrl = row.value;
        else if (row.value) apiKeys[row.key] = row.value;
    });

    const phases = (phaseRowsRes.data || []) as Phase[];
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

    // Stamp the phase count now that we know it.
    await markTask(supabase, taskId, { last_phase_total: phases.length });

    // 4. Build the shared system prefix (RAG — can take a moment).
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

    // 7. Dispatch the pipeline to Replit's /api/run-pipeline endpoint.
    // Replit runs the loop in the background and writes chat_messages +
    // updates automation_tasks (last_phase_*, phase_outputs, status) as
    // each phase completes. We don't await execution here — only the
    // initial dispatch call.
    //
    // The stale-task sweep in listTasks (2-min updated_at threshold)
    // catches truly-dead pipelines. Replit's per-phase markTask writes
    // bump updated_at naturally, so a live pipeline is never reaped.
    const messagesPayload = [{ role: "user", content: task.prompt || "" }];

    const dispatch = await dispatchPipeline({
        chatId,
        projectId,
        sharedSystemPrefix,
        messages: messagesPayload,
        phases,
        apiKeys,
        agentChatUrl: agentApiUrl,
        taskId,
    });

    if (!dispatch.ok) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: `Failed to dispatch pipeline: ${dispatch.error}`,
            completed_at: new Date().toISOString(),
        });
        return { ok: false, error: dispatch.error };
    }

    return { ok: true, chatId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-phase rerun
// ─────────────────────────────────────────────────────────────────────────────
// Re-runs a specific phase for a task that has already completed (or failed)
// at least the prior phases. Reuses the existing chat. Outputs of the prior
// phases come from task.phase_outputs and are passed to the pipeline as
// priorPhaseOutputs so the rerun phase still sees its full context.
//
// Behavior:
//   - Refuses if the task is currently running (status='running').
//   - Deletes chat_messages tagged with the target phase position to avoid
//     stale duplicated rows mingling with the rerun's output.
//   - Replaces the corresponding entry in task.phase_outputs with the new
//     content (or appends if it wasn't there).
export async function runAutomationTaskPhase(
    taskId: string,
    phasePosition: number
): Promise<RunOutcome> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Unauthorized" };

    console.log(`[automation-runner] runAutomationTaskPhase: starting task=${taskId} phase=${phasePosition}`);

    // 1. Load task + automation.
    const { data: task } = await supabase
        .from("automation_tasks")
        .select("id, automation_id, prompt, enabled, status, chat_id, phase_outputs")
        .eq("id", taskId)
        .maybeSingle();
    if (!task) {
        console.error(`[automation-runner] task ${taskId} not found`);
        return { ok: false, error: "Task not found" };
    }
    if (!task.chat_id) {
        console.error(`[automation-runner] task ${taskId} has no chat_id — full pipeline never ran`);
        return { ok: false, error: "No chat associated with this task — run the full pipeline first" };
    }
    // Intentionally NOT guarding on status='running'. A row stuck in
    // 'running' from a crashed prior runner would otherwise block all
    // reruns until the stale sweep ticks (up to 2 minutes). Force-flip to
    // stopped first so any zombie runner that's still alive bails out on
    // its next shouldStop poll, then proceed.
    if (task.status === "running") {
        console.warn(`[automation-runner] task ${taskId} was already 'running' — signalling stop before rerun`);
        await markTask(supabase, taskId, { stop_requested: true });
    }

    const { data: automation } = await supabase
        .from("project_automations")
        .select("project_id, name")
        .eq("id", task.automation_id)
        .maybeSingle();
    if (!automation) return { ok: false, error: "Automation not found" };
    const projectId = automation.project_id as string;
    const chatId = task.chat_id as string;

    // 2. Flip to running and clear progress for THIS phase.
    await markTask(supabase, taskId, {
        status: "running",
        started_at: new Date().toISOString(),
        completed_at: null,
        last_phase_index: phasePosition,
        last_phase_name: null,
        error: null,
        stop_requested: false,
    });

    // 3. Load profile / config / phases in parallel.
    const [
        profileRes,
        basePromptRes,
        configRes,
        phaseRowsRes,
    ] = await Promise.all([
        supabase.from("profiles").select("full_name, role, allowed_models").eq("id", user.id).single(),
        supabase.from("app_config").select("value").eq("key", "agent_base_prompt").single(),
        supabase.from("app_config").select("key, value").in("key", [
            "openai_api_key", "google_api_key", "anthropic_api_key", "agent_api_url",
        ]),
        supabase.from("project_phases")
            .select("id, name, position, model_id, system_prompt, enabled")
            .eq("project_id", projectId).eq("enabled", true)
            .order("position", { ascending: true }),
    ]);

    const profile = profileRes.data;
    const allowedModels: string[] = profile?.allowed_models || [];
    const basePrompt = basePromptRes.data?.value || "You are a helpful AI assistant.";
    const apiKeys: Record<string, string> = {};
    let agentApiUrl = process.env.AGENT_API_URL || "http://mase-alb-1262623499.ap-south-1.elb.amazonaws.com";
    if (!agentApiUrl.endsWith("/api/chat") && !agentApiUrl.endsWith("/api/chat/")) {
        agentApiUrl = `${agentApiUrl.replace(/\/$/, "")}/api/chat`;
    }
    (configRes.data || []).forEach((row: any) => {
        if (row.key === "agent_api_url" && row.value) agentApiUrl = row.value;
        else if (row.value) apiKeys[row.key] = row.value;
    });

    const allPhases = (phaseRowsRes.data || []) as Phase[];
    // Rerun runs from the target phase ALL THE WAY to the end of the
    // pipeline. The 1..N-1 outputs that are already in task.phase_outputs
    // get passed as priorPhaseOutputs; everything from N onward runs fresh.
    const phasesToRun = allPhases.filter(p => p.position >= phasePosition);
    if (phasesToRun.length === 0) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: `Phase at position ${phasePosition} not found or disabled.`,
            completed_at: new Date().toISOString(),
        });
        return { ok: false, error: "No phases at or after target position" };
    }

    const validation = await validatePhaseModels(supabase, phasesToRun, allowedModels);
    if (validation.ok === false) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: validation.error,
            completed_at: new Date().toISOString(),
        });
        return { ok: false, error: validation.error };
    }

    // 4. Build prior phase outputs from task.phase_outputs (entries with
    // position < target). The rerun phase will see these in its system
    // prompt's "## Prior Phase Outputs" block exactly as if they had just
    // run sequentially.
    const priorOutputs = (task.phase_outputs || [])
        .filter((o: any) => o.phase_position < phasePosition)
        .sort((a: any, b: any) => a.phase_position - b.phase_position)
        .map((o: any) => ({
            phase: {
                index: o.phase_position,
                total: allPhases.length,
                position: o.phase_position,
                name: o.phase_name,
                model_id: o.phase_model_id,
            },
            content: o.content,
        }));

    // 5. Delete any chat_messages already tagged with this phase OR any
    // phase after it — those are all about to be regenerated. Leaves
    // phases 1..(target-1) untouched.
    try {
        const { data: existingRows } = await supabase
            .from("chat_messages")
            .select("id, metadata")
            .eq("chat_id", chatId)
            .eq("role", "assistant");
        const idsToDelete = (existingRows || [])
            .filter((r: any) => {
                const pos = r.metadata?.phase?.position;
                return typeof pos === "number" && pos >= phasePosition;
            })
            .map((r: any) => r.id);
        if (idsToDelete.length > 0) {
            await supabase.from("chat_messages").delete().in("id", idsToDelete);
        }
    } catch (delErr) {
        console.warn(`[automation-runner] failed to clear phase ${phasePosition}+ rows:`, delErr);
    }

    // Also clear task.phase_outputs entries for phases >= target so the UI
    // doesn't show stale results while the rerun is in flight. The runner's
    // onPhaseEnd will repopulate as each phase completes.
    {
        const surviving = (task.phase_outputs || []).filter(
            (o: any) => o.phase_position < phasePosition
        );
        await markTask(supabase, taskId, { phase_outputs: surviving });
    }

    // 6. Build shared system prefix (RAG against the original prompt).
    const userContextStr = `You are talking to an authenticated user with email: ${user.email}.\nUser Details:\n- Name: ${profile?.full_name || "Unknown"}\n- Email: ${user.email}\n- Role/Permissions: ${profile?.role || "user"}\n\n(Rerun from phase ${phasePosition} onward in automation: "${automation.name || "untitled"}")`;
    const initialPrompt = `${basePrompt}\n\n## User Context\n${userContextStr}\n\n`;
    const sharedSystemPrefix = await buildPipelineContext({
        supabase,
        projectId,
        userId: user.id,
        latestUserContent: task.prompt || "",
        apiKeys,
        initialPrompt,
        includeLegacyProjectPrompt: false,
    });

    // 7. Dispatch the partial pipeline to Replit. Replit pre-seeds its
    // accumulator with priorOutputs so the rerun phase sees Phase 1..N-1
    // in its system prompt's Prior Phase Outputs block, then runs the
    // target phase plus every phase after it.
    const messagesPayload = [{ role: "user", content: task.prompt || "" }];

    // Shape priorOutputs to match the dispatch helper's contract.
    // priorOutputs was built with `(o: any)` filters above so its element
    // type is `any` — annotate explicitly here.
    const dispatchPriorOutputs: DispatchPriorPhaseOutput[] = priorOutputs.map((o: any) => ({
        phase: {
            index: o.phase.index,
            total: o.phase.total,
            position: o.phase.position,
            name: o.phase.name,
            model_id: o.phase.model_id,
        },
        content: o.content,
    }));

    const dispatch = await dispatchPipeline({
        chatId,
        projectId,
        sharedSystemPrefix,
        messages: messagesPayload,
        phases: phasesToRun,
        apiKeys,
        agentChatUrl: agentApiUrl,
        priorPhaseOutputs: dispatchPriorOutputs,
        taskId,
    });

    if (!dispatch.ok) {
        await markTask(supabase, taskId, {
            status: "failed",
            error: `Failed to dispatch phase rerun: ${dispatch.error}`,
            completed_at: new Date().toISOString(),
        });
        return { ok: false, error: dispatch.error };
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
