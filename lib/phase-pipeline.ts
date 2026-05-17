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
    const totalPhases = phases.length;
    const accumulatedPhaseOutputs: { role: "assistant"; content: string }[] = [];
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
            index: idx + 1,
            total: totalPhases,
            position: phase.position,
            name: phase.name,
            model_id: phase.model_id,
        };

        await callbacks.onPhaseStart?.(phaseMeta);

        const phaseSystemPrompt =
            sharedSystemPrefix +
            `\n\n## Phase Instructions (Phase ${phaseMeta.index} of ${totalPhases}${phase.name ? ` — ${phase.name}` : ""})\n${phase.system_prompt || "(no phase-specific instructions provided)"}` +
            `\n\n## Pipeline Context\nYou are phase ${phaseMeta.index} of ${totalPhases} in this project's pipeline. The conversation history above contains the user's message and (if any) the outputs of prior phases as prior assistant turns. Build on top of that work: do not repeat what's already been done — perform the task described in your Phase Instructions, then hand off to the next phase.`;

        const phaseMessages = [...messagesPayload, ...accumulatedPhaseOutputs];

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

        let upstream: Response;
        try {
            upstream = await fetch(agentApiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(phasePayload),
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

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) callbacks.onPhaseChunk?.(value);

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

        accumulatedPhaseOutputs.push({ role: "assistant", content: phaseText });
        finalText = phaseText;
        lastPhase = phaseMeta;

        // Tag every assistant chat_messages row the agent persisted during
        // this phase so the chat UI can group them under one phase divider.
        try {
            const { data: phaseRows } = await supabase
                .from("chat_messages")
                .select("id, metadata")
                .eq("chat_id", chatId)
                .eq("role", "assistant")
                .gte("created_at", phaseStartIso);
            for (const row of phaseRows || []) {
                const mergedMeta = { ...(row.metadata || {}), phase: phaseMeta };
                await supabase
                    .from("chat_messages")
                    .update({ metadata: mergedMeta })
                    .eq("id", row.id);
            }
        } catch (tagErr) {
            console.warn("runPhasePipeline: failed to tag phase metadata:", tagErr);
        }

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
