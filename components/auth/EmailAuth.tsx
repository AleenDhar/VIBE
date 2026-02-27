"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { loginWithEmail, signUpWithEmail, resetPasswordForEmail } from "@/app/auth/actions";

export function EmailAuth() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (mode === "reset") {
                const res = await resetPasswordForEmail(email);
                if (res?.error) throw new Error(res.error);
                if (res?.message) setMessage(res.message);
            } else if (mode === "signup") {
                const res = await signUpWithEmail(email, password);
                if (res?.error) throw new Error(res.error);
                if (res?.message) setMessage(res.message);
            } else {
                const res = await loginWithEmail(email, password);
                if (res?.error) throw new Error(res.error);
                // loginWithEmail will redirect to /projects on success
            }
        } catch (err: any) {
            setError(err.message || "An error occurred during authentication.");
            setIsLoading(false); // Only set false on error, as success redirects
        }
    };

    return (
        <div className="w-full space-y-4">
            <form onSubmit={handleEmailAuth} className="space-y-3 text-left">
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground ml-1">Email Address</label>
                    <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="email"
                            placeholder="name@example.com"
                            className="pl-10"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                </div>

                {mode !== "reset" && (
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground ml-1">Password</label>
                            {mode === "signin" && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMode("reset");
                                        setError(null);
                                        setMessage(null);
                                    }}
                                    className="text-xs text-primary hover:underline"
                                >
                                    Forgot password?
                                </button>
                            )}
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="password"
                                placeholder="••••••••"
                                className="pl-10"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>
                )}

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
                    rightIcon={mode === "signin" ? ArrowRight : undefined}
                >
                    {mode === "signin" ? "Sign In" : mode === "signup" ? "Create Account" : "Send Reset Link"}
                </Button>
            </form>

            <div className="text-center">
                <button
                    type="button"
                    onClick={() => {
                        setMode(mode === "signin" ? "signup" : "signin");
                        setError(null);
                        setMessage(null);
                    }}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                    {mode === "signin"
                        ? "Don't have an account? Sign up"
                        : mode === "signup"
                            ? "Already have an account? Sign in"
                            : "Back to sign in"}
                </button>
            </div>
        </div>
    );
}
