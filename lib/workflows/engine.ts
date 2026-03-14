import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared workflow execution engine.
 * Used by both the manual SSE run route and the scheduled cron route.
 * Supports: trigger, project, and loop nodes.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NodeOutput {
    structured: Record<string, any> | null;
    text: string;
    raw: string;
}

export interface LoopContext {
    item: any;
    index: number;
    total: number;
    arrayField: string;
}

export interface ExecutionContext {
    nodeMap: Map<string, any>;
    edges: any[];
    parentMap: Map<string, string[]>;
    childMap: Map<string, { target: string; sourceHandle?: string }[]>;
    nodeOutputs: Record<string, NodeOutput>;
    baseUrl: string;
    cookieHeader: string;
    send?: (data: any) => void; // SSE send function (null for headless)
    supabase?: SupabaseClient;
    executionId?: string;
    loopContext?: LoopContext;
}

// ─── Topological Sort ────────────────────────────────────────────────────────

/**
 * Topological sort that EXCLUDES loop body nodes from the main sort.
 * Body nodes (reachable via sourceHandle="body") are handled recursively by the loop executor.
 */
export function topologicalSort(nodes: any[], edges: any[]): string[] {
    // Find all body-connected node IDs (they should not be in the main sort)
    const bodyNodeIds = new Set<string>();
    collectAllBodyNodes(nodes, edges, bodyNodeIds);

    // Only sort top-level nodes (not inside loop bodies)
    const topLevelNodes = nodes.filter((n) => !bodyNodeIds.has(n.id));
    // Only use edges that connect top-level nodes (and exclude body edges)
    const topLevelEdges = edges.filter(
        (e) => !bodyNodeIds.has(e.target) && e.sourceHandle !== "body"
    );

    return topoSort(topLevelNodes, topLevelEdges);
}

/**
 * Recursively collect all node IDs reachable from loop body handles.
 */
function collectAllBodyNodes(nodes: any[], edges: any[], collected: Set<string>) {
    const nodeSet = new Set(nodes.map((n) => n.id));

    // Find body edges from loop nodes
    const bodyEdges = edges.filter(
        (e) => e.sourceHandle === "body" && nodeSet.has(e.target)
    );

    for (const edge of bodyEdges) {
        collectReachable(edge.target, edges, nodeSet, collected);
    }
}

/**
 * BFS to collect all nodes reachable from a starting node, following all edges
 * EXCEPT exit edges from loop nodes that are ancestors.
 */
function collectReachable(
    startId: string,
    edges: any[],
    validNodes: Set<string>,
    collected: Set<string>
) {
    const queue = [startId];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (collected.has(current)) continue;
        collected.add(current);

        // Follow all outgoing edges from this node
        for (const edge of edges) {
            if (edge.source === current && validNodes.has(edge.target) && !collected.has(edge.target)) {
                // Don't follow exit edges out of the loop body
                // (exit edges go to nodes outside the body)
                queue.push(edge.target);
            }
        }
    }
}

/**
 * Basic topological sort (no loop awareness).
 */
function topoSort(nodes: any[], edges: any[]): string[] {
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

// ─── Loop Helpers ────────────────────────────────────────────────────────────

/**
 * Get the body sub-graph node IDs for a loop node, topologically sorted.
 * Body nodes are those reachable from edges with sourceHandle="body".
 */
export function getBodyNodeIds(loopNodeId: string, edges: any[], allNodes: any[]): string[] {
    const bodyEdges = edges.filter(
        (e) => e.source === loopNodeId && e.sourceHandle === "body"
    );
    if (bodyEdges.length === 0) return [];

    const allNodeIds = new Set(allNodes.map((n) => n.id));
    const bodyIds = new Set<string>();

    // BFS from body edge targets
    const queue = bodyEdges.map((e) => e.target);
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (bodyIds.has(current) || !allNodeIds.has(current)) continue;
        bodyIds.add(current);

        // Follow outgoing edges (but not exit edges from nested loops going outside)
        for (const edge of edges) {
            if (edge.source === current && allNodeIds.has(edge.target) && !bodyIds.has(edge.target)) {
                queue.push(edge.target);
            }
        }
    }

    // Topologically sort body nodes
    const bodyNodes = allNodes.filter((n) => bodyIds.has(n.id));
    const bodyEdgesOnly = edges.filter(
        (e) => bodyIds.has(e.source) && bodyIds.has(e.target)
    );
    // Also include the initial body edges as virtual edges from loop node
    // But for sorting we only need edges within body nodes
    // Body entry nodes have in-degree 0 within the body

    return topoSort(bodyNodes, bodyEdgesOnly);
}

/**
 * Get the exit node IDs for a loop node (connected via sourceHandle="exit").
 */
export function getExitNodeIds(loopNodeId: string, edges: any[]): string[] {
    return edges
        .filter((e) => e.source === loopNodeId && e.sourceHandle === "exit")
        .map((e) => e.target);
}

/**
 * Resolve a dot-path on an object. e.g. getByPath(obj, "data.account_ids")
 */
function getByPath(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;
    for (const part of parts) {
        if (current == null) return undefined;
        current = current[part];
    }
    return current;
}

// ─── Output Parsing ──────────────────────────────────────────────────────────

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

// ─── Prompt Building ─────────────────────────────────────────────────────────

export function buildNodePrompt(
    previousOutput: { structured: Record<string, any> | null; text: string } | null,
    nodeLabel: string,
    isFirstProjectNode: boolean = false,
    loopContext?: LoopContext
): string {
    if (!previousOutput && !loopContext) {
        return "Execute this workflow step";
    }

    let prompt = `IMPORTANT: You are running inside an automated workflow pipeline. Execute your task FULLY and AUTONOMOUSLY. Do NOT ask clarifying questions — do NOT present options or menus. Do NOT wait for user input. Execute end-to-end deterministically based on the data provided below.

CRITICAL CONTEXT: You are a FRESH node in a pipeline. You have your OWN independent tool budget and execution context. Any tool call counts, budgets, or limitations mentioned in the previous node's output DO NOT apply to you — those were the previous node's constraints. You start with a full, fresh budget. Process the DATA from the previous node (contacts, account info, etc.) but ignore its execution metadata (tool counts, phase tracking, etc.).\n\n`;

    // Loop context injection
    if (loopContext) {
        prompt += `--- LOOP CONTEXT ---\n`;
        prompt += `You are processing item ${loopContext.index + 1} of ${loopContext.total} in a loop.\n`;
        prompt += `Current item data:\n`;
        prompt += JSON.stringify(loopContext.item, null, 2);
        prompt += `\n--- END LOOP CONTEXT ---\n\n`;
    }

    if (previousOutput?.structured) {
        prompt += `--- PREVIOUS NODE OUTPUT (STRUCTURED DATA) ---\n`;
        prompt += JSON.stringify(previousOutput.structured, null, 2);
        prompt += `\n--- END PREVIOUS NODE OUTPUT ---\n\n`;
    }

    if (previousOutput?.text) {
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

// ─── AI Summary ──────────────────────────────────────────────────────────────

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

// ─── Stream Reading ──────────────────────────────────────────────────────────

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

// ─── Recursive Sub-Graph Executor ────────────────────────────────────────────

/**
 * Execute a list of node IDs in order. Handles trigger, project, and loop nodes.
 * Loop nodes recursively execute their body sub-graph per array item.
 */
export async function executeSubGraph(
    sortedIds: string[],
    ctx: ExecutionContext
): Promise<void> {
    for (const nodeId of sortedIds) {
        const node = ctx.nodeMap.get(nodeId);
        if (!node) continue;

        const label = node.data?.label || node.data?.projectName || nodeId;
        const nodeStartTime = Date.now();

        ctx.send?.({ event: "node_started", nodeId, label });

        // ─── Trigger Node ────────────────────────────────────────────
        if (node.type === "trigger") {
            const triggerOutput = ctx.nodeOutputs[nodeId]?.text || "Workflow triggered";
            ctx.nodeOutputs[nodeId] = { structured: null, text: triggerOutput, raw: triggerOutput };
            ctx.send?.({ event: "node_finished", nodeId, output: triggerOutput });
            continue;
        }

        // ─── Loop Node ───────────────────────────────────────────────
        if (node.type === "loop") {
            try {
                await executeLoopNode(nodeId, node, ctx, nodeStartTime);
            } catch (error: any) {
                ctx.send?.({
                    event: "node_error",
                    nodeId,
                    error: error.message,
                    durationMs: Date.now() - nodeStartTime,
                });
                throw error;
            }
            continue;
        }

        // ─── Project Node ────────────────────────────────────────────
        if (node.type === "project" && node.data?.projectId) {
            try {
                await executeProjectNode(nodeId, node, ctx, nodeStartTime);
            } catch (error: any) {
                ctx.send?.({
                    event: "node_error",
                    nodeId,
                    error: error.message,
                    durationMs: Date.now() - nodeStartTime,
                });
                throw error;
            }
            continue;
        }

        // Unknown or unconfigured node
        ctx.send?.({ event: "node_finished", nodeId, output: "No project assigned - skipped" });
    }
}

// ─── Project Node Executor ───────────────────────────────────────────────────

async function executeProjectNode(
    nodeId: string,
    node: any,
    ctx: ExecutionContext,
    nodeStartTime: number
): Promise<void> {
    const label = node.data?.label || node.data?.projectName || nodeId;
    const parentIds = ctx.parentMap.get(nodeId) || [];
    let previousOutput: { structured: Record<string, any> | null; text: string } | null = null;

    if (parentIds.length === 1) {
        previousOutput = ctx.nodeOutputs[parentIds[0]] || null;
    } else if (parentIds.length > 1) {
        const mergedStructured: Record<string, any> = {};
        const mergedTexts: string[] = [];
        for (const pid of parentIds) {
            const po = ctx.nodeOutputs[pid];
            if (po?.structured) mergedStructured[pid] = po.structured;
            if (po?.text) {
                const parentLabel = ctx.nodeMap.get(pid)?.data?.label || pid;
                mergedTexts.push(`[From: ${parentLabel}]\n${po.text}`);
            }
        }
        previousOutput = {
            structured: Object.keys(mergedStructured).length > 0 ? mergedStructured : null,
            text: mergedTexts.join("\n\n"),
        };
    }

    const isFirstProject = parentIds.some((pid) => ctx.nodeMap.get(pid)?.type === "trigger");
    const prompt = buildNodePrompt(previousOutput, label, isFirstProject, ctx.loopContext);

    const chatId = crypto.randomUUID();
    const chatResponse = await fetch(`${ctx.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: ctx.cookieHeader,
        },
        body: JSON.stringify({
            projectId: node.data.projectId,
            chatId,
            content: prompt,
            previousMessages: [],
            model: node.data.model || "anthropic:claude-haiku-4-5",
        }),
    });

    if (!chatResponse.ok) {
        throw new Error(`Chat API returned ${chatResponse.status}`);
    }

    const rawOutput = await readChatStream(chatResponse);
    const parsed = parseWorkflowOutput(rawOutput);

    ctx.nodeOutputs[nodeId] = {
        structured: parsed.structured,
        text: parsed.text,
        raw: rawOutput,
    };

    // Persist incrementally
    if (ctx.supabase && ctx.executionId) {
        await ctx.supabase
            .from("workflow_executions")
            .update({ node_outputs: ctx.nodeOutputs })
            .eq("id", ctx.executionId);
    }

    const durationMs = Date.now() - nodeStartTime;
    const aiSummary = generateAISummary(parsed.text, parsed.structured);

    const displayOutput = parsed.structured
        ? `[Structured Output] ${JSON.stringify(parsed.structured).slice(0, 200)}...\n\n${parsed.text.slice(0, 300)}`
        : parsed.text.slice(0, 500);

    ctx.send?.({
        event: "node_finished",
        nodeId,
        output: displayOutput,
        hasStructuredOutput: !!parsed.structured,
        durationMs,
        aiSummary,
        inputData: previousOutput
            ? { structured: previousOutput.structured, text: previousOutput.text?.slice(0, 2000) }
            : null,
        outputData: {
            structured: parsed.structured,
            text: parsed.text?.slice(0, 5000),
        },
    });
}

// ─── Loop Node Executor ─────────────────────────────────────────────────────

async function executeLoopNode(
    nodeId: string,
    node: any,
    ctx: ExecutionContext,
    nodeStartTime: number
): Promise<void> {
    const arrayField: string = node.data?.arrayField || "items";
    const onError: string = node.data?.onError || "continue";
    const label = node.data?.label || "Loop";

    // Get upstream output to extract array
    const parentIds = ctx.parentMap.get(nodeId) || [];
    let upstreamOutput: NodeOutput | null = null;
    if (parentIds.length >= 1) {
        upstreamOutput = ctx.nodeOutputs[parentIds[0]] || null;
    }

    // Extract array from upstream structured output
    let array: any[] | null = null;
    if (upstreamOutput?.structured) {
        const extracted = getByPath(upstreamOutput.structured, arrayField);
        if (Array.isArray(extracted)) {
            array = extracted;
        }
    }

    // Fallback: try parsing the text as JSON and extracting
    if (!array && upstreamOutput?.text) {
        try {
            const parsed = JSON.parse(upstreamOutput.text);
            const extracted = getByPath(parsed, arrayField);
            if (Array.isArray(extracted)) {
                array = extracted;
            }
        } catch {
            // not JSON text
        }
    }

    // If the upstream output itself is an array (no field path needed)
    if (!array && upstreamOutput?.structured && Array.isArray(upstreamOutput.structured)) {
        array = upstreamOutput.structured;
    }

    if (!array || array.length === 0) {
        const errMsg = `Loop node "${label}": Could not find array at field "${arrayField}" in upstream output`;
        ctx.nodeOutputs[nodeId] = {
            structured: { iterations: [], summary: { total: 0, success: 0, failed: 0, error: errMsg } },
            text: errMsg,
            raw: errMsg,
        };
        ctx.send?.({
            event: "node_finished",
            nodeId,
            output: errMsg,
            durationMs: Date.now() - nodeStartTime,
        });
        return;
    }

    // Get body sub-graph nodes
    const allNodes = Array.from(ctx.nodeMap.values());
    const bodyNodeIds = getBodyNodeIds(nodeId, ctx.edges, allNodes);

    if (bodyNodeIds.length === 0) {
        const msg = `Loop node "${label}": No body nodes connected to "body" handle`;
        ctx.nodeOutputs[nodeId] = {
            structured: { iterations: [], summary: { total: array.length, success: 0, failed: 0, error: msg } },
            text: msg,
            raw: msg,
        };
        ctx.send?.({ event: "node_finished", nodeId, output: msg, durationMs: Date.now() - nodeStartTime });
        return;
    }

    ctx.send?.({
        event: "loop_started",
        nodeId,
        label,
        totalItems: array.length,
        arrayField,
    });

    const iterationResults: any[] = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < array.length; i++) {
        const item = array[i];

        ctx.send?.({
            event: "loop_iteration_started",
            nodeId,
            index: i,
            total: array.length,
            itemPreview: JSON.stringify(item).slice(0, 200),
        });

        // Create a scoped copy of nodeOutputs for this iteration
        const scopedOutputs: Record<string, NodeOutput> = { ...ctx.nodeOutputs };

        // Set the loop node's output to the current item so body nodes can access it
        scopedOutputs[nodeId] = {
            structured: typeof item === "object" ? item : { value: item },
            text: JSON.stringify(item),
            raw: JSON.stringify(item),
        };

        // Build parent map for body nodes — body entry nodes get the loop node as parent
        const bodyParentMap = new Map<string, string[]>();
        // Start with existing parent relationships within the body
        for (const edge of ctx.edges) {
            if (bodyNodeIds.includes(edge.target)) {
                if (!bodyParentMap.has(edge.target)) bodyParentMap.set(edge.target, []);
                if (bodyNodeIds.includes(edge.source)) {
                    bodyParentMap.get(edge.target)!.push(edge.source);
                }
            }
        }
        // Body entry nodes (those connected from loop's body handle) get loop node as parent
        const bodyEntryEdges = ctx.edges.filter(
            (e) => e.source === nodeId && e.sourceHandle === "body"
        );
        for (const edge of bodyEntryEdges) {
            if (!bodyParentMap.has(edge.target)) bodyParentMap.set(edge.target, []);
            bodyParentMap.get(edge.target)!.push(nodeId);
        }

        const iterationCtx: ExecutionContext = {
            ...ctx,
            nodeOutputs: scopedOutputs,
            parentMap: bodyParentMap,
            loopContext: {
                item,
                index: i,
                total: array.length,
                arrayField,
            },
        };

        try {
            await executeSubGraph(bodyNodeIds, iterationCtx);

            // Collect the last body node's output as this iteration's result
            const lastBodyNodeId = bodyNodeIds[bodyNodeIds.length - 1];
            const iterationOutput = scopedOutputs[lastBodyNodeId] || null;

            iterationResults.push({
                index: i,
                item,
                status: "success",
                output: iterationOutput?.structured || iterationOutput?.text || null,
            });
            successCount++;
        } catch (error: any) {
            iterationResults.push({
                index: i,
                item,
                status: "failed",
                error: error.message,
            });
            failCount++;

            if (onError === "stop") {
                ctx.send?.({
                    event: "loop_iteration_finished",
                    nodeId,
                    index: i,
                    total: array.length,
                    status: "failed",
                    error: error.message,
                });
                // Set loop output before throwing
                ctx.nodeOutputs[nodeId] = {
                    structured: {
                        iterations: iterationResults,
                        summary: { total: array.length, success: successCount, failed: failCount, stoppedAt: i },
                    },
                    text: `Loop stopped at item ${i + 1}/${array.length}: ${error.message}`,
                    raw: JSON.stringify(iterationResults),
                };
                throw error;
            }
        }

        ctx.send?.({
            event: "loop_iteration_finished",
            nodeId,
            index: i,
            total: array.length,
            status: iterationResults[iterationResults.length - 1].status,
        });
    }

    // Aggregate loop results
    ctx.nodeOutputs[nodeId] = {
        structured: {
            iterations: iterationResults,
            summary: { total: array.length, success: successCount, failed: failCount },
        },
        text: `Loop completed: ${successCount}/${array.length} items succeeded, ${failCount} failed.`,
        raw: JSON.stringify(iterationResults),
    };

    // Persist
    if (ctx.supabase && ctx.executionId) {
        await ctx.supabase
            .from("workflow_executions")
            .update({ node_outputs: ctx.nodeOutputs })
            .eq("id", ctx.executionId);
    }

    const durationMs = Date.now() - nodeStartTime;
    ctx.send?.({
        event: "loop_finished",
        nodeId,
        totalItems: array.length,
        successCount,
        failCount,
        durationMs,
    });

    ctx.send?.({
        event: "node_finished",
        nodeId,
        output: `Loop completed: ${successCount}/${array.length} items processed.`,
        durationMs,
        hasStructuredOutput: true,
        outputData: ctx.nodeOutputs[nodeId],
    });
}

// ─── Headless Execution ──────────────────────────────────────────────────────

/**
 * Execute a workflow without SSE streaming (fire-and-forget).
 * Used by scheduled runs. Now supports loop nodes.
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

    const { data: workflow } = await supabase
        .from("workflows")
        .select("workspace_id")
        .eq("id", workflowId)
        .single();

    if (!workflow) throw new Error("Workflow not found");

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
    const nodeMap = new Map<string, any>(nodes.map((n: any) => [n.id, n]));

    const parentMap = new Map<string, string[]>();
    edges.forEach((e: any) => {
        if (!parentMap.has(e.target)) parentMap.set(e.target, []);
        parentMap.get(e.target)!.push(e.source);
    });

    const childMap = new Map<string, { target: string; sourceHandle?: string }[]>();
    edges.forEach((e: any) => {
        if (!childMap.has(e.source)) childMap.set(e.source, []);
        childMap.get(e.source)!.push({ target: e.target, sourceHandle: e.sourceHandle });
    });

    try {
        const sortedIds = topologicalSort(nodes, edges);

        // Set trigger output
        for (const nodeId of sortedIds) {
            const node = nodeMap.get(nodeId);
            if (node?.type === "trigger") {
                const triggerOutput = triggerInput || "Workflow triggered";
                nodeOutputs[nodeId] = { structured: null, text: triggerOutput, raw: triggerOutput };
            }
        }

        const ctx: ExecutionContext = {
            nodeMap,
            edges,
            parentMap,
            childMap,
            nodeOutputs,
            baseUrl,
            cookieHeader,
            supabase,
            executionId: execution.id,
        };

        await executeSubGraph(sortedIds, ctx);

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
