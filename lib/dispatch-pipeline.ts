// Dispatches a phase pipeline to the Replit orchestrator.
// =============================================================================
// Vercel can't host the orchestration loop because serverless functions die
// at 60s / 300s. Replit is always-on, so the phase loop runs there. This
// helper is the only place Vercel knows about /api/run-pipeline — the chat
// route and automation runners both go through here.
//
// Env vars required (Vercel + .env.local):
//   PIPELINE_API_URL          full URL to Replit /api/run-pipeline endpoint
//                             e.g. https://...replit.app/api/run-pipeline
//   DISPATCH_SECRET           bearer token Replit's auth middleware checks
//   SUPABASE_SERVICE_ROLE_KEY service-role JWT — sent in the body so Replit
//                             can write chat_messages bypassing RLS
//   NEXT_PUBLIC_SUPABASE_URL  also sent in the body (already required by
//                             the rest of the app)
//
// The Replit endpoint returns within 100ms and runs the loop in a background
// task; this helper awaits only that initial response.
// =============================================================================

import type { Phase } from "@/lib/phase-pipeline";

export interface DispatchPriorPhaseOutput {
    phase: {
        index: number;
        total: number;
        position: number;
        name: string | null;
        model_id: string;
    };
    content: string;
}

export interface DispatchPipelineInput {
    chatId: string;
    projectId: string;
    sharedSystemPrefix: string;
    messages: Array<{ role: string; content: string; images?: string[] }>;
    phases: Phase[];
    apiKeys: Record<string, string>;
    // The Replit /api/chat URL — the orchestrator calls it once per phase
    // for the actual LLM work. Same URL Vercel was using before.
    agentChatUrl: string;
    // Optional per-phase rerun: pre-populates the orchestrator's accumulator
    // so the first phase in `phases` sees these as Prior Phase Outputs.
    priorPhaseOutputs?: DispatchPriorPhaseOutput[];
    // Optional automation task id. When set, the orchestrator polls
    // automation_tasks.stop_requested between phases and exits cleanly
    // (marking task status='stopped') when it flips true.
    taskId?: string | null;
}

export interface DispatchResult {
    ok: boolean;
    error?: string;
    alreadyRunning?: boolean;
}

// Production Replit URL. Always-on (unlike *.replit.dev preview URLs
// which need the IDE open). Override via PIPELINE_API_URL env var.
const DEFAULT_PIPELINE_URL =
    "https://agent-salesforce-link.replit.app/api/run-pipeline";

export async function dispatchPipeline(input: DispatchPipelineInput): Promise<DispatchResult> {
    const pipelineUrl = process.env.PIPELINE_API_URL || DEFAULT_PIPELINE_URL;
    const dispatchSecret = process.env.DISPATCH_SECRET;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!pipelineUrl) {
        return { ok: false, error: "PIPELINE_API_URL env var is not set on Vercel" };
    }
    if (!dispatchSecret) {
        return { ok: false, error: "DISPATCH_SECRET env var is not set on Vercel" };
    }
    if (!supabaseUrl || !supabaseServiceKey) {
        return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL missing on Vercel" };
    }

    // Strip phases with no model_id — Replit's Pydantic likely declares
    // model_id as required and rejects nulls with HTTP 422. A phase with
    // no model can't run anyway; better to drop than to fail the whole
    // dispatch.
    const usablePhases = input.phases.filter(p => !!p.model_id);

    // Reduce messages to the minimum shape Replit's MessageModel expects:
    // just role + content. Drop `images` (and any other extras) — keeps
    // us safe against `extra="forbid"` Pydantic configs.
    const sanitizedMessages = input.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));

    const body = {
        chat_id: input.chatId,
        project_id: input.projectId,
        shared_system_prefix: input.sharedSystemPrefix,
        messages: sanitizedMessages,
        // Coerce null name → "" because Replit's Pydantic Phase.name is
        // declared as required `str`, not `Optional[str]`. Phases without
        // a custom user-set name otherwise fail validation with
        // {"loc": ["body", "phases", N, "name"], "msg": "Input should be a valid string"}
        phases: usablePhases.map(p => ({
            id: p.id,
            position: p.position,
            name: p.name ?? "",
            model_id: p.model_id ?? "",
            system_prompt: p.system_prompt ?? "",
            enabled: p.enabled,
        })),
        api_keys: input.apiKeys,
        agent_chat_url: input.agentChatUrl,
        supabase_url: supabaseUrl,
        supabase_service_key: supabaseServiceKey,
        // Same null-coercion for prior phase outputs — their phase.name /
        // phase.model_id can be null when a previous run was on a phase
        // without those fields set.
        prior_phase_outputs: (input.priorPhaseOutputs ?? []).map(o => ({
            phase: {
                index: o.phase.index,
                total: o.phase.total,
                position: o.phase.position,
                name: o.phase.name ?? "",
                model_id: o.phase.model_id ?? "",
            },
            content: o.content ?? "",
        })),
        task_id: input.taskId ?? null,
    };

    console.log(
        `[dispatch-pipeline] POST ${pipelineUrl} ` +
        `chat=${input.chatId} phases=${input.phases.length} ` +
        `task=${input.taskId || "—"} prior_outputs=${(input.priorPhaseOutputs || []).length}`
    );

    let resp: Response;
    try {
        resp = await fetch(pipelineUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${dispatchSecret}`,
            },
            body: JSON.stringify(body),
        });
    } catch (e: any) {
        const msg = e?.message || String(e);
        console.error(`[dispatch-pipeline] NETWORK ERROR posting to ${pipelineUrl}: ${msg}`);
        return { ok: false, error: `Network error contacting pipeline (${pipelineUrl}): ${msg}` };
    }

    if (!resp.ok) {
        // 409 = idempotency lock — pipeline already running for this chat.
        // Surface that distinctly so callers can show a different message.
        if (resp.status === 409) {
            return { ok: false, alreadyRunning: true, error: "Pipeline already running for this chat" };
        }
        const text = await resp.text().catch(() => "");
        console.error(
            `[dispatch-pipeline] HTTP ${resp.status} from ${pipelineUrl}\n` +
            `  Response body: ${text}\n` +
            `  Request body: ${JSON.stringify(body)}`
        );
        // Store the FULL error on the row so the user sees it without
        // having to dig in the terminal. Replit's Pydantic detail tells us
        // exactly which field is wrong.
        return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 2000)}` };
    }

    const body_out = await resp.json().catch(() => ({}));
    if (body_out?.ok === false) {
        console.error(`[dispatch-pipeline] Replit rejected dispatch: ${JSON.stringify(body_out)}`);
        return { ok: false, error: body_out.error || "Pipeline rejected the dispatch" };
    }
    console.log(`[dispatch-pipeline] OK — pipeline started for chat ${input.chatId}`);
    return { ok: true };
}
