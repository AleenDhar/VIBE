import { AppBuilderInterface } from "@/components/builder/AppBuilderInterface";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "App Builder | Deal Intel",
    description: "Build custom AI-powered apps with natural language.",
};

export default function BuilderPage() {
    return (
        <div className="h-full w-full overflow-hidden bg-background">
            {/* Note: The MainLayout usually provides the sidebar and header structure, 
                 but the AppBuilderInterface takes over full screen mostly. 
                 However, the Sidebar component is already rendered by layout.tsx in (platform).
                 So we just render the content here.
                 The (platform) layout typically adds a top bar or sidebar. 
                 We need to ensure it fits well. 
             */}
            <AppBuilderInterface />
        </div>
    );
}
