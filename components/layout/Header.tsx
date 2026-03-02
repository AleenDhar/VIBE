"use client";

import * as React from "react";
import { Bell, User, Menu } from "lucide-react";
import { Button } from "@/components/ui/Button";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { LogOut, Settings as SettingsIcon, User as UserIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

interface HeaderProps {
    onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
    const router = useRouter();
    const supabase = createClient();
    const params = useParams();

    const [title, setTitle] = React.useState("Overview");
    const [user, setUser] = React.useState<any>(null);

    const handleSignOut = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error("SignOut error:", error);
            // Force clear local storage and cookies if server signout fails
            await supabase.auth.signOut({ scope: "local" });
        }

        // Use hard redirect to clear all Next.js client-side cache
        window.location.href = "/";
    };

    React.useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            setUser(user);
        };
        getUser();
    }, [supabase]);

    React.useEffect(() => {
        const fetchContext = async () => {
            if (params?.id && params?.chatId) {
                // Fetch Project Name
                const { data: project } = await supabase
                    .from('projects')
                    .select('name')
                    .eq('id', params.id)
                    .single();

                // Fetch Chat Name? Actually chats don't necessarily have names in the schema shown earlier, 
                // but let's assume we want "Project > Chat"
                // Or maybe just Project Name is enough context if chats are generic.
                // Re-reading user request: "replace that with the project and chat name okay"
                // Chats table has: id, created_at, project_id... does it have a name? 
                // Let's check schema. If not, I'll use "Project Name > Chat"

                // Wait, I recall seeing chats table schema earlier? 
                // Let's just use Project Name for now, and if Chat has a title/name column use that.
                // Actually, let's just use "Project Name" for safe bet, or "Project Name / Chat"

                if (project) {
                    setTitle(`${project.name}`);
                    // If we want chat ID or name:
                    // const { data: chat } = await supabase.from('chats').select('*').eq('id', params.chatId).single();
                    // setTitle(`${project.name} / ${chat?.title || 'Chat'}`);
                }
            } else if (params?.id) {
                const { data: project } = await supabase
                    .from('projects')
                    .select('name')
                    .eq('id', params.id)
                    .single();
                if (project) setTitle(project.name);
            } else {
                setTitle("Overview");
            }
        };
        fetchContext();
    }, [params, supabase]);

    return (
        <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-background/95 px-4 md:px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick}>
                    <Menu className="h-5 w-5" />
                </Button>
                {params?.id ? (
                    <Link
                        href={`/projects/${params.id}`}
                        className="hover:text-primary transition-colors cursor-pointer"
                    >
                        <h1 className="text-lg font-semibold text-foreground truncate max-w-[200px] md:max-w-[600px]">
                            {title}
                        </h1>
                    </Link>
                ) : (
                    <h1 className="text-lg font-semibold text-foreground truncate max-w-[200px] md:max-w-[600px]">
                        {title}
                    </h1>
                )}
            </div>

            <div className="flex items-center gap-4">


                <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5" />
                    <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="rounded-full relative h-8 w-8 bg-primary/10 hover:bg-primary/20 transition-colors">
                            <span className="font-medium text-xs text-primary">
                                {user?.email ? user.email.charAt(0).toUpperCase() : <UserIcon className="h-4 w-4" />}
                            </span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col space-y-1">
                                <p className="text-sm font-medium leading-none">{user?.user_metadata?.full_name || "My Account"}</p>
                                <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => router.push("/profile")}>
                            <UserIcon className="mr-2 h-4 w-4" />
                            <span>Profile</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push("/settings")}>
                            <SettingsIcon className="mr-2 h-4 w-4" />
                            <span>Settings</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleSignOut}>
                            <LogOut className="mr-2 h-4 w-4" />
                            <span>Sign out</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
