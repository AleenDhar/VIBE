import { redirect } from "next/navigation";
import { verifyAdmin } from "@/lib/actions/admin";
import { JarvisWorkspace } from "@/components/jarvis/JarvisWorkspace";

export const dynamic = "force-dynamic";

export default async function JarvisChatPage({
    params,
}: {
    params: Promise<{ chatId: string }>;
}) {
    if (!(await verifyAdmin())) redirect("/");
    const { chatId } = await params;
    // key forces a clean remount when navigating between conversations.
    return <JarvisWorkspace key={chatId} chatId={chatId} />;
}
