
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
        const { projectId, chatId, content, previousMessages, model } = await req.json();
        console.log(`[API] Received request for Chat: ${chatId}, Project: ${projectId}, Model: ${model}`);

        if (!chatId || !content) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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

        // 1.5. Rename Chat if First Message
        if (!previousMessages || previousMessages.length === 0) {
            const newTitle = content.slice(0, 50) + (content.length > 50 ? "..." : "");
            // Fire and forget update
            supabase.from("chats").update({ title: newTitle }).eq("id", chatId).then(({ error }) => {
                if (error) console.error("Failed to auto-rename chat:", error);
            });
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

        // 5. Get API Keys (if available)
        const { data: apiKeysData } = await supabase
            .from("app_config")
            .select("key, value")
            .in("key", ["openai_api_key", "google_api_key", "anthropic_api_key"]);

        const apiKeys: Record<string, string> = {};
        if (apiKeysData) {
            apiKeysData.forEach((row: any) => {
                if (row.value) apiKeys[row.key] = row.value;
            });
        }

        // 6. Build Payload
        const messagesPayload = previousMessages.map((m: any) => ({
            role: m.role,
            content: m.content
        }));
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
        // We now use the async endpoint which returns immediately and streams to Supabase
        const agentApiUrl = process.env.AGENT_API_URL || "https://agent-salesforce-link.replit.app/api/chat/";
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
