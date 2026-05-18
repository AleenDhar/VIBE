
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { computeTodaySpend } from "@/lib/spend-check";
import {
    buildPipelineContext,
    validatePhaseModels,
    type Phase,
} from "@/lib/phase-pipeline";
import { dispatchPipeline } from "@/lib/dispatch-pipeline";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const supabase = await createClient();

    let user = null;
    try {
        const { data } = await supabase.auth.getUser();
        user = data.user;
    } catch (e) {
        console.error("API Auth Check Failed:", e);
        return NextResponse.json({ error: "Authentication Service Unavailable" }, { status: 503 });
    }

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Spending Cap Check ──────────────────────────────────────────
    try {
        const { data: capProfile } = await supabase
            .from("profiles")
            .select("daily_spend_cap")
            .eq("id", user.id)
            .single();

        // Per-user cap takes priority; otherwise use global default
        let effectiveCap = capProfile?.daily_spend_cap;
        if (effectiveCap === null || effectiveCap === undefined) {
            const { data: globalSetting } = await supabase
                .from("app_config")
                .select("value")
                .eq("key", "default_daily_credit")
                .single();
            effectiveCap = globalSetting ? Number(globalSetting.value) : null;
        }

        if (effectiveCap !== null && effectiveCap !== undefined && Number(effectiveCap) > 0) {
            const todaySpend = await computeTodaySpend(user.id, supabase);
            if (todaySpend >= Number(effectiveCap)) {
                return NextResponse.json(
                    { error: `Daily spending limit of $${Number(effectiveCap).toFixed(2)} reached. Your limit resets at 4:00 AM IST. Please contact an admin to increase your limit.` },
                    { status: 429 }
                );
            }
        }
    } catch (capErr) {
        // Fail open: if cap check fails, allow the request
        console.error("[API] Cap check error (allowing):", capErr);
    }

    try {
        const { projectId, chatId: rawChatId, content, previousMessages, model, images } = await req.json();

        // Helper: Ensure valid UUID
        const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

        // Generate deterministic UUID from string if needed
        async function getDeterministicUUID(str: string): Promise<string> {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest("SHA-1", data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
        }

        let chatId = rawChatId;
        if (chatId && !isValidUUID(chatId)) {
            console.log(`[API] Converting non-UUID chatId "${chatId}" to UUID`);
            chatId = await getDeterministicUUID(chatId);
        }

        let finalProjectId = projectId;
        if (projectId && !isValidUUID(projectId)) {
            console.log(`[API] Looking up Project UUID for name "${projectId}"...`);
            const { data: project } = await supabase
                .from("projects")
                .select("id")
                .ilike("name", projectId)
                .maybeSingle();

            if (project) {
                console.log(`[API] Found Project UUID: ${project.id}`);
                finalProjectId = project.id;
            } else {
                console.warn(`[API] Project "${projectId}" not found. Proceeding without project context.`);
                finalProjectId = null;
            }
        }

        console.log(`[API] Processing Chat: ${chatId} (Original: ${rawChatId}), Project: ${finalProjectId}, Model: ${model}`);

        if (!chatId || !content) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // 0. Ensure Chat Exists & Handle Auto-Naming
        const { data: existingChat } = await supabase
            .from("chats")
            .select("id, title")
            .eq("id", chatId)
            .maybeSingle();

        const generatedTitle = content.slice(0, 50) + (content.length > 50 ? "..." : "");

        if (!existingChat) {
            console.log(`[API] Creating new chat session for ID: ${chatId}`);
            await supabase.from("chats").insert({
                id: chatId,
                user_id: user.id,
                title: generatedTitle,
                project_id: finalProjectId || null
            });
        } else if (existingChat.title === "New Chat" || !existingChat.title) {
            console.log(`[API] Auto-naming chat "${chatId}" based on first message`);
            await supabase.from("chats")
                .update({ title: generatedTitle })
                .eq("id", chatId);
        }

        // 1. Save User Message
        const { error: insertError } = await supabase.from("chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: content,
            metadata: images && images.length > 0 ? { images } : {}
        });

        if (insertError) {
            console.error("Failed to save user message:", insertError);
            throw new Error(`Database Error: ${insertError.message}`);
        }

        // 2. Get Global Base Prompt
        const { data: basePromptData } = await supabase
            .from("app_config")
            .select("value")
            .eq("key", "agent_base_prompt")
            .single();
        const basePrompt = basePromptData?.value || "You are a helpful AI assistant.";

        // 2.5 Get User Profile Data and Allowed Models
        let userContextStr = `You are talking to an authenticated user with email: ${user.email}.`;
        let userRole = 'user';
        let allowedModels: string[] = [];

        try {
            const { data: profile } = await supabase
                .from("profiles")
                .select("full_name, role, allowed_models")
                .eq("id", user.id)
                .single();

            if (profile) {
                userRole = profile.role || 'user';
                allowedModels = profile.allowed_models || [];
                userContextStr = `You are currently talking to an authenticated user.
User Details:
- Name: ${profile.full_name || 'Unknown'}
- Email: ${user.email}
- Role/Permissions: ${userRole}

Please use this context to personalize your responses.`;
            }
        } catch (e) {
            console.error("Error fetching user profile for prompt context:", e);
        }

        let systemPrompt = `${basePrompt}\n\n## User Context\n${userContextStr}\n\n`;

        // 2.6 Enforce Model Access Permissions
        let finalModel = model || "openai:gpt-5-mini"; // Default fallback

        try {
            // 1. Fetch the requested model from the database to check its properties
            const { data: requestedModelData } = await supabase
                .from("ai_models")
                .select("id, is_available_to_all, is_active")
                .eq("id", finalModel)
                .single();

            if (!requestedModelData || !requestedModelData.is_active) {
                console.warn(`[API] Requested model ${finalModel} is invalid or inactive.`);
                return NextResponse.json({ error: `Model ${finalModel} is unavailable or inactive.` }, { status: 400 });
            } else {
                // Check if the user is allowed to use this specific model
                const isAvailableToAll = requestedModelData.is_available_to_all;
                const isExplicitlyAllowed = allowedModels.includes(finalModel);

                if (!isAvailableToAll && !isExplicitlyAllowed) {
                    console.warn(`[API] User ${user.id} denied access to restricted model ${finalModel}.`);
                    return NextResponse.json({ error: `You do not have permission to use this model.` }, { status: 403 });
                }
            }
        } catch (e) {
            console.error("Error validating model access:", e);
        }


        // 5. Get API Keys & Agent URL (we need them regardless of project_id, moved to top)
        const { data: configData } = await supabase
            .from("app_config")
            .select("key, value")
            .in("key", ["openai_api_key", "google_api_key", "anthropic_api_key", "agent_api_url"]);

        const apiKeys: Record<string, string> = {};
        let agentApiUrl = process.env.AGENT_API_URL || "https://agent-salesforce-link.replit.app";
        // Ensure the URL ends with /api/chat
        if (!agentApiUrl.endsWith("/api/chat") && !agentApiUrl.endsWith("/api/chat/")) {
            agentApiUrl = `${agentApiUrl.replace(/\/$/, "")}/api/chat`;
        }

        if (configData) {
            configData.forEach((row: any) => {
                if (row.key === "agent_api_url" && row.value) {
                    agentApiUrl = row.value;
                } else if (row.value) {
                    apiKeys[row.key] = row.value;
                }
            });
        }

        // ── Phase pipeline preload ─────────────────────────────────────
        // If this chat's project has any enabled phases, the request runs as a
        // sequential pipeline (loaded below). When phases exist, projects
        // .system_prompt is treated as superseded (the first phase is seeded
        // from it on creation) and is NOT appended to the system prompt.
        let projectPhases: Array<{
            id: string;
            name: string | null;
            position: number;
            model_id: string | null;
            system_prompt: string;
            enabled: boolean;
        }> = [];
        if (finalProjectId) {
            const { data: phaseRows } = await supabase
                .from("project_phases")
                .select("id, name, position, model_id, system_prompt, enabled")
                .eq("project_id", finalProjectId)
                .eq("enabled", true)
                .order("position", { ascending: true });
            projectPhases = phaseRows || [];
        }
        const phaseMode = projectPhases.length > 0;

        // Build the shared system prompt prefix (memories + RAG + behavioral
        // instructions, plus legacy projects.system_prompt when no phases).
        // Extracted into lib/phase-pipeline.ts so the automation runner can
        // assemble the exact same context for batch runs.
        if (finalProjectId) {
            systemPrompt = await buildPipelineContext({
                supabase,
                projectId: finalProjectId,
                userId: user.id,
                latestUserContent: content,
                apiKeys,
                initialPrompt: systemPrompt,
                includeLegacyProjectPrompt: !phaseMode,
            });
        }

        // 6. Build Payload
        const messagesPayload = previousMessages ? previousMessages.map((m: any) => ({
            role: m.role,
            content: m.content,
            ...(m.images && m.images.length > 0 ? { images: m.images } : {})
        })) : [];

        const currentUserMsg: any = { role: "user", content };
        if (images && images.length > 0) {
            currentUserMsg.images = images;
        }
        messagesPayload.push(currentUserMsg);

        // ── Single-call path (no phases configured) ────────────────────
        if (!phaseMode) {
            const payload = {
                messages: messagesPayload,
                system_prompt: systemPrompt,
                model: finalModel, // Enforced model from Permission Checks
                stream: true,
                chat_id: chatId, // Pass chat_id so server can log directly to DB
                project_id: finalProjectId,
                api_keys: apiKeys
                // enable_research: true // Optional: could be passed from client if needed
            };

            console.log(`[API] Forwarding to Agent Server: ${agentApiUrl}`);
            const response = await fetch(agentApiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Agent Server Error: ${response.status} - ${errorText}`);
            }

            return new NextResponse(response.body, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });
        }

        // ── Phase pipeline path — DELEGATED TO REPLIT ──────────────────
        // The pipeline orchestration now runs on Replit's /api/run-pipeline
        // endpoint because Vercel serverless functions die at 60s/300s and
        // a 6-phase ABM run easily exceeds that. Vercel's job here is just
        // to assemble the payload, validate models, kick off the run, and
        // return a tiny SSE "started" response. Replit writes chat_messages
        // directly to Supabase as each phase produces output; the chat UI
        // already uses Supabase Realtime to render new rows live.
        const validation = await validatePhaseModels(supabase, projectPhases as Phase[], allowedModels);
        if (validation.ok === false) {
            return NextResponse.json({ error: validation.error }, { status: validation.status });
        }

        const dispatch = await dispatchPipeline({
            chatId,
            projectId: finalProjectId!,
            sharedSystemPrefix: systemPrompt,
            messages: messagesPayload,
            phases: projectPhases as Phase[],
            apiKeys,
            // Replit calls back into the agent's own /api/chat for each
            // phase; this URL is the same one Vercel was hitting before.
            agentChatUrl: agentApiUrl,
        });

        const encoder = new TextEncoder();
        const sseEvent = (obj: unknown) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

        // Return a tiny SSE stream so the existing client-side parser
        // doesn't break — it reads `data: ...` lines and stops at [DONE].
        // The actual phase output streams via Supabase Realtime, not here.
        const stream = new ReadableStream({
            start(controller) {
                if (dispatch.ok) {
                    controller.enqueue(sseEvent({
                        type: "status",
                        content: "Pipeline started — output will stream live as each phase runs.",
                    }));
                } else if (dispatch.alreadyRunning) {
                    controller.enqueue(sseEvent({
                        type: "status",
                        content: "Pipeline already running for this chat — watch live updates.",
                    }));
                } else {
                    controller.enqueue(sseEvent({
                        type: "error",
                        content: dispatch.error || "Failed to start pipeline",
                    }));
                }
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                try { controller.close(); } catch {}
            },
        });

        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error("Stream Route Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
