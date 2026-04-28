import {
    Cloud,
    Building2,
    Mail,
    Video,
    Contact,
    CheckCircle,
    Globe,
    Clock,
    Sparkles,
    type LucideIcon,
} from "lucide-react";

export interface ToolIntegration {
    integration: string;
    icon: LucideIcon;
    color: string;
}

const INTEGRATION_MAP: Array<{
    test: (name: string) => boolean;
    integration: string;
    icon: LucideIcon;
    color: string;
}> = [
    {
        test: (n) =>
            /^(salesforce|sf|soql)_/.test(n) ||
            n === "soql" ||
            n === "get_record" ||
            n === "get_object_describe",
        integration: "Salesforce",
        icon: Cloud,
        color: "text-sky-400/80",
    },
    {
        test: (n) => /^(zi|zoominfo)_/.test(n),
        integration: "ZoomInfo",
        icon: Building2,
        color: "text-blue-400/80",
    },
    {
        test: (n) => /^(lemlist|lem|cam)_/.test(n),
        integration: "Lemlist",
        icon: Mail,
        color: "text-purple-400/80",
    },
    {
        test: (n) => /meeting/.test(n) || /^avoma_/.test(n),
        integration: "Avoma",
        icon: Video,
        color: "text-rose-400/80",
    },
    {
        test: (n) => /^(seamless|apollo|wiza)_/.test(n),
        integration: "Contact enrichment",
        icon: Contact,
        color: "text-amber-400/80",
    },
    {
        test: (n) => /^(zerobounce|zb)_/.test(n),
        integration: "Email validation",
        icon: CheckCircle,
        color: "text-emerald-400/80",
    },
    {
        test: (n) => /^apify_/.test(n) || n === "web_search" || n === "duckduckgo_search",
        integration: "Web",
        icon: Globe,
        color: "text-cyan-400/80",
    },
    {
        test: (n) => n === "get_current_time",
        integration: "System",
        icon: Clock,
        color: "text-slate-400/80",
    },
];

const FALLBACK: ToolIntegration = {
    integration: "Tool",
    icon: Sparkles,
    color: "text-muted-foreground/70",
};

export function resolveToolIntegration(toolName: string): ToolIntegration {
    const name = (toolName || "").toLowerCase().trim();
    for (const entry of INTEGRATION_MAP) {
        if (entry.test(name)) {
            return {
                integration: entry.integration,
                icon: entry.icon,
                color: entry.color,
            };
        }
    }
    return FALLBACK;
}

export function summariseIntegrations(toolNames: string[]): string {
    const seen: string[] = [];
    for (const name of toolNames) {
        const { integration } = resolveToolIntegration(name);
        if (!seen.includes(integration)) seen.push(integration);
    }
    if (seen.length === 0) return "Tools";
    if (seen.length === 1) return seen[0];
    if (seen.length === 2) return seen.join(", ");
    return `${seen.slice(0, 2).join(", ")} +${seen.length - 2}`;
}
