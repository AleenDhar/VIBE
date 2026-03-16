import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Dispatch an ABM outreach run under a BDR's account.
 *
 * Called by the trigger_abm_for_account tool on DeepAgent.
 * Creates a chat under the BDR's user_id with the ABM project
 * and fires an async request to DeepAgent.
 *
 * The project_id is passed dynamically by the caller (tool or workflow).
 * Falls back to ABM_PROJECT_ID env var if not provided.
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

        // 4. Fire async request to DeepAgent
        const agentApiUrl =
            process.env.AGENT_API_URL ||
            "https://agent-salesforce-link.replit.app";
        const asyncUrl = `${agentApiUrl.replace(/\/api\/chat\/?$/, "")}/api/chat/async`;

        const agentPayload = {
            messages: [{ role: "user", content: message }],
            model: model || "anthropic:claude-sonnet-4-20250514",
            chat_id: chatId,
            project_id: resolvedProjectId,
        };

        const agentResponse = await fetch(asyncUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(agentPayload),
        });

        if (!agentResponse.ok) {
            const errorText = await agentResponse.text();
            console.error(
                "[dispatch-abm] DeepAgent rejected task:",
                errorText
            );
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
            `[dispatch-abm] Dispatched ABM for ${acctLabel} under ${bdrFullName} (${bdr_email}) → chat_id=${chatId}`
        );

        return NextResponse.json({
            dispatched: true,
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
