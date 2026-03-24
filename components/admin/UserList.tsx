"use client";

import { useState } from "react";
import { updateUserRole, updateUserAllowedModels } from "@/lib/actions/admin";
import { User, ShieldCheck, Crown, Mail, Cpu, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getActiveModels, getUserAllowedModels, AIModel } from "@/lib/actions/models";

interface UserProfile {
    id: string;
    username: string;
    full_name: string;
    role: string;
}

export function UserList({ initialUsers, currentUserRole }: { initialUsers: UserProfile[]; currentUserRole: string | null }) {
    const [users, setUsers] = useState(initialUsers);
    const [selectedUserForModels, setSelectedUserForModels] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
    const [userAllowedModels, setUserAllowedModels] = useState<string[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const isSuperAdmin = currentUserRole === 'super_admin';

    // Spend cap state
    const [selectedUserForCap, setSelectedUserForCap] = useState<string | null>(null);
    const [capValue, setCapValue] = useState<string>("");
    const [isSavingCap, setIsSavingCap] = useState(false);
    const [userCaps, setUserCaps] = useState<Record<string, number | null>>({});

    // Fetch caps on mount
    useState(() => {
        fetch("/api/admin/spend-cap")
            .then(res => res.json())
            .then(data => {
                const caps: Record<string, number | null> = {};
                (data.users || []).forEach((u: any) => {
                    caps[u.id] = u.daily_spend_cap;
                });
                setUserCaps(caps);
            })
            .catch(() => {});
    });

    const handleSetCap = (userId: string) => {
        setSelectedUserForCap(userId);
        const currentCap = userCaps[userId];
        setCapValue(currentCap !== null && currentCap !== undefined ? String(currentCap) : "");
    };

    const handleSaveCap = async () => {
        if (!selectedUserForCap) return;
        setIsSavingCap(true);
        try {
            const res = await fetch("/api/admin/spend-cap", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_id: selectedUserForCap,
                    daily_spend_cap: capValue === "" ? null : Number(capValue),
                }),
            });
            const data = await res.json();
            if (data.success) {
                setUserCaps(prev => ({ ...prev, [selectedUserForCap!]: data.daily_spend_cap }));
                alert("Daily spend cap updated successfully!");
                setSelectedUserForCap(null);
            } else {
                alert("Failed to update cap: " + (data.error || "Unknown error"));
            }
        } catch (error) {
            console.error("Failed to save cap:", error);
            alert("Failed to save changes.");
        } finally {
            setIsSavingCap(false);
        }
    };

    // Fetch models and user access when opening modal
    const handleManageModels = async (userId: string) => {
        setSelectedUserForModels(userId);
        setIsLoadingModels(true);
        try {
            const [models, allowed] = await Promise.all([
                getActiveModels(),
                getUserAllowedModels(userId)
            ]);
            setAvailableModels(models);
            setUserAllowedModels(allowed);
        } catch (error) {
            console.error("Failed to load models data:", error);
            alert("Failed to load models data.");
        } finally {
            setIsLoadingModels(false);
        }
    };

    const handleSaveModels = async () => {
        if (!selectedUserForModels) return;
        setIsLoadingModels(true);
        try {
            const result = await updateUserAllowedModels(selectedUserForModels, userAllowedModels);
            if (result.success) {
                alert("✅ Model permissions updated successfully!");
                setSelectedUserForModels(null);
            } else {
                alert("❌ Failed to update model permissions: " + result.error);
            }
        } catch (error) {
            console.error("Failed to save models:", error);
            alert("Failed to save changes.");
        } finally {
            setIsLoadingModels(false);
        }
    };

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
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSetCap(user.id)}
                            >
                                <DollarSign className="h-4 w-4 mr-1" />
                                {userCaps[user.id] !== null && userCaps[user.id] !== undefined
                                    ? `$${Number(userCaps[user.id]).toFixed(2)}/day`
                                    : "Set Cap"}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="mr-2"
                                onClick={() => handleManageModels(user.id)}
                            >
                                <Cpu className="h-4 w-4 mr-2" />
                                Models
                            </Button>
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

            {/* Spend Cap Modal */}
            <Dialog open={selectedUserForCap !== null} onOpenChange={(open) => !open && setSelectedUserForCap(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            Daily Spend Cap for {users.find(u => u.id === selectedUserForCap)?.full_name}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Set a daily spending limit in USD. The cap resets every day at 4:00 AM IST.
                            Leave empty for unlimited spending.
                        </p>
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-medium">$</span>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="e.g. 5.00 (empty = no limit)"
                                value={capValue}
                                onChange={(e) => setCapValue(e.target.value)}
                                className="flex-1 bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                            />
                            <span className="text-sm text-muted-foreground">/ day</span>
                        </div>
                        <div className="flex justify-between items-center pt-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { setCapValue(""); }}
                                className="text-xs"
                            >
                                Remove Cap
                            </Button>
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setSelectedUserForCap(null)}>Cancel</Button>
                                <Button onClick={handleSaveCap} disabled={isSavingCap}>
                                    {isSavingCap ? "Saving..." : "Save Cap"}
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Model Management Modal */}
            <Dialog open={selectedUserForModels !== null} onOpenChange={(open) => !open && setSelectedUserForModels(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Manage Models for {users.find(u => u.id === selectedUserForModels)?.full_name}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        {isLoadingModels ? (
                            <p className="text-sm text-muted-foreground">Loading models...</p>
                        ) : availableModels.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No active models found in database.</p>
                        ) : (
                            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                                {availableModels.map(model => (
                                    <div key={model.id} className="flex items-start flex-col gap-1 p-3 border rounded-md">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                id={`model-${model.id}`}
                                                className="h-4 w-4 rounded border-gray-300"
                                                checked={model.is_available_to_all || userAllowedModels.includes(model.id)}
                                                disabled={model.is_available_to_all} // Can't uncheck globally available modes
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setUserAllowedModels(prev => [...prev, model.id]);
                                                    } else {
                                                        setUserAllowedModels(prev => prev.filter(id => id !== model.id));
                                                    }
                                                }}
                                            />
                                            <label htmlFor={`model-${model.id}`} className="font-medium text-sm flex items-center gap-2">
                                                {model.name}
                                                {model.is_available_to_all && (
                                                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">Available to All</span>
                                                )}
                                                {!model.is_available_to_all && (
                                                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Restricted</span>
                                                )}
                                            </label>
                                        </div>
                                        <p className="text-xs text-muted-foreground ml-6">ID: <code className="bg-muted px-1 rounded">{model.id}</code></p>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex justify-end pt-4 gap-2">
                            <Button variant="outline" onClick={() => setSelectedUserForModels(null)}>Cancel</Button>
                            <Button onClick={handleSaveModels} disabled={isLoadingModels}>Save Permissions</Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
