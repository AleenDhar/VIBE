"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createNewChat(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    const { data, error } = await supabase
        .from("chats")
        .insert({
            project_id: projectId,
            title: "New Chat",
            user_id: user.id
        })
        .select()
        .single();

    if (error) {
        console.error("Create Chat Error:", error);
        return { error: error.message };
    }

    return { id: data.id };
}

export async function createStandaloneChat() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: "Unauthorized" };
    }

    const { data, error } = await supabase
        .from("chats")
        .insert({
            project_id: null,
            title: "New Chat",
            user_id: user.id
        })
        .select()
        .single();

    if (error) {
        console.error("Create Standalone Chat Error:", error);
        return { error: error.message };
    }

    return { id: data.id };
}

export async function sendMessage(projectId: string | null, chatId: string, content: string, previousMessages: any[]) {
    const supabase = await createClient();

    // Save user message
    await supabase.from("chat_messages").insert({
        chat_id: chatId,
        role: "user",
        content: content
    });

    // Get Global Base Prompt
    const { data: basePromptData } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "agent_base_prompt")
        .single();

    const basePrompt = basePromptData?.value || "You are a helpful AI assistant.";

    let systemPrompt = basePrompt;

    // Only fetch project-specific context if chat belongs to a project
    if (projectId) {
        // Get Project System Prompt
        const { data: project } = await supabase
            .from("projects")
            .select("system_prompt")
            .eq("id", projectId)
            .single();

        systemPrompt = `${basePrompt}\n\n${project?.system_prompt || ""}`;

        // Get project memories for context
        const { data: memories } = await supabase
            .from("project_memories")
            .select("memory_type, content, sentiment, importance")
            .eq("project_id", projectId)
            .order("importance", { ascending: false })
            .limit(10);

        // Add memories to system prompt if they exist
        if (memories && memories.length > 0) {
            const memoryContext = memories.map(m =>
                `[${m.memory_type.toUpperCase()}] ${m.content} (Importance: ${m.importance}/10)`
            ).join("\n");

            systemPrompt += `\n\n## Project Memory Context\nThe following are important insights and context from previous conversations in this project:\n\n${memoryContext}\n\nUse this context to provide more relevant and personalized responses.`;
        }
    }

    // Construct Payload
    const messagesPayload = previousMessages.map(m => ({
        role: m.role,
        content: m.content
    }));
    messagesPayload.push({ role: "user", content });

    const payload = {
        messages: messagesPayload,
        system_prompt: systemPrompt,
        model: "openai:gpt-5",
        structured_output_format: {
            type: "object",
            properties: {
                output: { type: "string" }
            },
            required: ["output"]
        }
    };

    try {
        const response = await fetch("http://13.201.66.23:8000/api/chat/structured", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        console.log("Raw API Response:", responseText);

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} - ${responseText}`);
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error("JSON Parse Error:", e);
            // Fallback: If not JSON, maybe it's just text
            data = { output: responseText };
        }

        // Handle n8n array response. It can be [ { output: "..." } ]
        if (Array.isArray(data)) {
            data = data[0];
        }

        // Handle nested 'data' object wrapper
        if (data?.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
            data = data.data;
        }

        let output = data?.output || data?.message || data?.content;

        if (!output) {
            console.error("Missing output in data:", data);
            // Fallback: dump the entire parsed data for debugging
            output = `Debug: Could not find 'output' field. Raw: ${JSON.stringify(data)}`;
        }

        // Save Assistant Message
        await supabase.from("chat_messages").insert({
            chat_id: chatId,
            role: "assistant",
            content: output
        });

        if (projectId) {
            revalidatePath(`/projects/${projectId}`);
        }
        revalidatePath(`/chat/${chatId}`);
        return { success: true, message: output };

    } catch (err: any) {
        console.error("SendMessage Error:", err);
        return { error: err.message };
    }
}
