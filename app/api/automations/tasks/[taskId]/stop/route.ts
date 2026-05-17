import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Cooperative cancel: flip stop_requested on the task row. The pipeline runner
// polls this between phases and exits gracefully with status='stopped' on the
// next iteration. The currently in-flight phase will finish first; we can't
// abort an open agent stream from another request.
export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ taskId: string }> }
) {
    const { taskId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { error } = await supabase
        .from("automation_tasks")
        .update({ stop_requested: true })
        .eq("id", taskId);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
