import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { verifyAdmin } from "@/lib/actions/admin";

export const dynamic = "force-dynamic";

// There is no bare Jarvis page — a conversation always lives at
// /analysis/jarvis/<chatId>. Mint a fresh id and redirect.
export default async function JarvisIndexPage() {
    if (!(await verifyAdmin())) redirect("/");
    redirect(`/analysis/jarvis/${randomUUID()}`);
}
