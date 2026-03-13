import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared workflow execution engine.
 * Used by both the manual SSE run route and the scheduled cron route.
 */

export function topologicalSort(nodes: any[], edges: any[]) {
    const adjList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    nodes.forEach((n) => {
        adjList.set(n.id, []);
        inDegree.set(n.id, 0);
    });

    edges.forEach((e) => {
        if (adjList.has(e.source) && inDegree.has(e.target)) {
            adjList.get(e.source)!.push(e.target);
            inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
        }
    });

    const queue: string[] = [];
    inDegree.forEach((deg, id) => {
        if (deg === 0) queue.push(id);
    });

    const sorted: string[] = [];
    while (queue.length > 0) {
        const current = queue.shift()!;
        sorted.push(current);
        for (const neighbor of adjList.get(current) || []) {
            inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1);
            if (inDegree.get(neighbor) === 0) {
                queue.push(neighbor);
            }
        }
    }

    if (sorted.length !== nodes.length) {
        throw new Error("Cycle detected in workflow graph");
    }

    return sorted;
}

export function parseWorkflowOutput(rawOutput: string): {
    structured: Record<string, any> | null;
    text: string;
} {
    const markerStart = "<!-- workflow_output -->";
    const markerEnd = "<!-- /workflow_output -->";

    const startIdx = rawOutput.indexOf(markerStart);
    const endIdx = rawOutput.indexOf(markerEnd);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        let jsonStr = rawOutput.slice(startIdx + markerStart.length, endIdx).trim();
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
        try {
            const structured = JSON.parse(jsonStr);
            const textBefore = rawOutput.slice(0, startIdx).trim();
            const textAfter = rawOutput.slice(endIdx + markerEnd.length).trim();
            const text = [textBefore, textAfter].filter(Boolean).join("\n\n");
            return { structured, text: text || rawOutput };
        } catch {
            // JSON parse failed
        }
    }

    return { structured: null, text: rawOutput };
}

export function buildNodePrompt(
    previousOutput: { structured: Record<string, any> | null; text: string } | null,
    nodeLabel: string,
    isFirstProjectNode: boolean = false
): string {
    if (!previousOutput) {
        return "Execute this workflow step";
    }

    let prompt = `IMPORTANT: You are running inside an automated workflow pipeline. Execute your task FULLY and AUTONOMOUSLY. Do NOT ask clarifying questions — do NOT present options or menus. Do NOT wait for user input. Execute end-to-end deterministically based on the data provided below.

CRITICAL CONTEXT: You are a FRESH node in a pipeline. You have your OWN independent tool budget and execution context. Any tool call counts, budgets, or limitations mentioned in the previous node's output DO NOT apply to you — those were the previous node's constraints. You start with a full, fresh budget. Process the DATA from the previous node (contacts, account info, etc.) but ignore its execution metadata (tool counts, phase tracking, etc.).\n\n`;

    if (previousOutput.structured) {
        prompt += `--- PREVIOUS NODE OUTPUT (STRUCTURED DATA) ---\n`;
        prompt += JSON.stringify(previousOutput.structured, null, 2);
        prompt += `\n--- END PREVIOUS NODE OUTPUT ---\n\n`;
    }

    if (previousOutput.text) {
        if (isFirstProjectNode) {
            prompt += `--- USER REQUEST ---\n`;
            prompt += previousOutput.text;
            prompt += `\n--- END USER REQUEST ---\n\n`;
            prompt += `Execute the above request using your system instructions. This is a workflow — proceed through ALL phases without stopping for confirmation.\n\n`;
        } else {
            prompt += `--- PREVIOUS NODE OUTPUT ---\n`;
            prompt += previousOutput.text;
            prompt += `\n--- END PREVIOUS NODE OUTPUT ---\n\n`;
        }
    }

    prompt += `You are executing workflow step: "${nodeLabel}". `;
    prompt += `Execute your full task based on your system instructions and the data above. `;
    prompt += `MANDATORY: At the END of your response, include a structured JSON data block wrapped in <!-- workflow_output --> and <!-- /workflow_output --> markers. This is required for the next node in the pipeline to receive your output. Follow the WORKFLOW OUTPUT FORMAT section in your system instructions for the exact schema.`;

    return prompt;
}

export function generateAISummary(text: string, structured: any): string {
    if (!text && !structured) return "";

    if (text) {
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
            if (line.startsWith("#") || line.startsWith("```") || line.startsWith("<!--") || line.startsWith("{") || line.startsWith("[")) continue;
            if (line.length < 20) continue;
            if (/^(tool|phase|step|note|warning|error|---)/i.test(line)) continue;
            return line.length > 300 ? line.slice(0, 297) + "..." : line;
        }
    }

    if (structured) {
        const keys = Object.keys(structured);
        if (structured.contacts || structured.top_contacts || structured.leads) {
            const arr = structured.contacts || structured.top_contacts || structured.leads;
            if (Array.isArray(arr)) return `Produced ${arr.length} contact${arr.length !== 1 ? "s" : ""} with structured data.`;
        }
        if (structured.outreach_sequences && Array.isArray(structured.outreach_sequences)) {
            return `Generated outreach sequences for ${structured.outreach_sequences.length} contact${structured.outreach_sequences.length !== 1 ? "s" : ""}.`;
        }
        return `Produced structured output with ${keys.length} data field${keys.length !== 1 ? "s" : ""}.`;
    }

    return "";
}

export async function readChatStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return "";

    const decoder = new TextDecoder();
    let fullResponse = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullResponse += decoder.decode(value);
    }

    let parsedOutput = "";
    const lines = fullResponse.split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
            try {
                const parsed = JSON.parse(trimmed.slice(6));
                if (parsed.type === "final" && parsed.content) {
                    parsedOutput = parsed.content;
                } else if (parsed.type === "chunk" && parsed.content) {
                    parsedOutput += parsed.content;
                }
            } catch {
                // skip non-JSON lines
            }
        }
    }

    return parsedOutput || fullResponse;
}

export interface NodeOutput {
    structured: Record<string, any> | null;
    text: string;
    raw: string;
}

/**
 * Execute a workflow without SSE streaming (fire-and-forget).
 * Used by scheduled runs.
 */
export async function executeWorkflowHeadless(params: {
    workflowId: string;
    nodes: any[];
    edges: any[];
    triggerInput: string;
    baseUrl: string;
    cookieHeader: string;
    supabase: SupabaseClient;
    triggeredBy?: string;
}): Promise<{ executionId: string; status: string; error?: string }> {
    const { workflowId, nodes, edges, triggerInput, baseUrl, cookieHeader, supabase, triggeredBy = "schedule" } = params;

    // Get workspace
    const { data: workflow } = await supabase
        .from("workflows")
        .select("workspace_id")
        .eq("id", workflowId)
        .single();

    if (!workflow) throw new Error("Workflow not found");

    // Create execution record
    const { data: execution } = await supabase
        .from("workflow_executions")
        .insert({
            workflow_id: workflowId,
            workspace_id: workflow.workspace_id,
            status: "running",
            input: { nodes: nodes.length, edges: edges.length, triggerInput },
            node_outputs: {},
            triggered_by: triggeredBy,
        })
        .select("id")
        .single();

    if (!execution) throw new Error("Failed to create execution record");

    const nodeOutputs: Record<string, NodeOutput> = {};

    try {
        const sortedIds = topologicalSort(nodes, edges);
        const nodeMap = new Map<string, any>(nodes.map((n: any) => [n.id, n]));

        const parentMap = new Map<string, string[]>();
        edges.forEach((e: any) => {
            if (!parentMap.has(e.target)) parentMap.set(e.target, []);
            parentMap.get(e.target)!.push(e.source);
        });

        for (const nodeId of sortedIds) {
            const node = nodeMap.get(nodeId) as any;
            if (!node) continue;

            const label = node.data?.label || node.data?.projectName || nodeId;

            if (node.type === "trigger") {
                const triggerOutput = triggerInput || "Workflow triggered";
                nodeOutputs[nodeId] = { structured: null, text: triggerOutput, raw: triggerOutput };
                continue;
            }

            if (node.type === "project" && node.data?.projectId) {
                const parentIds = parentMap.get(nodeId) || [];
                let previousOutput: { structured: Record<string, any> | null; text: string } | null = null;

                if (parentIds.length === 1) {
                    previousOutput = nodeOutputs[parentIds[0]] || null;
                } else if (parentIds.length > 1) {
                    const mergedStructured: Record<string, any> = {};
                    const mergedTexts: string[] = [];
                    for (const pid of parentIds) {
                        const po = nodeOutputs[pid];
                        if (po?.structured) mergedStructured[pid] = po.structured;
                        if (po?.text) {
                            const parentLabel = nodeMap.get(pid)?.data?.label || pid;
                            mergedTexts.push(`[From: ${parentLabel}]\n${po.text}`);
                        }
                    }
                    previousOutput = {
                        structured: Object.keys(mergedStructured).length > 0 ? mergedStructured : null,
                        text: mergedTexts.join("\n\n"),
                    };
                }

                const isFirstProject = parentIds.some(pid => nodeMap.get(pid)?.type === "trigger");
                const prompt = buildNodePrompt(previousOutput, label, isFirstProject);

                const chatId = crypto.randomUUID();
                const chatResponse = await fetch(
                    `${baseUrl}/api/chat`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Cookie: cookieHeader,
                        },
                        body: JSON.stringify({
                            projectId: node.data.projectId,
                            chatId,
                            content: prompt,
                            previousMessages: [],
                            model: node.data.model || "anthropic:claude-haiku-4-5",
                        }),
                    }
                );

                if (!chatResponse.ok) {
                    throw new Error(`Chat API returned ${chatResponse.status} for node "${label}"`);
                }

                const rawOutput = await readChatStream(chatResponse);
                const parsed = parseWorkflowOutput(rawOutput);

                nodeOutputs[nodeId] = {
                    structured: parsed.structured,
                    text: parsed.text,
                    raw: rawOutput,
                };

                // Update node_outputs incrementally
                await supabase
                    .from("workflow_executions")
                    .update({ node_outputs: nodeOutputs })
                    .eq("id", execution.id);
            }
        }

        // Mark completed
        const lastNodeId = sortedIds[sortedIds.length - 1];
        const lastOutput = nodeOutputs[lastNodeId];

        await supabase
            .from("workflow_executions")
            .update({
                status: "completed",
                output: {
                    result: lastOutput?.text?.slice(0, 1000) || "Completed",
                    structured: lastOutput?.structured || null,
                },
                node_outputs: nodeOutputs,
                finished_at: new Date().toISOString(),
            })
            .eq("id", execution.id);

        return { executionId: execution.id, status: "completed" };
    } catch (error: any) {
        await supabase
            .from("workflow_executions")
            .update({
                status: "failed",
                error: error.message,
                node_outputs: nodeOutputs,
                finished_at: new Date().toISOString(),
            })
            .eq("id", execution.id);

        return { executionId: execution.id, status: "failed", error: error.message };
    }
}
