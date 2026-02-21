import { verifySuperAdmin, getAllChatsWithUsers } from "@/lib/actions/admin";
import { redirect } from "next/navigation";
import { OmnivisionDashboard } from "@/components/admin/OmnivisionDashboard";

export const dynamic = "force-dynamic";

export default async function OmnivisionPage() {
    const isSuperAdmin = await verifySuperAdmin();

    if (!isSuperAdmin) {
        redirect("/");
    }

    const allChats = await getAllChatsWithUsers();

    return <OmnivisionDashboard initialChats={allChats} />;
}
