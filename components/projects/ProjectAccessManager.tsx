"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/switch";
import { Users, Search, Loader2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    getProjectMembers,
    getAllWorkspaceUsers,
    toggleUserProjectAccess,
} from "@/lib/actions/project-members";

interface WorkspaceUser {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
    role: string;
}

interface ProjectAccessManagerProps {
    projectId: string;
    canEdit: boolean;
}

export function ProjectAccessManager({ projectId, canEdit }: ProjectAccessManagerProps) {
    const [members, setMembers] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<WorkspaceUser[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (open) {
            fetchData();
        } else {
            // Reset state when modal closes
            setSearchQuery("");
            setError(null);
        }
    }, [open, projectId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [membersData, usersData] = await Promise.all([
                getProjectMembers(projectId),
                getAllWorkspaceUsers(),
            ]);
            setMembers(membersData || []);
            setAllUsers(usersData || []);
        } catch (err) {
            console.error("Failed to fetch data:", err);
        } finally {
            setLoading(false);
        }
    };

    const memberUserIds = useMemo(
        () => new Set(members.map((m) => m.user_id)),
        [members]
    );

    const filteredUsers = useMemo(() => {
        if (!searchQuery.trim()) return allUsers;
        const query = searchQuery.toLowerCase();
        return allUsers.filter((user) =>
            (user.full_name || "").toLowerCase().includes(query)
        );
    }, [allUsers, searchQuery]);

    const handleToggle = async (userId: string, currentlyMember: boolean) => {
        setTogglingUserId(userId);
        setError(null);

        try {
            const res = await toggleUserProjectAccess(projectId, userId, !currentlyMember);
            if (res.error) {
                setError(res.error);
            } else {
                // Refresh members list
                const membersData = await getProjectMembers(projectId);
                setMembers(membersData || []);
            }
        } catch (err: any) {
            setError(err.message || "Failed to toggle access");
        } finally {
            setTogglingUserId(null);
        }
    };

    if (!canEdit) return null;

    const activeCount = filteredUsers.filter((u) => memberUserIds.has(u.id)).length;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 rounded-full border-border/50 shadow-sm bg-background/50 backdrop-blur-sm hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                >
                    <Users className="h-4 w-4" />
                    <span>Manage Access</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>Project Access</DialogTitle>
                    <DialogDescription>
                        Toggle access for registered users. {members.length} user{members.length !== 1 ? "s" : ""} currently have access.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    {/* Search Bar */}
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search users by name..."
                            className="pl-10"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-destructive font-medium">{error}</p>
                    )}

                    {/* User List */}
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredUsers.length === 0 ? (
                        <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                            {searchQuery ? "No users match your search." : "No registered users found."}
                        </p>
                    ) : (
                        <div className="space-y-1 max-h-[350px] overflow-y-auto pr-1">
                            {filteredUsers.map((user) => {
                                const isMember = memberUserIds.has(user.id);
                                const isToggling = togglingUserId === user.id;

                                return (
                                    <div
                                        key={user.id}
                                        className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            {user.avatar_url ? (
                                                <img
                                                    src={user.avatar_url}
                                                    alt="Avatar"
                                                    className="w-8 h-8 rounded-full shrink-0"
                                                />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                    <span className="text-xs font-medium text-primary">
                                                        {user.full_name?.[0]?.toUpperCase() || "?"}
                                                    </span>
                                                </div>
                                            )}
                                            <span className="text-sm font-medium truncate">
                                                {user.full_name || "Unnamed User"}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {isToggling && (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                            )}
                                            <Switch
                                                checked={isMember}
                                                onCheckedChange={() => handleToggle(user.id, isMember)}
                                                disabled={isToggling}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
