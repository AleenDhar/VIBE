import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
    buildPipelineContext,
    validatePhaseModels,
    type Phase,
} from "@/lib/phase-pipeline";
import { dispatchPipeline } from "@/lib/dispatch-pipeline";

export const dynamic = "force-dynamic";

/**
 * Dispatch an ABM outreach run under a BDR's account.
 *
 * Called by the MQL ingestion Lambdas (mase-sf-mql-cdc / mase-sf-report-watch)
 * and the trigger_abm_for_account tool on DeepAgent. Creates a chat under the
 * BDR's user_id with the ABM project and kicks off the agent.
 *
 * The project_id is passed dynamically by the caller (tool or workflow).
 * Falls back to ABM_PROJECT_ID env var if not provided.
 *
 * Prompt resolution — IMPORTANT:
 *   When the target project has enabled `project_phases`, this route runs the
 *   FULL phase pipeline (buildPipelineContext -> validatePhaseModels ->
 *   dispatchPipeline -> Replit /api/run-pipeline) — the exact same path the
 *   interactive chat route (app/api/chat/route.ts) and the automation runner
 *   use. That keeps a pipeline dispatch and a hand-typed UI chat in lockstep:
 *   both execute the project's phase system prompt(s) with the phase-configured
 *   model_id. Previously this route POSTed straight to /api/chat/async with no
 *   system_prompt, so the backend fell back to its bare default agent and the
 *   project's phase prompt was silently ignored.
 *
 *   When the project has NO enabled phases, it falls back to the original
 *   single-call /api/chat/async fire — but now forwards the assembled base +
 *   project context as system_prompt too.
 */

export async function POST(req: NextRequest) {
    try {
        // Authenticate — check for dispatch secret
        const authHeader = req.headers.get("authorization");
        const dispatchSecret = process.env.DISPATCH_SECRET;

        if (dispatchSecret && authHeader !== `Bearer ${dispatchSecret}`) {
            // Also allow calls from internal workflow engine (no auth header but has cookie)
            const cookie = req.headers.get("cookie");
            if (!cookie) {
                return NextResponse.json(
                    { error: "Unauthorized" },
                    { status: 401 }
                );
            }
        }

        const {
            bdr_email,
            bdr_name,
            message,
            account_id,
            account_name,
            project_id,
            model,
        } = await req.json();

        if (!bdr_email || !message) {
            return NextResponse.json(
                { error: "bdr_email and message are required" },
                { status: 400 }
            );
        }

        // project_id is dynamic — passed by caller, falls back to env var
        const resolvedProjectId =
            project_id || process.env.ABM_PROJECT_ID || null;

        // Create service-role Supabase client to bypass RLS
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !serviceKey) {
            return NextResponse.json(
                { error: "Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY" },
                { status: 500 }
            );
        }

        const supabase = createClient(supabaseUrl, serviceKey);

        // 1. Look up BDR's user_id by email (paginated)
        let bdrUserId: string | null = null;
        let bdrFullName = bdr_name || bdr_email;

        let page = 1;
        const perPage = 100;
        let found = false;
        while (!found) {
            const { data: userList } = await supabase.auth.admin.listUsers({
                page,
                perPage,
            });
            if (!userList?.users?.length) break;
            const matchedUser = userList.users.find(
                (u) => u.email?.toLowerCase() === bdr_email.toLowerCase()
            );
            if (matchedUser) {
                bdrUserId = matchedUser.id;
                bdrFullName =
                    bdr_name ||
                    matchedUser.user_metadata?.full_name ||
                    bdr_email;
                found = true;
            }
            if (userList.users.length < perPage) break;
            page++;
        }

        if (!bdrUserId) {
            return NextResponse.json(
                { error: `BDR not found: ${bdr_email}`, dispatched: false },
                { status: 404 }
            );
        }

        // 2. Create a chat under the BDR's user_id with the ABM project
        const chatId = crypto.randomUUID();
        const acctLabel = account_name || account_id || "Account";
        const chatTitle = `[ABM] ${acctLabel} - ${bdrFullName} - ${new Date().toLocaleDateString()}`;

        const { error: chatError } = await supabase.from("chats").insert({
            id: chatId,
            user_id: bdrUserId,
            project_id: resolvedProjectId,
            title: chatTitle,
        });

        if (chatError) {
            console.error("[dispatch-abm] Failed to create chat:", chatError);
            return NextResponse.json(
                { error: `Failed to create chat: ${chatError.message}` },
                { status: 500 }
            );
        }

        // 3. Insert user message into chat_messages
        await supabase.from("chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: message,
        });

        // 4. Resolve the agent prompt the SAME way interactive chats + automations
        //    do. Load (in parallel) the BDR's profile (allowed models), the global
        //    base prompt, the API keys / agent URL, and the project's enabled
        //    phases. When phases exist we run the full pipeline; otherwise we fall
        //    back to a single async call (now carrying the assembled prompt).
        const [profileRes, basePromptRes, configRes, phaseRowsRes] =
            await Promise.all([
                supabase
                    .from("profiles")
                    .select("full_name, role, allowed_models")
                    .eq("id", bdrUserId)
                    .single(),
                supabase
                    .from("app_config")
                    .select("value")
                    .eq("key", "agent_base_prompt")
                    .single(),
                supabase
                    .from("app_config")
                    .select("key, value")
                    .in("key", [
                        "openai_api_key",
                        "google_api_key",
                        "anthropic_api_key",
                        "agent_api_url",
                    ]),
                resolvedProjectId
                    ? supabase
                          .from("project_phases")
                          .select(
                              "id, name, position, model_id, system_prompt, enabled"
                          )
                          .eq("project_id", resolvedProjectId)
                          .eq("enabled", true)
                          .order("position", { ascending: true })
                    : Promise.resolve({ data: [] as any[] }),
            ]);

        const profile = profileRes.data;
        const allowedModels: string[] = profile?.allowed_models || [];
        const basePrompt =
            basePromptRes.data?.value || "You are a helpful AI assistant.";

        // API keys + agent URL. Mirror the chat route: a set AGENT_API_URL env
        // wins over the shared app_config value (local-dev override guard).
        const apiKeys: Record<string, string> = {};
        let agentApiUrl =
            process.env.AGENT_API_URL ||
            "http://mase-alb-1262623499.ap-south-1.elb.amazonaws.com";
        if (
            !agentApiUrl.endsWith("/api/chat") &&
            !agentApiUrl.endsWith("/api/chat/")
        ) {
            agentApiUrl = `${agentApiUrl.replace(/\/$/, "")}/api/chat`;
        }
        const envAgentOverride = !!process.env.AGENT_API_URL;
        (configRes.data || []).forEach((row: any) => {
            if (row.key === "agent_api_url" && row.value) {
                if (!envAgentOverride) agentApiUrl = row.value;
            } else if (row.value) {
                apiKeys[row.key] = row.value;
            }
        });

        const phases = (phaseRowsRes.data || []) as Phase[];
        const phaseMode = phases.length > 0;

        // Shared prompt prefix — identical assembly to the UI / automation path:
        // base prompt + BDR user context, then buildPipelineContext layers in
        // project memories + RAG excerpts + behavioral instructions. The legacy
        // projects.system_prompt is appended ONLY when the project has no phases
        // (mirrors app/api/chat/route.ts).
        const userContextStr = `You are currently talking to an authenticated user.
User Details:
- Name: ${bdrFullName}
- Email: ${bdr_email}
- Role/Permissions: ${profile?.role || "user"}

(Dispatched automatically by the MQL ingestion pipeline for account: ${acctLabel}.)`;
        let systemPrompt = `${basePrompt}\n\n## User Context\n${userContextStr}\n\n`;
        if (resolvedProjectId) {
            systemPrompt = await buildPipelineContext({
                supabase,
                projectId: resolvedProjectId,
                userId: bdrUserId,
                latestUserContent: message,
                apiKeys,
                initialPrompt: systemPrompt,
                includeLegacyProjectPrompt: !phaseMode,
            });
        }

        // ── Phase pipeline path (project has enabled phases) ───────────────
        // Delegated to Replit's /api/run-pipeline, which runs the phase loop in
        // the background and writes chat_messages as each phase produces output.
        // Each phase runs on its own configured model_id, so the `model` field
        // from the caller is intentionally ignored here (the phase config wins).
        if (phaseMode) {
            const validation = await validatePhaseModels(
                supabase,
                phases,
                allowedModels
            );
            if (validation.ok === false) {
                console.error(
                    `[dispatch-abm] phase model validation failed: ${validation.error}`
                );
                return NextResponse.json(
                    {
                        error: validation.error,
                        chat_id: chatId,
                        dispatched: false,
                    },
                    { status: validation.status }
                );
            }

            const dispatch = await dispatchPipeline({
                chatId,
                projectId: resolvedProjectId!,
                sharedSystemPrefix: systemPrompt,
                messages: [{ role: "user", content: message }],
                phases,
                apiKeys,
                // Replit calls back into the agent's /api/chat once per phase.
                agentChatUrl: agentApiUrl,
                taskId: null,
            });

            if (!dispatch.ok && !dispatch.alreadyRunning) {
                console.error(
                    "[dispatch-abm] pipeline dispatch failed:",
                    dispatch.error
                );
                return NextResponse.json(
                    {
                        error: `Pipeline dispatch failed: ${dispatch.error}`,
                        chat_id: chatId,
                        dispatched: false,
                    },
                    { status: 502 }
                );
            }

            console.log(
                `[dispatch-abm] Dispatched ABM PIPELINE (${phases.length} phase` +
                    `${phases.length === 1 ? "" : "s"}) for ${acctLabel} under ` +
                    `${bdrFullName} (${bdr_email}) → chat_id=${chatId}`
            );

            return NextResponse.json({
                dispatched: true,
                mode: "pipeline",
                phases: phases.length,
                chat_id: chatId,
                bdr_user_id: bdrUserId,
                bdr_name: bdrFullName,
                bdr_email,
                account_name: acctLabel,
                account_id: account_id || null,
                project_id: resolvedProjectId,
            });
        }

        // ── Single-call fallback (project has no enabled phases) ───────────
        // Preserves the original fire-and-forget behaviour, but now forwards the
        // assembled base + project context as system_prompt (previously omitted,
        // which left the backend on its bare default agent).
        const asyncUrl = `${agentApiUrl}/async`;
        const agentPayload = {
            messages: [{ role: "user", content: message }],
            system_prompt: systemPrompt,
            model: model || "anthropic:claude-sonnet-4-20250514",
            chat_id: chatId,
            project_id: resolvedProjectId,
            api_keys: apiKeys,
        };

        const agentResponse = await fetch(asyncUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(agentPayload),
        });

        if (!agentResponse.ok) {
            const errorText = await agentResponse.text();
            console.error("[dispatch-abm] DeepAgent rejected task:", errorText);
            return NextResponse.json(
                {
                    error: `DeepAgent error: ${agentResponse.status}`,
                    chat_id: chatId,
                    dispatched: false,
                },
                { status: 502 }
            );
        }

        console.log(
            `[dispatch-abm] Dispatched ABM (single-call) for ${acctLabel} under ` +
                `${bdrFullName} (${bdr_email}) → chat_id=${chatId}`
        );

        return NextResponse.json({
            dispatched: true,
            mode: "single",
            chat_id: chatId,
            bdr_user_id: bdrUserId,
            bdr_name: bdrFullName,
            bdr_email,
            account_name: acctLabel,
            account_id: account_id || null,
            project_id: resolvedProjectId,
        });
    } catch (error: any) {
        console.error("[dispatch-abm] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
