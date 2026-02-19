import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { createClient } from '@/lib/supabase/server';

import { DEFAULT_BUILDER_SYSTEM_PROMPT } from '@/lib/builder-constants';

// Allow streaming responses up to 300 seconds
export const maxDuration = 300;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { messages, sessionId, systemPrompt }: {
    messages: Array<{ role: string; content: string }>;
    sessionId?: string;
    systemPrompt?: string;
  } = await req.json();

  const result = streamText({
    model: anthropic('claude-opus-4-6'),
    messages: messages
      .filter(m => m.content && m.content.trim().length > 0)
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    system: systemPrompt || DEFAULT_BUILDER_SYSTEM_PROMPT,
  });

  return result.toTextStreamResponse();
}
