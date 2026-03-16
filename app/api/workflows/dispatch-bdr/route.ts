import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Dispatch a workflow task to run under a BDR's account.
 *
 * Creates a chat under the BDR's user_id and fires an async request
 * to the DeepAgent server. Returns immediately — the heavy work
 * runs in the background on DeepAgent.
 *
 * Uses Supabase service role to bypass RLS and create chats under any user.
 */
export async function POST(req: NextRequest) {
    try {
        const {
            bdr_email,
            bdr_name,
            system_prompt,
            message,
            model,
            project_id,
        } = await req.json();

        if (!bdr_email || !message) {
            return NextResponse.json(
                { error: "bdr_email and message are required" },
                { status: 400 }
            );
        }

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

        // 1. Look up BDR's user_id by email
        //    profiles table has no email column, so search auth.users via admin API
        let bdrUserId: string | null = null;
        let bdrFullName = bdr_name || bdr_email;

        // Paginate through all users to find by email
        let page = 1;
        const perPage = 100;
        let found = false;
        while (!found) {
            const { data: userList } = await supabase.auth.admin.listUsers({ page, perPage });
            if (!userList?.users?.length) break;
            const matchedUser = userList.users.find(
                (u) => u.email?.toLowerCase() === bdr_email.toLowerCase()
            );
            if (matchedUser) {
                bdrUserId = matchedUser.id;
                bdrFullName = bdr_name || matchedUser.user_metadata?.full_name || bdr_email;
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

        // 2. Create a chat under the BDR's user_id
        const chatId = crypto.randomUUID();
        const chatTitle = `[Workflow] ABM Run - ${bdrFullName} - ${new Date().toLocaleDateString()}`;

        const { error: chatError } = await supabase.from("chats").insert({
            id: chatId,
            user_id: bdrUserId,
            project_id: project_id || null,
            title: chatTitle,
        });

        if (chatError) {
            console.error("[dispatch-bdr] Failed to create chat:", chatError);
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

        // 4. Fire async request to DeepAgent — fire and forget
        const agentApiUrl = process.env.AGENT_API_URL || "https://agent-salesforce-link.replit.app";
        const asyncUrl = `${agentApiUrl.replace(/\/api\/chat\/?$/, "")}/api/chat/async`;

        const agentPayload = {
            messages: [{ role: "user", content: message }],
            system_prompt: system_prompt || undefined,
            model: model || "anthropic:claude-sonnet-4-20250514",
            chat_id: chatId,
            project_id: project_id || undefined,
        };

        // Fire and forget — don't await the full response
        // We just need DeepAgent to accept the task
        const agentResponse = await fetch(asyncUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(agentPayload),
        });

        if (!agentResponse.ok) {
            const errorText = await agentResponse.text();
            console.error("[dispatch-bdr] DeepAgent rejected task:", errorText);
            return NextResponse.json(
                {
                    error: `DeepAgent error: ${agentResponse.status}`,
                    chat_id: chatId,
                    dispatched: false,
                },
                { status: 502 }
            );
        }

        // Read just the first SSE line to confirm chat_id was accepted
        // DeepAgent /api/chat/async returns SSE stream with chat_id first
        // We don't need to read the whole stream
        console.log(
            `[dispatch-bdr] Dispatched for ${bdrFullName} (${bdr_email}) → chat_id=${chatId}`
        );

        return NextResponse.json({
            dispatched: true,
            chat_id: chatId,
            bdr_user_id: bdrUserId,
            bdr_name: bdrFullName,
            bdr_email,
        });
    } catch (error: any) {
        console.error("[dispatch-bdr] Error:", error);
        return NextResponse.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
