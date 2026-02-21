"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

export function DashboardClientLayout({ children }: { children: React.ReactNode }) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const pathname = usePathname();
    const isFullScreenPage = pathname?.includes("/chat/") || pathname?.includes("/builder") || pathname?.includes("/omnivision");

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
                {/* <Header onMenuClick={() => setIsMobileOpen(true)} /> */}
                {/* Hide header for builder page if needed? Or keep it? keeping it for now but maybe conditionally? */}
                {/* The user didn't ask to remove header, just padding/margin. */}
                <Header onMenuClick={() => setIsMobileOpen(true)} />
                <main className={`flex-1 ${isFullScreenPage ? 'overflow-hidden p-0' : 'overflow-y-auto p-4 md:p-8'}`}>
                    {children}
                </main>
            </div>
        </div>
    );
}
