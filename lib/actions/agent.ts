"use server";

export async function generateTargetList(criteria: string) {
    const systemPrompt = `SEGMENT BUILDER AGENT v1.0

# ROLE
Generate a numbered list of target companies based on the user's segment criteria (industry, geography, count, and any additional filters). Use your general knowledge of major companies in the specified industry and regions.

# EXECUTION
1. Parse the segment criteria: industry, geography/regions, count, additional criteria.
2. Generate a list of companies matching ALL criteria.
3. Ensure geographic diversity across the specified regions.
4. Include a mix of company sizes/types if additional criteria specifies (e.g., 'mix of full-service and budget airlines', 'tier-1 and tier-2 banks').
5. If additional criteria is empty or '--', ignore it and just use industry + geography + count.

# RULES
- Only include real, currently operating companies.
- Spread companies across all specified regions/geographies — do not over-index on one country.
- Use the most commonly known company name (e.g., 'Emirates' not 'Emirates Group').
- If the count requested exceeds the number of well-known companies in that segment, include mid-market players but flag them.
- Output EXACTLY the number of companies requested.

# OUTPUT FORMAT
Return a plain text table with columns: #, Company Name, Country, Region, Company Type.
At the top, include a summary line: Industry, Geography, Total Companies, Additional Criteria.
Separate columns with ' | '.
Include a header row.`;

    const payload = {
        messages: [
            {
                role: "user",
                content: `Generate a target company list based on the following criteria: ${criteria}`
            }
        ],
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
        const agentBase = (process.env.AGENT_API_URL || "http://mase-alb-1262623499.ap-south-1.elb.amazonaws.com").replace(/\/$/, "");
        const response = await fetch(`${agentBase}/api/chat/structured`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
            // signal: AbortSignal.timeout(1000000) // fetch timeout support varies, but node fetch supports it. Next.js extends fetch.
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Agent API Error:", response.status, errorText);
            throw new Error(`Agent API responded with ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        return { success: true, data: data.output };

    } catch (error: any) {
        console.error("Generate Target List Error:", error);
        return { success: false, error: error.message };
    }
}
