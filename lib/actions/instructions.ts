"use server";

import { createClient } from "@/lib/supabase/server";

export async function extractBehavioralInstructions(chatId: string) {
    const supabase = await createClient();

    // Get user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: "Unauthorized" };
    }

    // Get chat messages and project_id in one go
    const { data: chatData, error: chatError } = await supabase
        .from("chats")
        .select("project_id, chat_messages(role, content)")
        .eq("id", chatId)
        .order("created_at", { foreignTable: "chat_messages", ascending: true })
        .single();

    if (chatError) {
        console.error("[Instructions] Error fetching chat data:", chatError);
        return { success: false, error: chatError.message };
    }

    const messages = chatData?.chat_messages as any[];
    const projectId = chatData?.project_id;

    if (!messages || messages.length === 0) {
        console.warn("[Instructions] No messages found for chat", chatId);
        return { success: false, error: "No messages found" };
    }

    console.log(`[Instructions] Found ${messages.length} total raw messages`);

    // Filter out noisy status/processing messages to give the AI a cleaner conversation
    const filteredMessages = (messages as any[]).filter(m => {
        // Skip purely status messages or short processing updates that don't contain real info
        if (m.content === "processing" || m.content === "Thinking...") return false;
        if (m.type === "status") return false;
        return true;
    });

    console.log(`[Instructions] Filtered down to ${filteredMessages.length} meaningful messages`);

    // Construct conversation for analysis
    const conversation = filteredMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

    // Fetch custom prompts from config
    const { data: configPrompts } = await supabase
        .from("app_config")
        .select("key, value")
        .in("key", ["instruction_extraction_system_prompt", "instruction_extraction_analysis_prompt"]);

    const dbSystemPrompt = configPrompts?.find(p => p.key === "instruction_extraction_system_prompt")?.value;
    const dbAnalysisPrompt = configPrompts?.find(p => p.key === "instruction_extraction_analysis_prompt")?.value;

    const finalSystemPrompt = dbSystemPrompt || "You are an expert Behavior Analyst for AI agents. You excel at spotting user preferences and AI behavioral mistakes even when they aren't explicitly stated as 'rules'.";

    // Construct analysis prompt using DB template or fallback
    let finalAnalysisPrompt = "";
    if (dbAnalysisPrompt) {
        finalAnalysisPrompt = dbAnalysisPrompt.replace("{{CONVERSATION}}", conversation);
    } else {
        finalAnalysisPrompt = `Analyze the following conversation history.\n...\nConversation History:\n---\n${conversation}\n---\n...`;
    }

    try {
        console.log("[Instructions] Sending cleaned conversation to AI analyzer...");
        const payload = {
            messages: [{ role: "user", content: finalAnalysisPrompt }],
            system_prompt: finalSystemPrompt,
            model: "openai:gpt-4o",
            structured_output_format: {
                type: "object",
                properties: {
                    instructions: {
                        type: "array",
                        items: { type: "string" }
                    }
                },
                required: ["instructions"]
            }
        };

        const response = await fetch("http://13.201.66.23:8000/api/chat/structured", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("[Instructions] AI API failed:", response.status, errorText);
            return { success: false, error: `AI API Error: ${response.status}` };
        }

        const responseData = await response.json();
        console.log("[Instructions] AI Decision Data:", JSON.stringify(responseData, null, 2));

        // The API returns the structured output inside a 'data' field
        const instructions: string[] = responseData.data?.instructions || responseData.instructions || [];
        console.log(`[Instructions] Extracted ${instructions.length} instructions:`, instructions);

        if (instructions.length === 0) {
            return { success: true, count: 0 };
        }

        // Store instructions in database
        const instructionsToInsert = instructions.map(inst => ({
            user_id: user.id,
            source_chat_id: chatId,
            project_id: projectId,
            instruction: inst,
            is_active: true
        }));

        const { error } = await supabase
            .from("agent_instructions")
            .insert(instructionsToInsert);

        if (error) {
            console.error("Error storing instructions:", error);
            return { success: false, error: error.message };
        }

        return { success: true, count: instructions.length };

    } catch (error: any) {
        console.error("Instruction extraction error:", error);
        return { success: false, error: error.message };
    }
}

export async function getUserInstructions() {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: instructions } = await supabase
        .from("agent_instructions")
        .select("instruction")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

    return instructions || [];
}
