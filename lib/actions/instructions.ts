"use server";

import { createClient } from "@/lib/supabase/server";

export async function extractBehavioralInstructions(chatId: string) {
    const supabase = await createClient();

    // Get user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: "Unauthorized" };
    }

    // Get chat messages
    const { data: messages } = await supabase
        .from("chat_messages")
        .select("role, content")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

    if (!messages || messages.length === 0) {
        return { success: false, error: "No messages found" };
    }

    // Construct conversation for analysis
    const conversation = (messages as any[]).map(m => `${m.role}: ${m.content}`).join("\n\n");

    // Call AI to extract instructions
    const analysisPrompt = `Analyze this conversation between a user and an AI assistant.
Focus on areas where the assistant's response was not good, misunderstood the user, or required correction by the user.
If you find such instances, create short, clear behavioral instructions for the assistant to follow in the future to avoid these mistakes.
For example, "Always respond with code snippets when asked for examples" or "Never use overly formal language".

Only extract instructions if the assistant made a mistake or the user implicitly/explicitly corrected the assistant.

Conversation:
${conversation}

Return a JSON array of instructions (each instruction as a string).`;

    try {
        const response = await fetch("http://13.201.66.23:8000/api/chat/structured", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "user", content: analysisPrompt }],
                system_prompt: "You are an AI behavior reviewer. Extract behavioral rules based on AI mistakes in the conversation.",
                model: "openai:gpt-4o", // using gpt-4o or gpt-4 for better reasoning
                structured_output_format: {
                    type: "object",
                    properties: {
                        instructions: {
                            type: "array",
                            items: {
                                type: "string"
                            }
                        }
                    },
                    required: ["instructions"]
                }
            })
        });

        const data = await response.json();
        const instructions: string[] = data.instructions || [];

        if (instructions.length === 0) {
            return { success: true, count: 0 };
        }

        // Store instructions in database
        const instructionsToInsert = instructions.map(inst => ({
            user_id: user.id,
            source_chat_id: chatId,
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
