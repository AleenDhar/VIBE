import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
    params: Promise<{ slug: string }>;
}

export default async function PublishedAppPage({ params }: PageProps) {
    const { slug } = await params;
    const supabase = await createClient();

    // Fetch the published app
    const { data: app, error } = await supabase
        .from("published_apps")
        .select("html_content")
        .eq("slug", slug)
        .single();

    if (error || !app) {
        // If not found in published_apps, it might be an invalid route or another platform route
        // but Next.js usually handles matching. If we are here, it matches [slug].
        notFound();
    }

    // Return the raw HTML content
    // We use a simple layout-less response for the app
    return (
        <div
            className="w-full h-screen"
            dangerouslySetInnerHTML={{ __html: app.html_content }}
        />
    );
}

// Optional: Metadata
export async function generateMetadata({ params }: PageProps) {
    const { slug } = await params;
    return {
        title: `${slug} | Deal Intelligence App`,
        description: "A custom app built with Deal Intelligence App Builder.",
    };
}
