"use client";

import { useState } from "react";
import { updateUserRole } from "@/lib/actions/admin";
import { User, ShieldCheck, Crown, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface UserProfile {
    id: string;
    username: string;
    full_name: string;
    role: string;
}

export function UserList({ initialUsers, currentUserRole }: { initialUsers: UserProfile[]; currentUserRole: string | null }) {
    const [users, setUsers] = useState(initialUsers);
    const isSuperAdmin = currentUserRole === 'super_admin';

    const handleRoleChange = async (userId: string, newRole: 'admin' | 'user' | 'super_admin') => {
        const result = await updateUserRole(userId, newRole);

        if (result.success) {
            setUsers(prev => prev.map(u =>
                u.id === userId ? { ...u, role: newRole } : u
            ));
            alert(`✅ Updated user role to ${newRole}!`);
        } else {
            alert("❌ Failed to update role: " + result.error);
        }
    };

    const getRoleIcon = (role: string) => {
        if (role === 'super_admin') return <Crown className="h-5 w-5" />;
        if (role === 'admin') return <ShieldCheck className="h-5 w-5" />;
        return <User className="h-5 w-5" />;
    };

    const getRoleBadge = (role: string) => {
        if (role === 'super_admin') {
            return (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold">
                    ⚡ Super Admin
                </span>
            );
        }
        if (role === 'admin') {
            return (
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                    Admin
                </span>
            );
        }
        return null;
    };

    const getAvatarClasses = (role: string) => {
        if (role === 'super_admin') return 'bg-amber-500/20 text-amber-600 dark:text-amber-400 ring-2 ring-amber-500/30';
        if (role === 'admin') return 'bg-primary/20 text-primary';
        return 'bg-muted text-muted-foreground';
    };

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold">User Management</h2>
            <div className="grid gap-2">
                {users.map((user) => (
                    <div
                        key={user.id}
                        className={`flex items-center justify-between p-4 border rounded-lg bg-card shadow-sm hover:shadow-md transition-all ${user.role === 'super_admin' ? 'border-amber-500/30 bg-amber-500/5' : ''
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${getAvatarClasses(user.role)}`}>
                                {getRoleIcon(user.role)}
                            </div>
                            <div>
                                <p className="font-medium flex items-center gap-2">
                                    {user.full_name || "Unnamed User"}
                                    {getRoleBadge(user.role)}
                                </p>
                                <p className="text-xs text-muted-foreground">{user.username || 'No username'}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Role change buttons */}
                            {user.role === 'user' && (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleRoleChange(user.id, 'admin')}
                                    >
                                        Make Admin
                                    </Button>
                                    {isSuperAdmin && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                                            onClick={() => handleRoleChange(user.id, 'super_admin')}
                                        >
                                            <Crown className="h-3 w-3 mr-1" />
                                            Make Super Admin
                                        </Button>
                                    )}
                                </>
                            )}
                            {user.role === 'admin' && (
                                <>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => handleRoleChange(user.id, 'user')}
                                    >
                                        Revoke Admin
                                    </Button>
                                    {isSuperAdmin && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                                            onClick={() => handleRoleChange(user.id, 'super_admin')}
                                        >
                                            <Crown className="h-3 w-3 mr-1" />
                                            Promote to Super Admin
                                        </Button>
                                    )}
                                </>
                            )}
                            {user.role === 'super_admin' && isSuperAdmin && (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => handleRoleChange(user.id, 'admin')}
                                >
                                    Demote to Admin
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
