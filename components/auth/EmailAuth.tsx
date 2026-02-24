"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function EmailAuth() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const router = useRouter();
    const supabase = createClient();

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (mode === "signup") {
                const { error: signUpError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: `${window.location.origin}/auth/callback`,
                    },
                });
                if (signUpError) throw signUpError;
                setMessage("Check your email for the confirmation link.");
            } else {
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (signInError) throw signInError;
                router.refresh();
                router.push("/projects");
            }
        } catch (err: any) {
            setError(err.message || "An error occurred during authentication.");
        } finally {
            setIsLoading(false);
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

                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground ml-1">Password</label>
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
                    {mode === "signin" ? "Sign In" : "Create Account"}
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
                        : "Already have an account? Sign in"}
                </button>
            </div>
        </div>
    );
}
