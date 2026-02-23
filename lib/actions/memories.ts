"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

interface Memory {
    memory_type: 'insight' | 'preference' | 'issue' | 'solution' | 'feedback';
    content: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    importance: number;
}

export async function extractChatMemories(projectId: string, chatId: string) {
    const supabase = await createClient();

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

    // Call AI to extract memories
    const analysisPrompt = `Analyze this conversation and extract key memories that should be remembered for future chats in this project.

Extract:
1. **Insights**: Important discoveries or learnings
2. **Preferences**: User's stated preferences or requirements
3. **Issues**: Problems or challenges mentioned
4. **Solutions**: Solutions or approaches that worked
5. **Feedback**: User feedback on responses or suggestions

For each memory, provide:
- memory_type: one of [insight, preference, issue, solution, feedback]
- content: A clear, concise description (1-2 sentences)
- sentiment: positive, negative, or neutral
- importance: 1-10 (how important to remember)

Only extract memories that would be useful context for future conversations.

Conversation:
${conversation}

Return a JSON array of memories.`;

    try {
        const response = await fetch("http://13.201.66.23:8000/api/chat/structured", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [{ role: "user", content: analysisPrompt }],
                system_prompt: "You are a memory extraction assistant. Extract key insights from conversations.",
                model: "openai:gpt-5",
                structured_output_format: {
                    type: "object",
                    properties: {
                        memories: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    memory_type: { type: "string", enum: ["insight", "preference", "issue", "solution", "feedback"] },
                                    content: { type: "string" },
                                    sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
                                    importance: { type: "number", minimum: 1, maximum: 10 }
                                },
                                required: ["memory_type", "content", "sentiment", "importance"]
                            }
                        }
                    },
                    required: ["memories"]
                }
            })
        });

        const data = await response.json();
        const memories: Memory[] = data.memories || [];

        // Store memories in database
        const memoriesToInsert = memories.map(m => ({
            project_id: projectId,
            source_chat_id: chatId,
            ...m
        }));

        const { error } = await supabase
            .from("project_memories")
            .insert(memoriesToInsert);

        if (error) {
            console.error("Error storing memories:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true, count: memories.length };

    } catch (error: any) {
        console.error("Memory extraction error:", error);
        return { success: false, error: error.message };
    }
}

export async function getProjectMemories(projectId: string, limit: number = 10) {
    const supabase = await createClient();

    const { data: memories } = await supabase
        .from("project_memories")
        .select("*")
        .eq("project_id", projectId)
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);

    return memories || [];
}

export async function deleteMemory(memoryId: string) {
    const supabase = await createClient();

    // Try deleting from project_memories first
    const { error: memoryError } = await supabase
        .from("project_memories")
        .delete()
        .eq("id", memoryId);

    // Also try deleting from agent_instructions (one will succeed, the other will just do nothing)
    const { error: instructionError } = await supabase
        .from("agent_instructions")
        .delete()
        .eq("id", memoryId);

    if (memoryError && instructionError) {
        console.error("Delete memory error:", { memoryError, instructionError });
        return { success: false, error: "Failed to delete from both tables" };
    }

    return { success: true };
}
