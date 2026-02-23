"use server";

import { createClient } from "@/lib/supabase/server";

export async function extractBehavioralInstructions(chatId: string) {
    const supabase = await createClient();

    // Get user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, error: "Unauthorized" };
    }

    console.log(`[Instructions] Extracting from chat: ${chatId}`);

    // Get chat messages
    const { data: messages, error: messagesError } = await supabase
        .from("chat_messages")
        .select("role, content")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

    if (messagesError) {
        console.error("[Instructions] Error fetching messages:", messagesError);
        return { success: false, error: messagesError.message };
    }

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

    // Call AI to extract instructions
    const analysisPrompt = `Analyze the following conversation history.
Your task is to identify specific behavioral rules, preferences, or corrections that the AI should remember for future interactions with this user.

BE THOROUGH. Look for:
- Direct corrections (e.g., "Don't do X", "Use Y instead").
- Subtle preferences (e.g., User seems to prefer technical details, or wants faster summaries).
- AI Failure points: Did the AI use a tool incorrectly? Did it miss a requirement?
- Tone adjustments: Should the AI be more formal, more concise, or more proactive?

INSTRUCTIONS FORMAT:
- Each instruction must be a standalone "Rule of Thumb".
- Format: "Always [do X]" or "Never [do Y]" or "When [scenario], ensure [Z]".

Conversation History:
---
${conversation}
---

If you find even minor behavioral patterns or opportunities for improvement, extract them.
Return a JSON object with an "instructions" array. If absolutely nothing is found, return an empty array.`;

    try {
        console.log("[Instructions] Sending cleaned conversation to AI analyzer...");
        const payload = {
            messages: [{ role: "user", content: analysisPrompt }],
            system_prompt: "You are an expert Behavior Analyst for AI agents. You excel at spotting user preferences and AI behavioral mistakes even when they aren't explicitly stated as 'rules'.",
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
