"use client";

import { Button } from "@/components/ui/Button";
import { loginWithOAuth } from "@/app/auth/actions";

export function LoginButton() {
    const handleLogin = async () => {
        // We will default to 'google'
        const res = await loginWithOAuth('google');

        if (res?.error) {
            console.error("Login failed:", res.error);
            alert("Google login is not configured in Supabase yet. Please configure it in the dashboard.");
        }
    };

    return (
        <Button size="lg" className="w-full text-base" onClick={handleLogin}>
            Login with Google
        </Button>
    );
}
