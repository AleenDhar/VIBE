import { verifyAdmin, verifySuperAdmin, getBasePrompt, getAllUsers, getApiKeys, getCurrentUserRole } from "@/lib/actions/admin";
import { PromptEditor } from "@/components/admin/PromptEditor";
import { ApiKeyList } from "@/components/admin/ApiKeyList";
import { UserList } from "@/components/admin/UserList";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
    const isAdmin = await verifyAdmin();

    if (!isAdmin) {
        redirect("/");
    }

    const basePrompt = await getBasePrompt();
    const apiKeys = await getApiKeys();
    const users = await getAllUsers();
    const currentUserRole = await getCurrentUserRole();
    const isSuperAdmin = currentUserRole === 'super_admin';

    return (
        <div className="flex flex-col gap-8 max-w-4xl mx-auto px-4 py-8">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
                {isSuperAdmin && (
                    <Link
                        href="/omnivision"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                            bg-gradient-to-r from-amber-500/20 to-orange-500/20 
                            text-amber-600 dark:text-amber-400 
                            border border-amber-500/30 
                            hover:from-amber-500/30 hover:to-orange-500/30 
                            hover:shadow-lg hover:shadow-amber-500/10
                            hover:-translate-y-0.5"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                        Omnivision
                    </Link>
                )}
            </div>

            {isSuperAdmin && (
                <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
                        </svg>
                        <span className="text-sm font-semibold">Super Admin Mode Active</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        You have full access to all features including Omnivision — the ability to view all user chats.
                    </p>
                </div>
            )}

            <section className="bg-card p-6 rounded-lg shadow-sm border space-y-6">
                <PromptEditor initialPrompt={basePrompt} />
            </section>

            <section className="bg-card p-6 rounded-lg shadow-sm border space-y-6">
                <ApiKeyList initialKeys={apiKeys} />
            </section>

            <section className="bg-card p-6 rounded-lg shadow-sm border space-y-6">
                <UserList initialUsers={users} currentUserRole={currentUserRole} />
            </section>
        </div>
    );
}
