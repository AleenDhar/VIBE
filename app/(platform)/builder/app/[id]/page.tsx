import { AppBuilderWorkspace } from "@/components/builder/AppBuilderWorkspace";

export default async function BuilderAppPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return (
        <div className="h-full w-full overflow-hidden bg-background">
            <AppBuilderWorkspace sessionId={id} />
        </div>
    );
}
