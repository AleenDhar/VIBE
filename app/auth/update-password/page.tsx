"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Lock, ArrowRight, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

export default function UpdatePasswordPage() {
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [sessionReady, setSessionReady] = useState(false);
    const [noSession, setNoSession] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const router = useRouter();
    const supabase = createClient();

    useEffect(() => {
        // With PKCE flow, the callback route already exchanged the code and
        // set session cookies. We just need to verify the user is authenticated.
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                setSessionReady(true);
            } else {
                setNoSession(true);
            }
        };

        checkSession();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleUpdatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setMessage(null);

        try {
            const { error: updateError } = await supabase.auth.updateUser({
                password,
            });

            if (updateError) throw updateError;

            setMessage("Password updated successfully. Redirecting you to the app...");
            setTimeout(() => {
                router.push("/projects");
                router.refresh();
            }, 2000);
        } catch (err: any) {
            setError(err.message || "Failed to update password.");
        } finally {
            setIsLoading(false);
        }
    };

    // Show loading state while waiting to check session
    const isWaiting = !sessionReady && !noSession;

    return (
        <div className="flex justify-center items-center min-h-screen bg-background">
            <div className="w-full max-w-sm p-6 space-y-4">
                <div className="text-center mb-6">
                    <h1 className="text-2xl font-semibold tracking-tight">Set your new password</h1>
                    <p className="text-sm text-muted-foreground mt-2">
                        Enter your new password below to regain access to your account.
                    </p>
                </div>

                <AnimatePresence mode="wait">
                    {/* No session — expired or invalid link */}
                    {noSession && (
                        <motion.div
                            key="expired"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="flex flex-col items-center gap-3 text-center py-4"
                        >
                            <AlertTriangle className="h-8 w-8 text-destructive" />
                            <p className="text-sm font-medium text-destructive">
                                This reset link has expired or is invalid.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Password reset links can only be used once and expire after a short period.
                            </p>
                            <Link
                                href="/forgot-password"
                                className="text-xs text-primary underline underline-offset-4 hover:opacity-80 mt-1"
                            >
                                Request a new reset link
                            </Link>
                        </motion.div>
                    )}

                    {/* Loading / checking session */}
                    {isWaiting && (
                        <motion.div
                            key="loading"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex justify-center py-6"
                        >
                            <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                        </motion.div>
                    )}

                    {/* Password form — only shown once session is confirmed */}
                    {sessionReady && (
                        <motion.form
                            key="form"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            onSubmit={handleUpdatePassword}
                            className="space-y-4"
                        >
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-muted-foreground ml-1">New Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        type="password"
                                        placeholder="••••••••"
                                        className="pl-10"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        minLength={6}
                                        required
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <AnimatePresence mode="wait">
                                {error && (
                                    <motion.p
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="text-xs text-destructive text-center"
                                    >
                                        {error}
                                    </motion.p>
                                )}
                                {message && (
                                    <motion.p
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="text-xs text-emerald-500 text-center"
                                    >
                                        {message}
                                    </motion.p>
                                )}
                            </AnimatePresence>

                            <Button
                                type="submit"
                                className="w-full rounded-xl"
                                isLoading={isLoading}
                                rightIcon={ArrowRight}
                                disabled={isLoading || password.length < 6}
                            >
                                Update Password
                            </Button>
                        </motion.form>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
