import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
    topologicalSort,
    executeSubGraph,
    type ExecutionContext,
    type NodeOutput,
} from "@/lib/workflows/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workflowId, nodes, edges, triggerInput } = await req.json();

    // Get workspace for execution record
    const { data: workflow } = await supabase
        .from("workflows")
        .select("workspace_id")
        .eq("id", workflowId)
        .single();

    if (!workflow) {
        return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    // Create execution record
    const { data: execution } = await supabase
        .from("workflow_executions")
        .insert({
            workflow_id: workflowId,
            workspace_id: workflow.workspace_id,
            status: "running",
            input: { nodes: nodes.length, edges: edges.length },
            node_outputs: {},
            triggered_by: "manual",
        })
        .select("id")
        .single();

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (data: any) => {
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
                );
            };

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

                // Pre-set trigger outputs
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
                    baseUrl: new URL("/", req.url).origin,
                    cookieHeader: req.headers.get("cookie") || "",
                    send,
                    supabase,
                    executionId: execution?.id,
                };

                await executeSubGraph(sortedIds, ctx);

                // Mark execution completed
                if (execution) {
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
                }

                // Build pipeline summary
                const pipelineSummary = sortedIds
                    .filter((id) => nodeMap.get(id)?.type === "project" || nodeMap.get(id)?.type === "loop" || nodeMap.get(id)?.type === "dispatch")
                    .map((id) => ({
                        nodeId: id,
                        label: nodeMap.get(id)?.data?.label || id,
                        structured: nodeOutputs[id]?.structured || null,
                        text: nodeOutputs[id]?.text?.slice(0, 5000) || "",
                    }));

                const lastProjectId = pipelineSummary[pipelineSummary.length - 1]?.nodeId;
                send({
                    event: "workflow_finished",
                    pipelineSummary,
                    finalOutput: lastProjectId ? nodeOutputs[lastProjectId]?.structured || null : null,
                });
            } catch (error: any) {
                send({ event: "error", error: error.message });

                if (execution) {
                    await supabase
                        .from("workflow_executions")
                        .update({
                            status: "failed",
                            error: error.message,
                            node_outputs: nodeOutputs,
                            finished_at: new Date().toISOString(),
                        })
                        .eq("id", execution.id);
                }
            }

            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
