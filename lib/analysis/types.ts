// =============================================================================
// Agentic Analysis Workspace — shared types
// =============================================================================
// These mirror the FastAPI backend's payloads. The backend owns all logic,
// persistence, and validation; the frontend only renders and calls the API.
// Keep these in sync with the documented data model / dashboard spec contract.
// =============================================================================

export type ColumnType = "data" | "ai";

// config shape differs by column type. Both are free-form on the wire, but we
// narrow the bits we actually read.
export interface DataColumnConfig {
    source_field?: string; // copies row.source[source_field]
    [k: string]: unknown;
}

export interface AiColumnConfig {
    system_prompt?: string;
    model?: string; // "provider:model"
    instructions?: string;
    input_columns?: string[]; // other column ids whose cell values feed this one
    [k: string]: unknown;
}

export type ColumnConfig = DataColumnConfig & AiColumnConfig;

export interface AnalysisColumn {
    id: string;
    name: string;
    type: ColumnType;
    position: number;
    config: ColumnConfig;
}

export interface AnalysisRow {
    id: string;
    label: string;
    entity_ref: string | null;
    position: number;
    source: Record<string, unknown> | null;
}

export type CellStatus = "empty" | "pending" | "running" | "done" | "error";

export interface AnalysisCell {
    id: string;
    row_id: string;
    column_id: string;
    value: string | null; // always text on the wire; parse client-side
    status: CellStatus;
    model_used: string | null;
    tokens_used: number | null;
    error?: string | null;
    // realtime payloads also carry analysis_id; not needed for rendering.
    analysis_id?: string;
}

export type RunStatus = "running" | "done" | "error" | "stopped";

export interface AnalysisRun {
    id: string;
    analysis_id: string;
    status: RunStatus;
    cells_total?: number | null;
    cells_done?: number | null;
    cells_error?: number | null;
    started_at?: string | null;
    finished_at?: string | null;
    created_at?: string | null;
}

export type AnalysisStatus = string;

export interface Analysis {
    id: string;
    title: string;
    description: string | null;
    status: AnalysisStatus | null;
    project_id: string | null;
    chat_id: string | null;
    created_by: string | null;
    source_config: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
}

// GET /api/analysis/{id}
export interface AnalysisSnapshot {
    analysis: Analysis;
    columns: AnalysisColumn[];
    rows: AnalysisRow[];
    cells: AnalysisCell[];
    runs: AnalysisRun[];
    latest_run: AnalysisRun | null;
}

// GET /api/analysis/models
export interface ModelOption {
    id: string; // "provider:model"
    label?: string;
    name?: string;
    provider?: string;
}
export interface ModelsResponse {
    default: string | null;
    models: ModelOption[];
    providers: string[];
}

// ── Dashboards ──────────────────────────────────────────────────────────────

export type WidgetType = "bar" | "line" | "area" | "scatter" | "pie" | "kpi" | "table";

export type Aggregation = "sum" | "avg" | "count" | "min" | "max" | "median" | "none";

export interface ChannelBinding {
    column_id: string;
    aggregation?: Aggregation;
}

export interface WidgetEncoding {
    x?: ChannelBinding;
    y?: ChannelBinding;
    series?: ChannelBinding;
    group_by?: ChannelBinding;
    value?: ChannelBinding;
}

export interface WidgetLayout {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface WidgetOptions {
    stacked?: boolean;
    legend?: boolean;
    color?: string;
    colors?: string[];
    [k: string]: unknown;
}

export interface DashboardWidget {
    id: string;
    type: WidgetType;
    title?: string;
    encoding?: WidgetEncoding;
    columns?: string[]; // table widgets
    layout?: WidgetLayout;
    options?: WidgetOptions;
}

export interface DashboardSpec {
    version: number;
    title?: string;
    layout?: string;
    widgets: DashboardWidget[];
}

export interface Dashboard {
    id: string;
    analysis_id: string;
    project_id: string | null;
    title: string;
    description: string | null;
    spec: DashboardSpec;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

// POST /api/analysis/{id}/dashboards/suggest
export type SuggestResponse =
    | { persisted: false; analysis_id: string; spec: DashboardSpec }
    | { persisted: true; dashboard: Dashboard };

// POST /api/analysis/{id}/query
export interface QueryResponse {
    answer: string;
    [k: string]: unknown;
}

// Standard backend error envelope.
export interface ApiError {
    error: string;
}
