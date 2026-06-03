import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyAdmin } from "@/lib/actions/admin";

// =============================================================================
// Persist a USER chat turn to Supabase chat_messages.
// =============================================================================
// The agent backend only writes its own (assistant) events to chat_messages.
// To keep full conversation history in the DB (not localStorage), the frontend
// posts the user's turn here. We insert it as role='user' with the next
// per-chat sequence so it orders correctly. Same table + auth path the
// automation runner already uses (RLS-permitted authenticated insert).
// Used by both the analysis agent chat and Jarvis.
// =============================================================================

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
    if (!(await verifyAdmin())) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: { chat_id?: string; content?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const chatId = body.chat_id?.trim();
    const content = body.content ?? "";
    if (!chatId) {
        return NextResponse.json({ error: "chat_id is required" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // chat_messages.chat_id has a FK to chats.id, so make sure a chats row
    // exists for this conversation first. The agent backend reuses existing
    // chats rows, so pre-creating it is safe (ignore if it already exists).
    await supabase
        .from("chats")
        .upsert({ id: chatId, user_id: user.id }, { onConflict: "id", ignoreDuplicates: true });

    // Next per-chat sequence so the user turn sorts before the agent's reply.
    const { data: maxRow } = await supabase
        .from("chat_messages")
        .select("sequence")
        .eq("chat_id", chatId)
        .order("sequence", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
    const sequence = (maxRow?.sequence ?? 0) + 1;

    const { data, error } = await supabase
        .from("chat_messages")
        .insert({
            chat_id: chatId,
            role: "user",
            type: "message",
            content,
            sequence,
            metadata: {},
        })
        .select("id, sequence")
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: data?.id, sequence: data?.sequence ?? sequence });
}
