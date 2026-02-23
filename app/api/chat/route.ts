
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
        if (finalProjectId) {
            const { data: project } = await supabase
                .from("projects")
                .select("system_prompt")
                .eq("id", finalProjectId)
                .single();
            systemPrompt = `${basePrompt}\n\n${project?.system_prompt || ""}`;

            // 4. Get Project Memories
            const { data: memories } = await supabase
                .from("project_memories")
                .select("memory_type, content, sentiment, importance")
                .eq("project_id", finalProjectId)
                .order("importance", { ascending: false })
                .limit(10);

            if (memories && memories.length > 0) {
                const memoryContext = memories.map(m =>
                    `[${m.memory_type.toUpperCase()}] ${m.content} (Importance: ${m.importance}/10)`
                ).join("\n");
                systemPrompt += `\n\n## Project Memory Context\nThe following are important insights and context from previous conversations in this project:\n\n${memoryContext}\n\nUse this context to provide more relevant and personalized responses.`;
            }
            // 4b. Get Project Documents
            const { data: documents } = await supabase
                .from("documents")
                .select("name, content, file_path")
                .eq("project_id", finalProjectId);

            if (documents && documents.length > 0) {
                const docsContext = documents
                    .filter(d => d.content) // Only include docs with extracted content
                    .map(d => `--- File: ${d.name} ---\n${d.content}\n--- End of File: ${d.name} ---`)
                    .join("\n\n");

                if (docsContext) {
                    systemPrompt += `\n\n## Attached Project Files\nThe following files have been attached to this project. You have full access to their contents. Always refer to these contents if the user asks about them:\n\n${docsContext}`;
                } else {
                    const docNames = documents.map(d => d.name).join(", ");
                    systemPrompt += `\n\n## Attached Project Files\nThe following files are attached to this project but their text content could not be extracted: ${docNames}.`;
                }
            }
        }

        // Get Agent Behavioral Instructions (Global for the user)
        const { data: instructions } = await supabase
            .from("agent_instructions")
            .select("instruction")
            .eq("user_id", user.id)
            .eq("is_active", true)
            .order("created_at", { ascending: false });

        if (instructions && instructions.length > 0) {
            const instructionsContext = instructions.map(i => `- ${i.instruction}`).join("\n");
            systemPrompt += `\n\n## Behavioral Instructions\nThe following are specific instructions and behavioral rules you MUST follow in this conversation, based on previous interactions:\n${instructionsContext}`;
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
            content: m.content,
            ...(m.images && m.images.length > 0 ? { images: m.images } : {})
        })) : [];

        const currentUserMsg: any = { role: "user", content };
        if (images && images.length > 0) {
            currentUserMsg.images = images;
        }
        messagesPayload.push(currentUserMsg);

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
