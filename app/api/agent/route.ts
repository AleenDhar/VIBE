import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

// Helper: Deterministic UUID from string
async function getDeterministicUUID(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-1", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function POST(req: NextRequest) {
    const supabase = await createClient();

    // 1. Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        let { projectId, chatId, content, previousMessages, model } = body;

        console.log(`[Proxy] Received: Chat=${chatId}, Project=${projectId}`);

        if (!content) {
            return NextResponse.json({ error: "Missing content" }, { status: 400 });
        }

        // 2. Chat ID Sanitization (String -> UUID)
        const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        if (chatId && !isValidUUID(chatId)) {
            console.log(`[Proxy] Normalizing Chat ID "${chatId}" to UUID`);
            chatId = await getDeterministicUUID(chatId);
        } else if (!chatId) {
            chatId = await getDeterministicUUID(`chat-${Date.now()}`);
        }

        // 3. Project ID Lookup (Name -> UUID)
        if (projectId && !isValidUUID(projectId)) {
            console.log(`[Proxy] Looking up Project UUID for name "${projectId}"...`);
            const { data: project } = await supabase
                .from("projects")
                .select("id")
                .ilike("name", projectId) // Case-insensitive lookup
                .maybeSingle();

            if (project) {
                console.log(`[Proxy] Found Project UUID: ${project.id}`);
                projectId = project.id;
            } else {
                console.warn(`[Proxy] Project "${projectId}" not found. Proceeding without project context.`);
                projectId = null;
            }
        }

        // 4. Ensure Chat Session Exists
        // We must ensure the parent chat row exists before inserting messages
        const { data: existingChat } = await supabase.from("chats").select("id").eq("id", chatId).maybeSingle();
        if (!existingChat) {
            await supabase.from("chats").insert({
                id: chatId,
                user_id: user.id,
                title: content.slice(0, 50) || "New Chat",
                project_id: projectId || null
            });
        }

        // 5. Save User Message
        await supabase.from("chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: content
        });

        // 6. Config & Prompt Construction
        const { data: configData } = await supabase
            .from("app_config")
            .select("key, value")
            .in("key", ["openai_api_key", "google_api_key", "anthropic_api_key", "agent_api_url", "agent_base_prompt"]);

        const config = configData?.reduce((acc: any, row: any) => ({ ...acc, [row.key]: row.value }), {}) || {};

        // System Prompt assembly
        let systemPrompt = config.agent_base_prompt || "You are a helpful AI assistant.";

        if (projectId) {
            const { data: project } = await supabase.from("projects").select("system_prompt").eq("id", projectId).single();
            if (project?.system_prompt) systemPrompt += `\n\n${project.system_prompt}`;

            // Add Memories
            const { data: memories } = await supabase
                .from("project_memories")
                .select("memory_type, content, importance")
                .eq("project_id", projectId)
                .order("importance", { ascending: false })
                .limit(10);

            if (memories?.length) {
                systemPrompt += `\n\n## Project Context:\n${memories.map(m => `- [${m.memory_type}] ${m.content}`).join('\n')}`;
            }
        }

        // 7. Forward to Agent Server
        const agentApiUrl = config.agent_api_url || "https://agent-salesforce-link.replit.app/api/chat/";

        console.log(`[Proxy] Forwarding to ${agentApiUrl}`);
        const response = await fetch(agentApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [...(previousMessages || []), { role: "user", content }],
                system_prompt: systemPrompt,
                model: model || "anthropic:claude-opus-4-6",
                stream: true,
                chat_id: chatId,
                api_keys: {
                    openai_api_key: config.openai_api_key,
                    google_api_key: config.google_api_key,
                    anthropic_api_key: config.anthropic_api_key
                }
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Agent Server Error: ${response.status} ${text}`);
        }

        return new NextResponse(response.body, {
            headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
        });

    } catch (error: any) {
        console.error("[Proxy] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
