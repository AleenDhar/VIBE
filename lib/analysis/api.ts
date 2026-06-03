// =============================================================================
// Analysis Workspace — typed REST client
// =============================================================================
// Every function calls the same-origin Bearer proxy (/api/analysis/...), which
// attaches the Authorization header server-side. Non-2xx responses surface the
// backend's { error } envelope as a thrown AnalysisApiError carrying the status
// so callers can branch (e.g. 409 = already running).
// =============================================================================

import type {
    Analysis,
    AnalysisColumn,
    AnalysisRow,
    AnalysisSnapshot,
    Dashboard,
    DashboardSpec,
    DashboardWidget,
    ModelsResponse,
    QueryResponse,
    SuggestResponse,
} from "./types";

export class AnalysisApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "AnalysisApiError";
        this.status = status;
    }
}

// The backend mixes envelopes: the spec promised { error }, but FastAPI
// HTTPExceptions surface as { detail }. Read both (detail may be a string or
// an object), falling back to raw text / a status string.
export function extractErrorMessage(parsed: unknown, status: number): string {
    if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const candidate = obj.error ?? obj.detail ?? obj.message;
        if (typeof candidate === "string" && candidate) return candidate;
        if (candidate && typeof candidate === "object") {
            try {
                return JSON.stringify(candidate);
            } catch {
                /* ignore */
            }
        }
    }
    if (typeof parsed === "string" && parsed) return parsed;
    return `Request failed (${status})`;
}

async function request<T>(
    path: string,
    init?: { method?: string; body?: unknown; query?: Record<string, unknown> }
): Promise<T> {
    const method = init?.method ?? "GET";
    let url = `/api/analysis${path}`;
    if (init?.query) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(init.query)) {
            if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
        }
        const s = qs.toString();
        if (s) url += `?${s}`;
    }

    let res: Response;
    try {
        res = await fetch(url, {
            method,
            headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
            body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Network error";
        throw new AnalysisApiError(message, 0);
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = text;
        }
    }

    if (!res.ok) {
        throw new AnalysisApiError(extractErrorMessage(parsed, res.status), res.status);
    }

    return parsed as T;
}

// ── Analysis ────────────────────────────────────────────────────────────────

export const getModels = () => request<ModelsResponse>("/models");

export const listAnalyses = (params?: { project_id?: string; chat_id?: string; limit?: number }) =>
    request<{ count: number; analyses: Analysis[] }>("", { query: params });

export const createAnalysis = (body: {
    title: string;
    description?: string;
    project_id?: string;
    chat_id?: string;
    created_by?: string;
    source_config?: Record<string, unknown>;
}) => request<Analysis>("", { method: "POST", body });

export const getAnalysis = (id: string) => request<AnalysisSnapshot>(`/${id}`);

export const updateAnalysis = (
    id: string,
    body: Partial<Pick<Analysis, "title" | "description" | "status">> & {
        source_config?: Record<string, unknown>;
    }
) => request<Analysis>(`/${id}`, { method: "PATCH", body });

export const deleteAnalysis = (id: string) =>
    request<{ deleted: boolean }>(`/${id}`, { method: "DELETE" });

// Duplicate an analysis: a fresh analysis named "<title> copy" with the SAME
// columns (same name/type/config/position) but NO rows, NO cells, and NO
// dashboards — just an empty table with the column structure.
export async function duplicateAnalysis(source: {
    id: string;
    title: string;
    description?: string | null;
}): Promise<Analysis> {
    const snap = await getAnalysis(source.id);
    const created = await createAnalysis({
        title: `${source.title} copy`,
        description: source.description ?? undefined,
    });
    // Recreate columns left-to-right so positions line up with the original.
    const cols = [...(snap.columns ?? [])].sort((a, b) => a.position - b.position);
    for (const c of cols) {
        await createColumn(created.id, {
            name: c.name,
            type: c.type,
            config: (c.config ?? {}) as Record<string, unknown>,
            position: c.position,
        });
    }
    return created;
}

// ── Columns ─────────────────────────────────────────────────────────────────

export const createColumn = (
    analysisId: string,
    body: { name: string; type: "data" | "ai"; config: Record<string, unknown>; position?: number }
) => request<AnalysisColumn>(`/${analysisId}/columns`, { method: "POST", body });

export const updateColumn = (
    columnId: string,
    body: Partial<{ name: string; position: number; config: Record<string, unknown> }>
) => request<AnalysisColumn>(`/columns/${columnId}`, { method: "PATCH", body });

export const deleteColumn = (columnId: string) =>
    request<{ deleted_column: AnalysisColumn }>(`/columns/${columnId}`, { method: "DELETE" });

// ── Rows ────────────────────────────────────────────────────────────────────

export interface AddRowsFromCache {
    source: "opportunity_cache" | "opportunity_observatory";
    limit?: number;
    stage?: string;
    momentum?: string;
    min_amount?: number;
    max_amount?: number;
    account_contains?: string;
    name_contains?: string;
    is_closed?: boolean;
}
export interface AddRowsExplicit {
    rows: Array<{ entity_ref?: string; label?: string; source?: Record<string, unknown> }>;
}

export const addRows = (analysisId: string, body: AddRowsFromCache | AddRowsExplicit) =>
    request<{ source?: string; found?: number; added: number; rows?: AnalysisRow[] }>(
        `/${analysisId}/rows`,
        { method: "POST", body }
    );

export const deleteRow = (rowId: string) =>
    request<{ deleted_row: AnalysisRow }>(`/rows/${rowId}`, { method: "DELETE" });

// ── Cells ───────────────────────────────────────────────────────────────────

export const editCell = (cellId: string, value: string) =>
    request<{ id: string; value: string; status: string; model_used: string }>(`/cells/${cellId}`, {
        method: "PATCH",
        body: { value },
    });

export const rerunCell = (
    analysisId: string,
    body: { cell_id: string } | { row_id: string; column_id: string }
) => request<unknown>(`/${analysisId}/cells/rerun`, { method: "POST", body });

// ── Runs ────────────────────────────────────────────────────────────────────

export const runAll = (analysisId: string) =>
    request<{ status: string }>(`/${analysisId}/run`, { method: "POST", body: {} });

export const stopRun = (analysisId: string) =>
    request<{ status: string }>(`/${analysisId}/stop`, { method: "POST", body: {} });

// Resume an orphaned/stuck run (is_running=false but status still "running").
export const resumeRun = (analysisId: string) =>
    request<{ status: string }>(`/${analysisId}/resume`, { method: "POST", body: {} });

export const listRuns = (analysisId: string, limit?: number) =>
    request<{ is_running: boolean; count: number; runs: import("./types").AnalysisRun[] }>(
        `/${analysisId}/runs`,
        { query: { limit } }
    );

export const queryAnalysis = (analysisId: string, body: { question: string; model?: string }) =>
    request<QueryResponse>(`/${analysisId}/query`, { method: "POST", body });

// ── Agent chat (mutating) + document ingest ──────────────────────────────────
// These hit dedicated proxies (NOT the /api/analysis Bearer proxy) because the
// upstream paths live outside /api/analysis: /api/chat/async and
// /api/documents/upload respectively.

export interface AgentChatBody {
    messages: Array<{ role: string; content: string; images?: string[] }>;
    model?: string;
    chat_id: string;
    project_id?: string;
    system_prompt?: string;
    stream?: boolean;
    headless?: boolean;
}

// Fires the agent run. The agent streams its events into Supabase chat_messages
// (keyed by chat_id) — subscribe there for live output. We don't consume the
// response body; resolving means the run was accepted. Throws on 409 (already
// running) / 503 (capacity) / config errors so the caller can branch.
export async function sendAgentChat(body: AgentChatBody): Promise<void> {
    let res: Response;
    try {
        res = await fetch("/api/analysis-agent", {
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
            /* keep raw text */
        }
        throw new AnalysisApiError(extractErrorMessage(parsed, res.status), res.status);
    }
    // Leave the stream unread — the run continues server-side and emits to
    // chat_messages. Cancel our reader so we don't hold the socket open here.
    res.body?.cancel().catch(() => {});
}

// Persist a user chat turn to chat_messages (so history lives in the DB, not
// localStorage). Best-effort — the message still renders optimistically if this
// fails, and the agent run is never blocked on it.
export async function postUserMessage(chatId: string, content: string): Promise<void> {
    try {
        await fetch("/api/analysis-chat-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, content }),
        });
    } catch {
        /* ignore */
    }
}

export async function uploadDocument(body: {
    content: string;
    name: string;
    project_id?: string;
    chat_id?: string;
}): Promise<{ ok?: boolean; chunks?: number; [k: string]: unknown }> {
    let res: Response;
    try {
        res = await fetch("/api/analysis-docs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
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
    if (!res.ok) {
        throw new AnalysisApiError(extractErrorMessage(parsed, res.status), res.status);
    }
    return (parsed as { ok?: boolean; chunks?: number }) ?? {};
}

// ── Dashboards ──────────────────────────────────────────────────────────────

export const listDashboards = (analysisId: string, limit?: number) =>
    request<{ count: number; dashboards: Dashboard[] }>(`/${analysisId}/dashboards`, {
        query: { limit },
    });

export const getDashboard = (dashboardId: string) =>
    request<Dashboard>(`/dashboards/${dashboardId}`);

export const suggestDashboard = (
    analysisId: string,
    body?: { max_widgets?: number; persist?: boolean; title?: string; description?: string }
) => request<SuggestResponse>(`/${analysisId}/dashboards/suggest`, { method: "POST", body: body ?? {} });

export const createDashboard = (
    analysisId: string,
    body: { title: string; description?: string } & (
        | { widgets: DashboardWidget[] }
        | { spec: DashboardSpec }
    )
) => request<Dashboard>(`/${analysisId}/dashboards`, { method: "POST", body });

export const updateDashboard = (
    dashboardId: string,
    body: Partial<{ title: string; description: string; spec: DashboardSpec; widgets: DashboardWidget[] }>
) => request<Dashboard>(`/dashboards/${dashboardId}`, { method: "PATCH", body });

export const deleteDashboard = (dashboardId: string) =>
    request<{ deleted_dashboard: Dashboard }>(`/dashboards/${dashboardId}`, { method: "DELETE" });
