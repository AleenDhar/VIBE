import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
    topologicalSort,
    parseWorkflowOutput,
    buildNodePrompt,
    generateAISummary,
    readChatStream,
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

            const nodeOutputs: Record<string, {
                structured: Record<string, any> | null;
                text: string;
                raw: string;
            }> = {};

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
                    const nodeStartTime = Date.now();

                    send({ event: "node_started", nodeId, label });

                    if (node.type === "trigger") {
                        const triggerOutput = triggerInput || "Workflow triggered";
                        nodeOutputs[nodeId] = { structured: null, text: triggerOutput, raw: triggerOutput };
                        send({ event: "node_finished", nodeId, output: triggerOutput });
                        continue;
                    }

                    if (node.type === "project" && node.data?.projectId) {
                        try {
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
                                new URL("/api/chat", req.url).toString(),
                                {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                        Cookie: req.headers.get("cookie") || "",
                                    },
                                    body: JSON.stringify({
                                        projectId: node.data.projectId,
                                        chatId,
                                        content: prompt,
                                        previousMessages: [],
                                        model: "anthropic:claude-haiku-4-5",
                                    }),
                                }
                            );

                            if (!chatResponse.ok) {
                                throw new Error(`Chat API returned ${chatResponse.status}`);
                            }

                            const rawOutput = await readChatStream(chatResponse);
                            const parsed = parseWorkflowOutput(rawOutput);

                            nodeOutputs[nodeId] = {
                                structured: parsed.structured,
                                text: parsed.text,
                                raw: rawOutput,
                            };

                            if (execution) {
                                await supabase
                                    .from("workflow_executions")
                                    .update({ node_outputs: nodeOutputs })
                                    .eq("id", execution.id);
                            }

                            const durationMs = Date.now() - nodeStartTime;
                            const aiSummary = generateAISummary(parsed.text, parsed.structured);

                            const displayOutput = parsed.structured
                                ? `[Structured Output] ${JSON.stringify(parsed.structured).slice(0, 200)}...\n\n${parsed.text.slice(0, 300)}`
                                : parsed.text.slice(0, 500);

                            send({
                                event: "node_finished",
                                nodeId,
                                output: displayOutput,
                                hasStructuredOutput: !!parsed.structured,
                                durationMs,
                                aiSummary,
                                inputData: previousOutput ? {
                                    structured: previousOutput.structured,
                                    text: previousOutput.text?.slice(0, 2000),
                                } : null,
                                outputData: {
                                    structured: parsed.structured,
                                    text: parsed.text?.slice(0, 5000),
                                },
                            });
                        } catch (error: any) {
                            send({
                                event: "node_error",
                                nodeId,
                                error: error.message,
                                durationMs: Date.now() - nodeStartTime,
                            });

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

                            controller.close();
                            return;
                        }
                    } else {
                        send({ event: "node_finished", nodeId, output: "No project assigned - skipped" });
                    }
                }

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

                const pipelineSummary = sortedIds
                    .filter((id) => nodeMap.get(id)?.type === "project")
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
