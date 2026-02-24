import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className, error, ...props }, ref) => {
        return (
            <div className="w-full space-y-1">
                <input
                    ref={ref}
                    className={cn(
                        "flex h-11 w-full rounded-xl border border-input bg-background/50 px-4 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 transition-all disabled:cursor-not-allowed disabled:opacity-50",
                        error ? "border-destructive focus-visible:ring-destructive/20" : "",
                        className
                    )}
                    {...props}
                />
                {error && <p className="text-xs text-destructive px-1">{error}</p>}
            </div>
        );
    }
);
Input.displayName = "Input";

export { Input };
