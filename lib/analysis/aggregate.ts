// =============================================================================
// Widget aggregation engine
// =============================================================================
// A widget carries no data — it references analysis columns by id. To draw one
// we join the analysis cells on those column_ids across all rows, parse text
// values to numbers for numeric channels, group by the category channel, and
// aggregate client-side. The backend guarantees every column_id exists and the
// spec is structurally valid, so we focus on the numeric/grouping logic only.
// =============================================================================

import type {
    Aggregation,
    AnalysisColumn,
    AnalysisRow,
    DashboardWidget,
} from "./types";

// (row_id:column_id) -> text value, built once per render by the caller.
export type CellValueLookup = (rowId: string, columnId: string) => string | null;

export interface WidgetContext {
    columns: AnalysisColumn[];
    rows: AnalysisRow[]; // expected pre-sorted by position
    valueOf: CellValueLookup;
}

const EMPTY_LABEL = "(empty)";

export function parseNumeric(value: string | null | undefined): number | null {
    if (value == null) return null;
    const s = String(value).trim();
    if (!s) return null;
    // Tolerate currency/percent/thousands formatting: "$12,000" -> 12000.
    const cleaned = s.replace(/[,$%\s]/g, "");
    if (!cleaned || !/[0-9]/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

export function categoryLabel(value: string | null | undefined): string {
    const s = (value ?? "").trim();
    return s === "" ? EMPTY_LABEL : s;
}

// Aggregate a list of numbers. `count` is handled by the caller (it counts
// rows, not parsed numbers), so it should never reach here.
function aggregateNumbers(nums: number[], agg: Aggregation): number | null {
    if (agg === "none") return nums.length ? nums[0] : null;
    if (nums.length === 0) return null;
    switch (agg) {
        case "sum":
            return nums.reduce((a, b) => a + b, 0);
        case "avg":
            return nums.reduce((a, b) => a + b, 0) / nums.length;
        case "min":
            return Math.min(...nums);
        case "max":
            return Math.max(...nums);
        case "median": {
            const sorted = [...nums].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        }
        default:
            return null;
    }
}

function columnById(ctx: WidgetContext, id: string | undefined): AnalysisColumn | undefined {
    if (!id) return undefined;
    return ctx.columns.find((c) => c.id === id);
}

export interface CategoricalDataset {
    kind: "categorical";
    xKey: "__x";
    xLabel: string;
    series: string[]; // dataKeys for recharts series
    data: Array<Record<string, string | number | null>>;
}
export interface ScatterDataset {
    kind: "scatter";
    xLabel: string;
    yLabel: string;
    points: Array<{ x: number; y: number; label: string }>;
}
export interface PieDataset {
    kind: "pie";
    data: Array<{ name: string; value: number }>;
}
export interface KpiDataset {
    kind: "kpi";
    value: number | null;
    label: string;
}
export interface TableDataset {
    kind: "table";
    columns: Array<{ id: string; name: string }>;
    rows: string[][];
}
export interface EmptyDataset {
    kind: "empty";
    reason: string;
}

export type WidgetDataset =
    | CategoricalDataset
    | ScatterDataset
    | PieDataset
    | KpiDataset
    | TableDataset
    | EmptyDataset;

// ── per-type builders ────────────────────────────────────────────────────────

function buildCategorical(widget: DashboardWidget, ctx: WidgetContext): WidgetDataset {
    const enc = widget.encoding ?? {};
    const xCol = columnById(ctx, enc.x?.column_id);
    const yBinding = enc.y;
    if (!xCol || !yBinding) return { kind: "empty", reason: "Missing x or y channel." };
    const yCol = columnById(ctx, yBinding.column_id);
    if (!yCol) return { kind: "empty", reason: "Unknown y column." };

    const agg: Aggregation = yBinding.aggregation ?? "sum";
    const seriesCol = columnById(ctx, enc.series?.column_id);

    // category -> seriesKey -> accumulated y values (or row count for `count`)
    const groups = new Map<string, Map<string, number[]>>();
    const seriesKeys = new Set<string>();
    const defaultSeriesKey = yCol.name || "value";

    for (const row of ctx.rows) {
        const xVal = categoryLabel(ctx.valueOf(row.id, xCol.id));
        const seriesKey = seriesCol
            ? categoryLabel(ctx.valueOf(row.id, seriesCol.id))
            : defaultSeriesKey;
        seriesKeys.add(seriesKey);

        if (!groups.has(xVal)) groups.set(xVal, new Map());
        const bucket = groups.get(xVal)!;
        if (!bucket.has(seriesKey)) bucket.set(seriesKey, []);

        if (agg === "count") {
            // count rows regardless of value parseability
            bucket.get(seriesKey)!.push(1);
        } else {
            const n = parseNumeric(ctx.valueOf(row.id, yCol.id));
            if (n !== null) bucket.get(seriesKey)!.push(n);
        }
    }

    const series = Array.from(seriesKeys);
    const data: Array<Record<string, string | number | null>> = [];
    for (const [category, bucket] of groups) {
        const entry: Record<string, string | number | null> = { __x: category };
        for (const key of series) {
            const nums = bucket.get(key) ?? [];
            entry[key] = agg === "count" ? nums.length : aggregateNumbers(nums, agg);
        }
        data.push(entry);
    }

    if (data.length === 0) return { kind: "empty", reason: "No data yet." };
    return { kind: "categorical", xKey: "__x", xLabel: xCol.name, series, data };
}

function buildScatter(widget: DashboardWidget, ctx: WidgetContext): WidgetDataset {
    const enc = widget.encoding ?? {};
    const xCol = columnById(ctx, enc.x?.column_id);
    const yCol = columnById(ctx, enc.y?.column_id);
    if (!xCol || !yCol) return { kind: "empty", reason: "Missing x or y channel." };

    const points: Array<{ x: number; y: number; label: string }> = [];
    for (const row of ctx.rows) {
        const x = parseNumeric(ctx.valueOf(row.id, xCol.id));
        const y = parseNumeric(ctx.valueOf(row.id, yCol.id));
        if (x !== null && y !== null) points.push({ x, y, label: row.label });
    }
    if (points.length === 0) return { kind: "empty", reason: "No numeric pairs yet." };
    return { kind: "scatter", xLabel: xCol.name, yLabel: yCol.name, points };
}

function buildPie(widget: DashboardWidget, ctx: WidgetContext): WidgetDataset {
    const enc = widget.encoding ?? {};
    const valueBinding = enc.value;
    if (!valueBinding) return { kind: "empty", reason: "Missing value channel." };
    const valueCol = columnById(ctx, valueBinding.column_id);
    if (!valueCol) return { kind: "empty", reason: "Unknown value column." };
    const agg: Aggregation = valueBinding.aggregation ?? "sum";
    const catCol = columnById(ctx, enc.series?.column_id) ?? columnById(ctx, enc.group_by?.column_id);

    if (!catCol) {
        // No category — one slice per row.
        const data: Array<{ name: string; value: number }> = [];
        for (const row of ctx.rows) {
            const n = parseNumeric(ctx.valueOf(row.id, valueCol.id));
            if (n !== null) data.push({ name: row.label, value: n });
        }
        return data.length ? { kind: "pie", data } : { kind: "empty", reason: "No data yet." };
    }

    const groups = new Map<string, number[]>();
    for (const row of ctx.rows) {
        const cat = categoryLabel(ctx.valueOf(row.id, catCol.id));
        if (!groups.has(cat)) groups.set(cat, []);
        if (agg === "count") groups.get(cat)!.push(1);
        else {
            const n = parseNumeric(ctx.valueOf(row.id, valueCol.id));
            if (n !== null) groups.get(cat)!.push(n);
        }
    }
    const data: Array<{ name: string; value: number }> = [];
    for (const [name, nums] of groups) {
        const value = agg === "count" ? nums.length : aggregateNumbers(nums, agg);
        if (value !== null) data.push({ name, value });
    }
    return data.length ? { kind: "pie", data } : { kind: "empty", reason: "No data yet." };
}

function buildKpi(widget: DashboardWidget, ctx: WidgetContext): WidgetDataset {
    const enc = widget.encoding ?? {};
    const binding = enc.value;
    const label = widget.title || "Value";
    if (!binding) return { kind: "empty", reason: "Missing value channel." };
    const col = columnById(ctx, binding.column_id);
    if (!col) return { kind: "empty", reason: "Unknown value column." };
    const agg: Aggregation = binding.aggregation ?? "sum";

    if (agg === "count") {
        // count of rows that have any value for the column
        let count = 0;
        for (const row of ctx.rows) {
            const v = ctx.valueOf(row.id, col.id);
            if (v != null && String(v).trim() !== "") count++;
        }
        return { kind: "kpi", value: count, label };
    }

    const nums: number[] = [];
    for (const row of ctx.rows) {
        const n = parseNumeric(ctx.valueOf(row.id, col.id));
        if (n !== null) nums.push(n);
    }
    return { kind: "kpi", value: aggregateNumbers(nums, agg), label };
}

function buildTable(widget: DashboardWidget, ctx: WidgetContext): WidgetDataset {
    const ids = widget.columns ?? [];
    const cols = ids
        .map((id) => columnById(ctx, id))
        .filter((c): c is AnalysisColumn => !!c)
        .map((c) => ({ id: c.id, name: c.name }));
    if (cols.length === 0) return { kind: "empty", reason: "No columns specified." };

    const rows = ctx.rows.map((row) => cols.map((c) => ctx.valueOf(row.id, c.id) ?? ""));
    return { kind: "table", columns: cols, rows };
}

// ── public entry ─────────────────────────────────────────────────────────────

export function buildWidgetDataset(widget: DashboardWidget, ctx: WidgetContext): WidgetDataset {
    switch (widget.type) {
        case "bar":
        case "line":
        case "area":
            return buildCategorical(widget, ctx);
        case "scatter":
            return buildScatter(widget, ctx);
        case "pie":
            return buildPie(widget, ctx);
        case "kpi":
            return buildKpi(widget, ctx);
        case "table":
            return buildTable(widget, ctx);
        default:
            return { kind: "empty", reason: `Unsupported widget type: ${widget.type}` };
    }
}

// Compact numeric formatter for KPI / axis labels.
export function formatNumber(n: number | null): string {
    if (n === null || !Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2);
}
