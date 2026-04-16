"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";

export function ProjectSearch({ onSearch }: { onSearch: (query: string) => void }) {
    const [query, setQuery] = useState("");

    const handleChange = (value: string) => {
        setQuery(value);
        onSearch(value);
    };

    return (
        <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 pointer-events-none" />
            <input
                type="text"
                placeholder="Search projects…"
                value={query}
                onChange={e => handleChange(e.target.value)}
                className="w-full bg-muted/30 border border-border/20 rounded-xl py-2.5 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/40"
            />
            {query && (
                <button
                    onClick={() => handleChange("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}
