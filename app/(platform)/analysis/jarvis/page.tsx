import { Suspense } from "react";
import { redirect } from "next/navigation";
import { verifyAdmin } from "@/lib/actions/admin";
import { JarvisWorkspace } from "@/components/jarvis/JarvisWorkspace";

export const dynamic = "force-dynamic";

export default async function JarvisPage() {
    if (!(await verifyAdmin())) redirect("/");
    return (
        <Suspense fallback={null}>
            <JarvisWorkspace />
        </Suspense>
    );
}
