// Jarvis (global cross-analysis agent) — typed client.
// Reuses the analysis client's error type so callers branch consistently.

import { AnalysisApiError, extractErrorMessage } from "@/lib/analysis/api";

export interface JarvisAnalysisItem {
    id: string;
    title: string;
    status: string; // draft | running | done | error
    project_id: string | null;
    updated_at: string;
    enabled: boolean;
}

export interface JarvisSettings {
    enabled_analysis_ids: string[];
    system_prompt: string; // "" => uses default_system_prompt
    default_system_prompt: string;
    count: number;
    analyses: JarvisAnalysisItem[];
}

export interface JarvisPutResponse {
    enabled_analysis_ids: string[];
    system_prompt: string;
    count: number;
}

async function jsonRequest<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
    let res: Response;
    try {
        res = await fetch(url, {
            method: init?.method ?? "GET",
            headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
            body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
    } catch (err) {
        throw new AnalysisApiError(err instanceof Error ? err.message : "Network error", 0);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = text;
    }
    if (!res.ok) throw new AnalysisApiError(extractErrorMessage(parsed, res.status), res.status);
    return parsed as T;
}

export const getJarvisSettings = () => jsonRequest<JarvisSettings>("/api/jarvis/settings");

export const putJarvisSettings = (body: { enabled_analysis_ids?: string[]; system_prompt?: string }) =>
    jsonRequest<JarvisPutResponse>("/api/jarvis/settings", { method: "PUT", body });

export interface JarvisChatBody {
    messages: Array<{ role: string; content: string; images?: string[] }>;
    chat_id: string;
    model?: string;
    system_prompt?: string;
    headless?: boolean;
}

// Fire the Jarvis run. The agent streams its events into Supabase chat_messages
// (keyed by chat_id) — subscribe there. We don't consume the SSE body; resolving
// means the run started. Throws on 503 (capacity) / errors so the caller branches.
export async function sendJarvisChat(body: JarvisChatBody): Promise<void> {
    let res: Response;
    try {
        res = await fetch("/api/jarvis/chat/async", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch (err) {
        throw new AnalysisApiError(err instanceof Error ? err.message : "Network error", 0);
    }
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        let parsed: unknown = text;
        try {
            parsed = text ? JSON.parse(text) : text;
        } catch {
            /* keep raw */
        }
        throw new AnalysisApiError(extractErrorMessage(parsed, res.status), res.status);
    }
    res.body?.cancel().catch(() => {});
}
