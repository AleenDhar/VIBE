"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import * as api from "./api";
import { AnalysisApiError } from "./api";
import { subscribeToAnalysis, type TableChange } from "./realtime";
import type {
    Analysis,
    AnalysisCell,
    AnalysisColumn,
    AnalysisRow,
    AnalysisRun,
    Dashboard,
} from "./types";

// =============================================================================
// useAnalysisData — single source of truth for one analysis workspace
// =============================================================================
// Loads the full snapshot + dashboards once via the Bearer REST API, then
// applies Supabase realtime deltas on top (cells/rows/columns/runs/dashboards).
// Per the spec, analysis_runs — not cell counts — is the source of truth for
// run progress/completion.
// =============================================================================

interface State {
    analysis: Analysis | null;
    columns: AnalysisColumn[];
    rows: AnalysisRow[];
    cells: AnalysisCell[];
    runs: AnalysisRun[];
    latestRun: AnalysisRun | null;
    dashboards: Dashboard[];
    loading: boolean;
    error: string | null;
}

const initialState: State = {
    analysis: null,
    columns: [],
    rows: [],
    cells: [],
    runs: [],
    latestRun: null,
    dashboards: [],
    loading: true,
    error: null,
};

type Action =
    | { type: "loading" }
    | { type: "error"; error: string }
    | {
          type: "init";
          analysis: Analysis;
          columns: AnalysisColumn[];
          rows: AnalysisRow[];
          cells: AnalysisCell[];
          runs: AnalysisRun[];
          latestRun: AnalysisRun | null;
      }
    | { type: "init_dashboards"; dashboards: Dashboard[] }
    | { type: "row_change"; change: TableChange<AnalysisRow & { id: string }> }
    | { type: "column_change"; change: TableChange<AnalysisColumn & { id: string }> }
    | { type: "cell_change"; change: TableChange<AnalysisCell & { id: string }> }
    | { type: "run_change"; change: TableChange<AnalysisRun & { id: string }> }
    | { type: "dashboard_change"; change: TableChange<Dashboard & { id: string }> };

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx === -1) return [...list, item];
    const next = [...list];
    next[idx] = { ...next[idx], ...item };
    return next;
}

function bySortPosition<T extends { position: number }>(a: T, b: T) {
    return a.position - b.position;
}

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case "loading":
            return { ...state, loading: true, error: null };
        case "error":
            return { ...state, loading: false, error: action.error };
        case "init":
            return {
                ...state,
                analysis: action.analysis,
                columns: [...action.columns].sort(bySortPosition),
                rows: [...action.rows].sort(bySortPosition),
                cells: action.cells,
                runs: action.runs,
                latestRun: action.latestRun,
                loading: false,
                error: null,
            };
        case "init_dashboards":
            return { ...state, dashboards: action.dashboards };

        case "row_change": {
            const { eventType, new: row, old } = action.change;
            if (eventType === "DELETE") {
                const id = (old?.id ?? row?.id) as string | undefined;
                if (!id) return state;
                return { ...state, rows: state.rows.filter((r) => r.id !== id) };
            }
            if (!row) return state;
            return { ...state, rows: upsertById(state.rows, row).sort(bySortPosition) };
        }
        case "column_change": {
            const { eventType, new: col, old } = action.change;
            if (eventType === "DELETE") {
                const id = (old?.id ?? col?.id) as string | undefined;
                if (!id) return state;
                return { ...state, columns: state.columns.filter((c) => c.id !== id) };
            }
            if (!col) return state;
            return { ...state, columns: upsertById(state.columns, col).sort(bySortPosition) };
        }
        case "cell_change": {
            const { eventType, new: cell, old } = action.change;
            if (eventType === "DELETE") {
                const id = (old?.id ?? cell?.id) as string | undefined;
                if (!id) return state;
                return { ...state, cells: state.cells.filter((c) => c.id !== id) };
            }
            if (!cell) return state;
            return { ...state, cells: upsertById(state.cells, cell) };
        }
        case "run_change": {
            const { new: run } = action.change;
            if (!run) return state;
            const runs = upsertById(state.runs, run);
            // latest run = most recent by created_at/started_at; the changed run
            // is almost always the active/latest one, so prefer it when it is
            // running or newer.
            const latest =
                !state.latestRun ||
                run.id === state.latestRun.id ||
                run.status === "running"
                    ? run
                    : state.latestRun;
            return { ...state, runs, latestRun: latest };
        }
        case "dashboard_change": {
            const { eventType, new: dash, old } = action.change;
            if (eventType === "DELETE") {
                const id = (old?.id ?? dash?.id) as string | undefined;
                if (!id) return state;
                return { ...state, dashboards: state.dashboards.filter((d) => d.id !== id) };
            }
            if (!dash) return state;
            // newest first
            const next = upsertById(state.dashboards, dash).sort(
                (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
            );
            return { ...state, dashboards: next };
        }
        default:
            return state;
    }
}

export interface ActivityEntry {
    id: string;
    ts: number;
    text: string;
}

export interface AnalysisData extends State {
    /** O(1) cell lookup by row+column. */
    cellFor: (rowId: string, columnId: string) => AnalysisCell | undefined;
    valueOf: (rowId: string, columnId: string) => string | null;
    isRunning: boolean;
    /** Live, human-readable feed of what the agent is doing (from realtime). */
    activity: ActivityEntry[];
    refetch: () => Promise<void>;
    refetchDashboards: () => Promise<void>;
}

export function useAnalysisData(analysisId: string): AnalysisData {
    const [state, dispatch] = useReducer(reducer, initialState);
    const mounted = useRef(true);

    // Agent activity feed. Row INSERTs arrive in bursts (e.g. 100 at once), so
    // we batch them into a single "Added N rows" entry; columns and run-status
    // transitions are low-volume and logged directly.
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const rowBatch = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | null }>({
        count: 0,
        timer: null,
    });
    const lastRunStatus = useRef<string | null>(null);

    const pushActivity = useCallback((text: string) => {
        if (!mounted.current) return;
        setActivity((prev) => {
            const entry: ActivityEntry = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                ts: Date.now(),
                text,
            };
            return [...prev.slice(-49), entry];
        });
    }, []);

    const load = useCallback(async () => {
        try {
            const snap = await api.getAnalysis(analysisId);
            if (!mounted.current) return;
            dispatch({
                type: "init",
                analysis: snap.analysis,
                columns: snap.columns ?? [],
                rows: snap.rows ?? [],
                cells: snap.cells ?? [],
                runs: snap.runs ?? [],
                latestRun: snap.latest_run ?? null,
            });
        } catch (err) {
            if (!mounted.current) return;
            const message =
                err instanceof AnalysisApiError ? err.message : "Failed to load analysis.";
            dispatch({ type: "error", error: message });
        }
    }, [analysisId]);

    const loadDashboards = useCallback(async () => {
        try {
            const res = await api.listDashboards(analysisId);
            if (!mounted.current) return;
            dispatch({ type: "init_dashboards", dashboards: res.dashboards ?? [] });
        } catch {
            // Dashboards are non-fatal to the sheet view; swallow and let the
            // dashboard pane show its own empty/error state on next interaction.
        }
    }, [analysisId]);

    useEffect(() => {
        mounted.current = true;
        dispatch({ type: "loading" });
        load();
        loadDashboards();
        return () => {
            mounted.current = false;
        };
    }, [load, loadDashboards]);

    // Realtime deltas.
    useEffect(() => {
        const unsubscribe = subscribeToAnalysis(analysisId, (change) => {
            if (!mounted.current) return;
            switch (change.table) {
                case "analysis_rows":
                    dispatch({ type: "row_change", change: change as never });
                    if (change.eventType === "INSERT") {
                        rowBatch.current.count += 1;
                        if (rowBatch.current.timer) clearTimeout(rowBatch.current.timer);
                        rowBatch.current.timer = setTimeout(() => {
                            const n = rowBatch.current.count;
                            rowBatch.current.count = 0;
                            rowBatch.current.timer = null;
                            if (n > 0) pushActivity(`Added ${n} row${n === 1 ? "" : "s"}`);
                        }, 600);
                    }
                    break;
                case "analysis_columns":
                    dispatch({ type: "column_change", change: change as never });
                    if (change.eventType === "INSERT" && change.new) {
                        const c = change.new as { name?: string; type?: string };
                        pushActivity(
                            `Added ${c.type === "ai" ? "AI" : "data"} column "${c.name ?? "untitled"}"`
                        );
                    }
                    break;
                case "analysis_cells":
                    dispatch({ type: "cell_change", change: change as never });
                    break;
                case "analysis_runs": {
                    dispatch({ type: "run_change", change: change as never });
                    const st = (change.new as { status?: string } | null)?.status ?? null;
                    if (st && st !== lastRunStatus.current) {
                        lastRunStatus.current = st;
                        const label =
                            st === "running"
                                ? "Run started"
                                : st === "done"
                                  ? "Run finished"
                                  : st === "stopped"
                                    ? "Run stopped"
                                    : st === "error"
                                      ? "Run errored"
                                      : `Run ${st}`;
                        pushActivity(label);
                    }
                    break;
                }
                case "dashboards":
                    dispatch({ type: "dashboard_change", change: change as never });
                    if (change.eventType === "INSERT" && change.new) {
                        const d = change.new as { title?: string };
                        pushActivity(`Created dashboard "${d.title ?? "untitled"}"`);
                    }
                    break;
            }
        });
        return unsubscribe;
    }, [analysisId, pushActivity]);

    // (row:col) -> cell index, rebuilt only when cells change.
    const cellIndex = useMemo(() => {
        const map = new Map<string, AnalysisCell>();
        for (const c of state.cells) map.set(`${c.row_id}:${c.column_id}`, c);
        return map;
    }, [state.cells]);

    const cellFor = useCallback(
        (rowId: string, columnId: string) => cellIndex.get(`${rowId}:${columnId}`),
        [cellIndex]
    );
    const valueOf = useCallback(
        (rowId: string, columnId: string) => cellIndex.get(`${rowId}:${columnId}`)?.value ?? null,
        [cellIndex]
    );

    const isRunning = state.latestRun?.status === "running";

    return {
        ...state,
        cellFor,
        valueOf,
        isRunning,
        activity,
        refetch: load,
        refetchDashboards: loadDashboards,
    };
}
