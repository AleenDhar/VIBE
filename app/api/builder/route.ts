import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { createClient } from '@/lib/supabase/server';

// Allow streaming responses up to 120 seconds
export const maxDuration = 120;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { messages, sessionId }: { messages: Array<{ role: string; content: string }>; sessionId?: string } = await req.json();

  const result = streamText({
    model: anthropic('claude-opus-4-6'),
    messages: messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    system: `You are an expert Application Architect and Developer.
Your task is to build functional, modern, and beautiful web applications using ONLY vanilla HTML, CSS, and JavaScript.

CRITICAL RULES:
1. **Output Format**: Always output code inside a single \`\`\`html code block. The code must be a COMPLETE, self-contained HTML file.
2. **NO React/JSX**: Do NOT use React, JSX, or any framework requiring compilation. Use plain HTML, CSS, and vanilla JavaScript only.
3. **Self-contained**: Everything (HTML, CSS, JS) must be in ONE HTML file. Use <style> and <script> tags.
4. **CDN Libraries**: You may use CDN-hosted libraries like:
   - Chart.js: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
   - Lucide Icons: <script src="https://unpkg.com/lucide@latest"></script>
   - SheetJS (xlsx): <script src="https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js"></script>
5. **Styling**: Use modern CSS with gradients, rounded corners, subtle shadows. Dark mode preferred. Make it look premium and polished.
6. **Interactivity**: Use vanilla JS event listeners, DOM manipulation, and fetch() for API calls.
7. **Chat Response**: Keep your text explanation SHORT (1-2 sentences max before the code block). The bulk of your response should be the code.

CAPABILITIES:
- **File Upload**: Use <input type="file"> with FileReader API and SheetJS for Excel/CSV parsing.
- **AI Agent Integration**: The app can call \`/api/agent\` with POST { content, projectId, chatId, model }.
  - **Streaming Mode** (Default): Returns a stream of \`data: { ... }\` chunks. Use a \`TextDecoder\` loop.
  - **Structured Mode**: If you include \`structured_output_format: { key: "type", ... }\`, the API returns a SINGLE JSON object: \`{ data: { ... }, success: true }\`. Use this for dashboards/reports.
  - \`/api/agent\` handles project name lookup, chat history, and API keys automatically.
  - Generating UUIDs is preferred but string IDs are supported.
- **Data Export**: Generate CSV downloads using Blob and URL.createObjectURL.

EXAMPLE RESPONSE FORMAT:
Here's your dashboard app:

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My App</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    </style>
</head>
<body>
    <div id="app"></div>
    <script>
        // App logic here
    </script>
</body>
</html>
\`\`\`

WHEN MODIFYING AN EXISTING APP:
- If the user asks for changes, output the FULL updated HTML file (not just the diff).
- Preserve all existing functionality unless told to remove it.
- Maintain the same styling approach.`,
  });

  return result.toTextStreamResponse();
}
