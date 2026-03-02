import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { generateEmbeddings } from "@/lib/rag-utils";

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

// Helper: Map friendly model names to real provider IDs
function normalizeModel(model: string): string {
    if (!model) return "anthropic:claude-3-5-sonnet-latest";

    const mapping: Record<string, string> = {
        "claude-opus-4": "anthropic:claude-3-opus-20240229",
        "claude-sonnet-4": "anthropic:claude-3-5-sonnet-latest",
        "claude-sonnet-4-thinking": "anthropic:claude-3-5-sonnet-latest",
        "claude-3.5-haiku": "anthropic:claude-3-5-haiku-20241022",
        "gpt-4.1": "openai:gpt-4o",
        "gpt-4.1-mini": "openai:gpt-4o-mini",
        "gpt-4.1-nano": "openai:gpt-4o-mini",
        "o3": "openai:o3-mini",
        "o3-mini": "openai:o3-mini",
        "o4-mini": "openai:gpt-4o-mini",
        "gemini-2.5-pro": "google:gemini-1.5-pro",
        "gemini-2.5-flash": "google:gemini-1.5-flash",
        "gemini-2.0-flash": "google:gemini-2.0-flash",
    };

    if (mapping[model]) return mapping[model];
    if (model.includes(":")) return model;
    return `anthropic:${model}`;
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
        let { projectId, chatId, content, previousMessages, model, structured_output_format } = body;

        console.log(`[Proxy] Received: Chat=${chatId}, Project=${projectId}, Structured=${!!structured_output_format}`);

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

        // 4. Ensure Chat Session Exists & Handle Auto-Naming
        const { data: existingChat } = await supabase.from("chats").select("id, title").eq("id", chatId).maybeSingle();
        const generatedTitle = "\u200B" + (content.slice(0, 50) || "New Chat");

        if (!existingChat) {
            await supabase.from("chats").insert({
                id: chatId,
                user_id: user.id,
                title: generatedTitle,
                project_id: projectId || null
            });
        } else if (!existingChat.title || existingChat.title === "New Chat" || existingChat.title === "\u200BNew Chat") {
            await supabase.from("chats")
                .update({ title: generatedTitle })
                .eq("id", chatId);
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

            // 6.a-2 Add attached file names
            const { data: documents } = await supabase
                .from("documents")
                .select("name")
                .eq("project_id", projectId);

            if (documents?.length) {
                const fileList = documents.map(d => `- ${d.name}`).join('\n');
                systemPrompt += `\n\n## Attached Project Files:\nThe following files are attached to this project:\n${fileList}\n\nIMPORTANT: You have access to these files through the search_knowledge tool. If the user asks you to read, summarize, or reference any of these files, use the search_knowledge tool to retrieve their contents. Do NOT attempt to access files via local filesystem commands like ls, cat, or any shell tools — the files are stored in a remote database, not on your local filesystem.`;
            }

            // 6.b Add RAG (Document Search)
            try {
                const openaiKey = config.openai_api_key;
                if (openaiKey) {
                    const queryEmbedding = await generateEmbeddings([content], openaiKey);

                    if (queryEmbedding && queryEmbedding.length > 0) {
                        const { data: relevantChunks, error: rpcError } = await supabase.rpc(
                            "match_document_chunks",
                            {
                                query_embedding: queryEmbedding[0],
                                match_project_id: projectId,
                                match_threshold: 0.3,
                                match_count: 5
                            }
                        );

                        if (rpcError) throw rpcError;

                        if (relevantChunks && relevantChunks.length > 0) {
                            const docsContext = relevantChunks
                                .map((chunk: any) => `[Excerpt]:\n${chunk.content}`)
                                .join("\n\n---\n\n");

                            systemPrompt += `\n\n## Relevant Document Excerpts\nBased on the user's latest message, here are relevant excerpts from project files. Use these to answer accurately:\n\n${docsContext}`;
                        }
                    }
                }
            } catch (ragError) {
                console.error("[Proxy] RAG Document Search Failed:", ragError);
            }
        }

        // Add Global Agent Instructions for the user
        const { data: instructions } = await supabase
            .from("agent_instructions")
            .select("instruction")
            .eq("user_id", user.id)
            .eq("is_active", true)
            .order("created_at", { ascending: false });

        if (instructions && instructions.length > 0) {
            systemPrompt += `\n\n## Behavioral Instructions:\n${instructions.map(i => `- ${i.instruction}`).join('\n')}`;
        }

        // 7. Route & Payload Construction
        const baseUrl = config.agent_api_url || "https://agent-salesforce-link.replit.app/api/chat/";
        // If structured_output_format is present, use the structured endpoint
        const targetUrl = structured_output_format
            ? baseUrl.replace(/\/chat\/?$/, "/chat/structured")
            : baseUrl;

        console.log(`[Proxy] Forwarding to ${targetUrl}`);

        const payload: any = {
            messages: [...(previousMessages || []), { role: "user", content }],
            system_prompt: systemPrompt,
            model: normalizeModel(model),
            stream: !structured_output_format,
            chat_id: chatId,
            project_id: projectId,
            api_keys: {
                openai_api_key: config.openai_api_key,
                google_api_key: config.google_api_key,
                anthropic_api_key: config.anthropic_api_key
            }
        };

        if (structured_output_format) {
            payload.structured_output_format = structured_output_format;
        }

        const response = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Agent Server Error: ${response.status} ${text}`);
        }

        // 8. Handle Response (Stream or JSON)
        if (structured_output_format) {
            const result = await response.json();
            // Save the structured response to DB as well for history
            await supabase.from("chat_messages").insert({
                chat_id: chatId,
                role: "assistant",
                content: result.raw_response || JSON.stringify(result.data)
            });
            return NextResponse.json(result);
        } else {
            // Streaming response
            return new NextResponse(response.body, {
                headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
            });
        }

    } catch (error: any) {
        console.error("[Proxy] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
