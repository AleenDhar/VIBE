"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Lock, Loader2, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export default function UpdatePasswordPage() {
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const router = useRouter();
    const supabase = createClient();

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

    return (
        <div className="flex justify-center items-center min-h-screen bg-background">
            <div className="w-full max-w-sm p-6 space-y-4">
                <div className="text-center mb-6">
                    <h1 className="text-2xl font-semibold tracking-tight">Set your new password</h1>
                    <p className="text-sm text-muted-foreground mt-2">
                        Enter your new password below to regain access to your account.
                    </p>
                </div>

                <form onSubmit={handleUpdatePassword} className="space-y-4">
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
                </form>
            </div>
        </div>
    );
}
