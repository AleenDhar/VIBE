// Reusable phase pipeline runner.
// =============================================================================
// Used by:
//   - app/api/chat/route.ts          → streams events back to the browser as SSE
//   - app/api/automations/...        → runs server-side with no streaming, just
//                                      progress callbacks that update DB rows
//
// The pipeline itself is unchanged from the original /api/chat implementation:
// for each enabled phase, build a per-phase system prompt, call the Python
// agent server, accumulate the assistant text, tag every assistant chat_message
// the agent persisted with phase metadata, then feed the accumulated text into
// the next phase as a prior assistant turn.
//
// Two helpers exported:
//   buildPipelineContext  — assembles the shared system prompt prefix
//                           (memories + RAG + behavioral instructions)
//   runPhasePipeline      — executes the phase loop with callback hooks
// =============================================================================

import { generateEmbeddings } from "@/lib/rag-utils";

export interface Phase {
    id: string;
    name: string | null;
    position: number;
    model_id: string | null;
    system_prompt: string;
    enabled: boolean;
}

export interface PhaseMeta {
    index: number;
    total: number;
    position: number;
    name: string | null;
    model_id: string;
}

export interface PipelineCallbacks {
    onPhaseStart?: (phase: PhaseMeta) => void | Promise<void>;
    // Raw bytes streamed from the agent server. The chat route forwards these
    // straight to the client; the automation runner can ignore them and just
    // read finalText at the end.
    onPhaseChunk?: (bytes: Uint8Array) => void;
    onPhaseEnd?: (phase: PhaseMeta, accumulatedText: string) => void | Promise<void>;
    onError?: (message: string, phase?: PhaseMeta) => void | Promise<void>;
    // Polled before each phase. Return true to exit gracefully with
    // result.stopped = true; the in-progress phase finishes first.
    shouldStop?: () => Promise<boolean> | boolean;
}

export interface RunPhasePipelineInput {
    // Any Supabase client (server or service-role) — passed through.
    supabase: any;
    chatId: string;
    projectId: string;
    // Pre-built shared prompt (use buildPipelineContext). Will have each
    // phase's own prompt + Pipeline Context footer appended.
    sharedSystemPrefix: string;
    // Initial conversation history + the current user message at the end.
    messagesPayload: Array<{ role: string; content: string; images?: string[] }>;
    phases: Phase[];
    apiKeys: Record<string, string>;
    agentApiUrl: string;
    // Override the displayed "of N" total. Defaults to phases.length. Set
    // this when rerunning a subset (e.g., one phase from the middle) so the
    // phaseMeta.total still reflects the project-level total instead of
    // showing "Phase 5 of 1".
    totalPhases?: number;
    // Pre-populate the accumulator with outputs from prior phases that
    // already ran. Used by single-phase reruns so the rerun phase still
    // sees the prior context in its "## Prior Phase Outputs" block.
    priorPhaseOutputs?: Array<{ phase: PhaseMeta; content: string }>;
}

export interface PipelineResult {
    stopped: boolean;
    failed: boolean;
    lastPhase?: PhaseMeta;
    finalText: string;
    error?: string;
}

// ── Shared prompt build ────────────────────────────────────────────────────

export interface BuildPipelineContextInput {
    supabase: any;
    projectId: string;
    userId: string;
    // The user's latest message text — used as the RAG query.
    latestUserContent: string;
    apiKeys: Record<string, string>;
    // Starting prompt (base + user context block). The helper appends to it
    // in place and returns the result.
    initialPrompt: string;
    // When true (single-call mode), the project's legacy system_prompt is
    // appended. When false (phase mode), it's skipped because phases now own
    // the prompt and the legacy field is being phased out.
    includeLegacyProjectPrompt: boolean;
}

export async function buildPipelineContext(
    input: BuildPipelineContextInput
): Promise<string> {
    const { supabase, projectId, userId, latestUserContent, apiKeys, initialPrompt, includeLegacyProjectPrompt } = input;
    let systemPrompt = initialPrompt;

    try {
        const { data: memories } = await supabase
            .from("project_memories")
            .select("memory_type, content, sentiment, importance")
            .eq("project_id", projectId)
            .order("importance", { ascending: false })
            .limit(20);

        if (memories && memories.length > 0) {
            const memoryContext = memories.map((m: any) =>
                `[${m.memory_type.toUpperCase()}] ${m.content} (Importance: ${m.importance}/10)`
            ).join("\n");
            systemPrompt += `\n\n## HIGHEST-PRIORITY CONTEXT — Project Memory\nThe following are authoritative memories for this project, captured from prior conversations and user input. They represent established facts, preferences, and rules specific to this project.\n\nYou MUST treat these as the top-priority context for every response:\n- Apply them proactively whenever relevant, without being asked.\n- They override general guidance, default behavior, and any conflicting assumptions.\n- Higher Importance scores indicate stronger precedence.\n- If a user request conflicts with a memory, surface the conflict and defer to the memory unless the user explicitly overrides it.\n\n${memoryContext}`;
        }

        if (includeLegacyProjectPrompt) {
            const { data: project } = await supabase
                .from("projects")
                .select("system_prompt")
                .eq("id", projectId)
                .single();
            if (project?.system_prompt) {
                systemPrompt += `\n\n## Project Context\n${project.system_prompt}`;
            }
        }

        const queryEmbedding = await generateEmbeddings([latestUserContent], apiKeys["openai_api_key"]);
        if (queryEmbedding && queryEmbedding.length > 0) {
            const { data: relevantChunks, error: rpcError } = await supabase.rpc(
                "match_document_chunks",
                {
                    query_embedding: queryEmbedding[0],
                    match_project_id: projectId,
                    match_threshold: 0.3,
                    match_count: 5,
                }
            );
            if (rpcError) throw rpcError;

            if (relevantChunks && relevantChunks.length > 0) {
                const docsContext = relevantChunks
                    .map((chunk: any) => `[Excerpt]:\n${chunk.content}`)
                    .join("\n\n---\n\n");
                systemPrompt += `\n\n## Relevant Document Excerpts\nBased on the user's latest message, here are the most relevant excerpts from the project's attached files. Use these to answer the user's questions definitively:\n\n${docsContext}`;
            } else {
                const { data: documents } = await supabase
                    .from("documents")
                    .select("name")
                    .eq("project_id", projectId);
                if (documents && documents.length > 0) {
                    const fileNames = documents.map((d: any) => d.name).join(", ");
                    systemPrompt += `\n\n## Attached Project Files\nThere are ${documents.length} files attached to this project: ${fileNames}. The initial semantic search did not find highly relevant excerpts for the user's current query, but the full contents are still available.\n\nIMPORTANT: You have access to these files through the search_knowledge tool. If the user asks you to read, summarize, or reference any of these files, use the search_knowledge tool to retrieve their contents. Do NOT attempt to access files via local filesystem commands like ls, cat, or any shell tools — the files are stored in a remote database, not on your local filesystem.`;
                }
            }
        }
    } catch (ragError) {
        console.error("buildPipelineContext: RAG failure (continuing):", ragError);
    }

    // Behavioral instructions — global + project-scoped for this user.
    let instructionsQuery = supabase
        .from("agent_instructions")
        .select("instruction")
        .eq("user_id", userId)
        .eq("is_active", true)
        .or(`project_id.eq.${projectId},project_id.is.null`);

    const { data: instructions } = await instructionsQuery.order("created_at", { ascending: false });
    if (instructions && instructions.length > 0) {
        const instructionsContext = instructions.map((i: any) => `- ${i.instruction}`).join("\n");
        systemPrompt += `\n\n## Behavioral Instructions\nThe following are specific instructions and behavioral rules you MUST follow in this conversation, based on previous interactions:\n${instructionsContext}`;
    }

    return systemPrompt;
}

// ── Phase loop ─────────────────────────────────────────────────────────────

export async function runPhasePipeline(
    input: RunPhasePipelineInput,
    callbacks: PipelineCallbacks = {}
): Promise<PipelineResult> {
    const { supabase, chatId, projectId, sharedSystemPrefix, messagesPayload, phases, apiKeys, agentApiUrl } = input;
    // totalPhases defaults to phases.length but can be overridden so
    // single-phase reruns still show e.g. "Phase 5 of 6" not "Phase 5 of 1".
    const totalPhases = input.totalPhases ?? phases.length;
    // Prior-phase outputs are now embedded into the next phase's SYSTEM
    // PROMPT instead of being appended to the messages array. Two reasons:
    //   1. Newer Anthropic models (Sonnet 4.6/4.7, Opus 4.7) refuse a
    //      messages array that ends with an assistant turn — they interpret
    //      it as "prefill" and respond with: "This model does not support
    //      assistant message prefill. The conversation must end with a user
    //      message." Phase 2+ would always hit this with the old design.
    //   2. The Python agent server applies cache_control to every message
    //      block; if a phase wrote no text (only tool calls), the resulting
    //      empty assistant content block triggered:
    //      "cache_control cannot be set for empty text blocks."
    // Embedding outputs into the system prompt sidesteps both issues and
    // keeps the messages array always ending with the user's message.
    //
    // Pre-populated from input.priorPhaseOutputs when a single-phase rerun
    // wants the rerunning phase to see outputs from phases that ran in a
    // previous invocation.
    const accumulatedPhaseOutputs: { phase: PhaseMeta; content: string }[] =
        input.priorPhaseOutputs ? [...input.priorPhaseOutputs] : [];
    let lastPhase: PhaseMeta | undefined;
    let finalText = "";

    for (let idx = 0; idx < phases.length; idx++) {
        const phase = phases[idx];

        if (callbacks.shouldStop && (await callbacks.shouldStop())) {
            return { stopped: true, failed: false, lastPhase, finalText };
        }

        if (!phase.model_id) {
            const msg = `Phase ${phase.position}${phase.name ? ` (${phase.name})` : ""} has no model selected — skipped.`;
            await callbacks.onError?.(msg);
            continue;
        }

        const phaseMeta: PhaseMeta = {
            // Use the project-level position as the displayed index. When
            // running the full pipeline, position == idx+1 (1-based). When
            // rerunning just one phase from the middle, idx is 0 but the
            // user should still see e.g. "Phase 5 of 6".
            index: phase.position,
            total: totalPhases,
            position: phase.position,
            name: phase.name,
            model_id: phase.model_id,
        };

        await callbacks.onPhaseStart?.(phaseMeta);

        // Build a "## Prior Phase Outputs" block summarising what previous
        // phases produced, then append phase-specific instructions + pipeline
        // context. messagesPayload is sent untouched so it always ends with
        // the original user message (avoids the assistant-prefill error).
        const priorOutputsBlock = accumulatedPhaseOutputs.length === 0
            ? ""
            : "\n\n## Prior Phase Outputs\nThe following are the outputs each earlier phase produced for THIS turn. Treat them as authoritative work already done — do not redo it. Build on it.\n\n" +
              accumulatedPhaseOutputs.map(({ phase: p, content }) =>
                  `### Phase ${p.index} of ${p.total}${p.name ? ` — ${p.name}` : ""} (${p.model_id})\n${content}`
              ).join("\n\n---\n\n");

        const phaseSystemPrompt =
            sharedSystemPrefix +
            priorOutputsBlock +
            `\n\n## Phase Instructions (Phase ${phaseMeta.index} of ${totalPhases}${phase.name ? ` — ${phase.name}` : ""})\n${phase.system_prompt || "(no phase-specific instructions provided)"}` +
            `\n\n## Pipeline Context\nYou are phase ${phaseMeta.index} of ${totalPhases} in this project's pipeline. The user's original message is the last turn in the conversation; any prior phase outputs from this turn are summarised in the "Prior Phase Outputs" section above. Build on top of that work: do not repeat what's already been done — perform the task described in your Phase Instructions, then hand off to the next phase.`;

        // Messages stays exactly as the caller built it (ends in user). Prior
        // phase outputs are above in the system prompt, not here.
        const phaseMessages = messagesPayload;

        const phasePayload = {
            messages: phaseMessages,
            system_prompt: phaseSystemPrompt,
            model: phase.model_id,
            stream: true,
            chat_id: chatId,
            project_id: projectId,
            api_keys: apiKeys,
        };

        // Marker for tagging: every assistant chat_messages row written during
        // this phase will have created_at >= this. Fixes the prior race where
        // only the most-recent row got the phase tag (often a placeholder).
        const phaseStartIso = new Date().toISOString();

        // AbortController lets us actually cancel the in-flight agent stream
        // when the user hits Stop mid-phase. Without this, Stop only fires
        // between phases and the user has to wait for the current phase to
        // run to completion before anything happens.
        const upstreamController = new AbortController();

        // Helper: tag every assistant row the agent has written for THIS
        // phase so far. Used both as a periodic live update during the
        // stream and as a final pass after the stream closes. Without the
        // live updates the chat divider only appears AFTER a phase finishes
        // — which can be minutes during long tool-heavy phases.
        const tagPhaseRows = async () => {
            try {
                const { data: phaseRows } = await supabase
                    .from("chat_messages")
                    .select("id, metadata")
                    .eq("chat_id", chatId)
                    .eq("role", "assistant")
                    .gte("created_at", phaseStartIso);
                for (const row of phaseRows || []) {
                    const existing = row.metadata || {};
                    // Skip rows that are already tagged for this phase.
                    if (existing?.phase?.position === phaseMeta.position) continue;
                    await supabase
                        .from("chat_messages")
                        .update({ metadata: { ...existing, phase: phaseMeta } })
                        .eq("id", row.id);
                }
            } catch (tagErr) {
                console.warn("runPhasePipeline: failed to tag phase metadata:", tagErr);
            }
        };

        let upstream: Response;
        try {
            upstream = await fetch(agentApiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(phasePayload),
                signal: upstreamController.signal,
            });
        } catch (fetchErr: any) {
            const msg = `Phase ${phaseMeta.index} agent fetch failed: ${fetchErr?.message || fetchErr}`;
            await callbacks.onError?.(msg, phaseMeta);
            return { stopped: false, failed: true, lastPhase: phaseMeta, finalText, error: msg };
        }

        if (!upstream.ok || !upstream.body) {
            const errText = await upstream.text().catch(() => "");
            const msg = `Phase ${phaseMeta.index} agent call failed: ${upstream.status} ${errText}`;
            await callbacks.onError?.(msg, phaseMeta);
            return { stopped: false, failed: true, lastPhase: phaseMeta, finalText, error: msg };
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let parseBuf = "";
        let phaseText = "";
        // Throttle counters. The DB-touching work is heavy enough that we
        // can't run it on every chunk; we time-gate each kind of check.
        let lastStopCheckMs = 0;
        let lastTagMs = 0;
        let stoppedMidPhase = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) callbacks.onPhaseChunk?.(value);

            // Throttled cooperative stop check. On stop, abort the upstream
            // fetch so the agent stops billing tokens and the read loop
            // unwinds cleanly.
            if (callbacks.shouldStop) {
                const nowMs = Date.now();
                if (nowMs - lastStopCheckMs > 1000) {
                    lastStopCheckMs = nowMs;
                    if (await callbacks.shouldStop()) {
                        stoppedMidPhase = true;
                        try { upstreamController.abort(); } catch {}
                        try { await reader.cancel(); } catch {}
                        break;
                    }
                }
            }

            // Live phase tagging — keep newly-written assistant rows tagged
            // with this phase's metadata so the chat divider renders during
            // the stream, not just after the phase finishes. Fire-and-forget
            // so we don't add latency to the read loop.
            {
                const nowMs = Date.now();
                if (nowMs - lastTagMs > 2000) {
                    lastTagMs = nowMs;
                    void tagPhaseRows();
                }
            }

            parseBuf += decoder.decode(value, { stream: true });
            const events = parseBuf.split("\n\n");
            parseBuf = events.pop() || "";
            for (const ev of events) {
                if (!ev.startsWith("data: ")) continue;
                const json = ev.slice(6).trim();
                if (!json || json === "[DONE]") continue;
                try {
                    const obj = JSON.parse(json);
                    if (obj.type === "token" || obj.type === "content") {
                        phaseText += obj.content || obj.token || "";
                    } else if (obj.type === "final" || obj.type === "complete") {
                        if (typeof obj.content === "string" && obj.content.length > phaseText.length) {
                            phaseText = obj.content;
                        }
                    }
                } catch {
                    /* ignore partial / non-JSON lines */
                }
            }
        }

        // If the user stopped mid-phase, exit immediately without further
        // tagging or accumulating. The runner will mark status='stopped'.
        if (stoppedMidPhase) {
            return { stopped: true, failed: false, lastPhase: phaseMeta, finalText };
        }

        // Skip phases that produced no visible text (the agent might have
        // only emitted tool calls and tool results). Including an empty
        // assistant block in subsequent payloads previously triggered
        // "cache_control cannot be set for empty text blocks" on every
        // downstream phase call.
        if (phaseText.trim().length > 0) {
            accumulatedPhaseOutputs.push({ phase: phaseMeta, content: phaseText });
            finalText = phaseText;
        }
        lastPhase = phaseMeta;

        // Final tagging pass — catches any rows the agent persisted between
        // the last live tag (up to 2s ago) and the end of the stream.
        await tagPhaseRows();

        await callbacks.onPhaseEnd?.(phaseMeta, phaseText);
    }

    return { stopped: false, failed: false, lastPhase, finalText };
}

// Validates every phase's model_id against ai_models + user's allowed list.
// Returns an error string on the first failure, or null when all pass.
export async function validatePhaseModels(
    supabase: any,
    phases: Phase[],
    allowedModels: string[]
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    const ids = Array.from(new Set(phases.map(p => p.model_id).filter((m): m is string => !!m)));
    if (ids.length === 0) return { ok: true };

    const { data: rows } = await supabase
        .from("ai_models")
        .select("id, is_available_to_all, is_active")
        .in("id", ids);
    const map = new Map((rows || []).map((m: any) => [m.id, m] as const));

    for (const phase of phases) {
        if (!phase.model_id) continue;
        const row: any = map.get(phase.model_id);
        const label = `Phase ${phase.position}${phase.name ? ` (${phase.name})` : ""}`;
        if (!row || !row.is_active) {
            return { ok: false, status: 400, error: `${label}: model "${phase.model_id}" is unavailable or inactive.` };
        }
        if (!row.is_available_to_all && !allowedModels.includes(phase.model_id)) {
            return { ok: false, status: 403, error: `${label}: you don't have permission to use model "${phase.model_id}".` };
        }
    }
    return { ok: true };
}
