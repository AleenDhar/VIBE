
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

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


    try {
        const { projectId, chatId: rawChatId, content, previousMessages, model } = await req.json();

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

        console.log(`[API] Processing Chat: ${chatId} (Original: ${rawChatId}), Project: ${projectId}, Model: ${model}`);

        if (!chatId || !content) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // 0. Ensure Chat Exists
        // If we synthesized a UUID, the chat row might not exist yet.
        const { data: existingChat } = await supabase
            .from("chats")
            .select("id")
            .eq("id", chatId)
            .single();

        if (!existingChat) {
            console.log(`[API] Creating new chat session for ID: ${chatId}`);
            const { error: createError } = await supabase.from("chats").insert({
                id: chatId,
                user_id: user.id,
                title: content.slice(0, 50) + (content.length > 50 ? "..." : ""),
                project_id: projectId || null // Optional: link to project if provided
            });

            if (createError) {
                console.error("Failed to create chat session:", createError);
                // If it failed, it might be a race condition (created parallel), try to proceed
            }
        }

        // 1. Save User Message
        const { error: insertError } = await supabase.from("chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: content
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

        let systemPrompt = basePrompt;

        // 3. Get Project System Prompt & Memories (only if chat belongs to a project)
        if (projectId) {
            const { data: project } = await supabase
                .from("projects")
                .select("system_prompt")
                .eq("id", projectId)
                .single();
            systemPrompt = `${basePrompt}\n\n${project?.system_prompt || ""}`;

            // 4. Get Project Memories
            const { data: memories } = await supabase
                .from("project_memories")
                .select("memory_type, content, sentiment, importance")
                .eq("project_id", projectId)
                .order("importance", { ascending: false })
                .limit(10);

            if (memories && memories.length > 0) {
                const memoryContext = memories.map(m =>
                    `[${m.memory_type.toUpperCase()}] ${m.content} (Importance: ${m.importance}/10)`
                ).join("\n");
                systemPrompt += `\n\n## Project Memory Context\nThe following are important insights and context from previous conversations in this project:\n\n${memoryContext}\n\nUse this context to provide more relevant and personalized responses.`;
            }
        }

        // 5. Get API Keys & Agent URL
        const { data: configData } = await supabase
            .from("app_config")
            .select("key, value")
            .in("key", ["openai_api_key", "google_api_key", "anthropic_api_key", "agent_api_url"]);

        const apiKeys: Record<string, string> = {};
        let agentApiUrl = process.env.AGENT_API_URL || "https://agent-salesforce-link.replit.app/api/chat/";

        if (configData) {
            configData.forEach((row: any) => {
                if (row.key === "agent_api_url" && row.value) {
                    agentApiUrl = row.value;
                } else if (row.value) {
                    apiKeys[row.key] = row.value;
                }
            });
        }

        // 6. Build Payload
        const messagesPayload = previousMessages ? previousMessages.map((m: any) => ({
            role: m.role,
            content: m.content
        })) : [];
        messagesPayload.push({ role: "user", content });

        const payload = {
            messages: messagesPayload,
            system_prompt: systemPrompt,
            model: model || "anthropic:claude-opus-4-6", // User preference from chat.ts
            stream: true,
            chat_id: chatId, // Pass chat_id so server can log directly to DB
            api_keys: apiKeys
            // enable_research: true // Optional: could be passed from client if needed
        };

        // 6. Call Python Server (Async Mode)
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

        // Return the raw stream to keep the connection open
        return new NextResponse(response.body, {
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
