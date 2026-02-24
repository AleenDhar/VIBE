"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { UserPlus, X, Shield, Lock, Users, UserCheck } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { grantProjectAccess, revokeProjectAccess, getProjectMembers, grantAccessToAllUsers } from "@/lib/actions/project-members";

interface ProjectAccessManagerProps {
    projectId: string;
    canEdit: boolean;
}

export function ProjectAccessManager({ projectId, canEdit }: ProjectAccessManagerProps) {
    const [members, setMembers] = useState<any[]>([]);
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [confirmBulk, setConfirmBulk] = useState(false);
    const [bulkSuccessMsg, setBulkSuccessMsg] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            fetchMembers();
            setConfirmBulk(false);
            setBulkSuccessMsg(null);
        }
    }, [open, projectId]);

    const fetchMembers = async () => {
        const data = await getProjectMembers(projectId);
        setMembers(data || []);
    };

    const handleGrantAccess = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setBulkSuccessMsg(null);

        try {
            const res = await grantProjectAccess(projectId, email);
            if (res.error) {
                setError(res.error);
            } else {
                setEmail("");
                await fetchMembers();
            }
        } catch (err: any) {
            setError(err.message || "Failed to grant access");
        } finally {
            setLoading(false);
        }
    };

    const handleBulkGrant = async () => {
        setLoading(true);
        setError(null);
        setBulkSuccessMsg(null);

        try {
            const res = await grantAccessToAllUsers(projectId);
            if (res.error) {
                setError(res.error);
            } else {
                setBulkSuccessMsg(res.message || `Successfully added ${res.count} users!`);
                await fetchMembers();
                setConfirmBulk(false);
            }
        } catch (err: any) {
            setError(err.message || "Failed to bulk grant access");
        } finally {
            setLoading(false);
        }
    };

    const handleRevokeAccess = async (userId: string) => {
        setLoading(true);
        setError(null);

        try {
            const res = await revokeProjectAccess(projectId, userId);
            if (res.error) {
                setError(res.error);
            } else {
                await fetchMembers();
            }
        } catch (err: any) {
            setError(err.message || "Failed to revoke access");
        } finally {
            setLoading(false);
        }
    };

    if (!canEdit) return null;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 rounded-full border-border/50 shadow-sm bg-background/50 backdrop-blur-sm hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
                    <Users className="h-4 w-4" />
                    <span>Manage Access</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Project Access</DialogTitle>
                    <DialogDescription>
                        Share this project with specific users via their email address.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <form onSubmit={handleGrantAccess} className="flex gap-2">
                        <Input
                            placeholder="user@example.com"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                        <Button type="submit" disabled={loading || !email}>
                            <UserPlus className="h-4 w-4 mr-2" />
                            Add
                        </Button>
                    </form>

                    {!confirmBulk ? (
                        <div className="flex flex-col gap-2 border-t pt-4">
                            <p className="text-xs text-muted-foreground text-center">Or grant access to everyone at once</p>
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full bg-secondary/20 hover:bg-secondary/40"
                                onClick={() => setConfirmBulk(true)}
                                disabled={loading}
                            >
                                <Users className="h-4 w-4 mr-2" />
                                Grant Access to All Registered Users
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2 border p-3 rounded-md bg-accent/30">
                            <p className="text-sm text-center font-medium">Are you sure you want to add all registered users to this project?</p>
                            <div className="flex gap-2 mt-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => setConfirmBulk(false)}
                                    disabled={loading}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    variant="default"
                                    className="flex-1"
                                    onClick={handleBulkGrant}
                                    disabled={loading}
                                >
                                    <UserCheck className="h-4 w-4 mr-2" />
                                    Confirm
                                </Button>
                            </div>
                        </div>
                    )}

                    {error && (
                        <p className="text-sm text-destructive font-medium">{error}</p>
                    )}
                    {bulkSuccessMsg && (
                        <p className="text-sm text-emerald-500 font-medium">{bulkSuccessMsg}</p>
                    )}

                    <div className="space-y-4 mt-2">
                        <h4 className="text-sm font-medium leading-none">Current Members ({members.length})</h4>
                        {members.length === 0 ? (
                            <p className="text-sm text-muted-foreground border border-dashed rounded-lg p-4 text-center">No other members have access.</p>
                        ) : (
                            <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
                                {members.map((member) => (
                                    <div key={member.user_id} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {member.profiles?.avatar_url ? (
                                                <img src={member.profiles.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                                                    <span className="text-xs font-medium text-primary">
                                                        {member.profiles?.full_name?.[0] || '?'}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium leading-none">{member.profiles?.full_name || 'Unknown User'}</span>
                                                <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleRevokeAccess(member.user_id)}
                                            disabled={loading}
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
