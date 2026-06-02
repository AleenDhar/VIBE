"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

export function DashboardClientLayout({ children }: { children: React.ReactNode }) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const pathname = usePathname();
    // The analysis sub-pages (/analysis/<id>, /analysis/jarvis) are their own
    // full-screen surfaces with their own header. The /analysis landing also
    // drops the app navbar (it has its own top bar) but keeps normal scroll.
    const isAnalysisSubpage = /^\/analysis\/[^/]+/.test(pathname || "");
    const hideNavbar = pathname === "/analysis" || isAnalysisSubpage;
    const isFullScreenPage =
        pathname?.includes("/chat/") ||
        pathname?.includes("/builder") ||
        pathname?.includes("/omnivision") ||
        isAnalysisSubpage;

    return (
        <div className="flex h-screen w-full max-w-[100vw] overflow-hidden bg-background">
            <Sidebar
                isCollapsed={isCollapsed}
                toggleCollapse={() => setIsCollapsed(!isCollapsed)}
                mobileOpen={isMobileOpen}
                setMobileOpen={setIsMobileOpen}
            />
            <div
                className={`flex flex-1 flex-col transition-all duration-300 ml-0 w-full max-w-full overflow-hidden ${isCollapsed ? 'md:ml-16' : 'md:ml-64'
                    }`}
            >
                {/* App navbar — hidden across the analysis area (it has its own
                    top bars / headers). */}
                {!hideNavbar && <Header onMenuClick={() => setIsMobileOpen(true)} />}
                <main className={`flex-1 ${isFullScreenPage ? 'overflow-hidden p-0' : 'overflow-y-auto p-4 md:p-8'}`}>
                    {children}
                </main>
            </div>
        </div>
    );
}
