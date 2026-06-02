"use client";

import * as React from "react";
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    LineChart,
    Line,
    AreaChart,
    Area,
    ScatterChart,
    Scatter,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    ZAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from "recharts";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { DashboardWidget } from "@/lib/analysis/types";
import {
    buildWidgetDataset,
    formatNumber,
    type WidgetContext,
} from "@/lib/analysis/aggregate";

const COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444", "#ec4899", "#6366f1", "#14b8a6"];

function colorAt(i: number, options?: { color?: string; colors?: string[] }): string {
    if (options?.colors && options.colors[i]) return options.colors[i];
    if (i === 0 && options?.color) return options.color;
    return COLORS[i % COLORS.length];
}

// ── per-widget error boundary ────────────────────────────────────────────────
// One malformed widget must never crash the whole board.
class WidgetErrorBoundary extends React.Component<
    { children: React.ReactNode; title?: string },
    { error: Error | null }
> {
    constructor(props: { children: React.ReactNode; title?: string }) {
        super(props);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        if (this.state.error) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <div className="text-xs text-muted-foreground">
                        Couldn&apos;t render &ldquo;{this.props.title ?? "widget"}&rdquo;.
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 font-mono">
                        {this.state.error.message}
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

function Centered({ children }: { children: React.ReactNode }) {
    return <div className="flex h-full items-center justify-center text-center px-4">{children}</div>;
}

interface Props {
    widget: DashboardWidget;
    ctx: WidgetContext;
    isRunning: boolean;
}

function ChartBody({ widget, ctx, isRunning }: Props) {
    const dataset = React.useMemo(() => buildWidgetDataset(widget, ctx), [widget, ctx]);
    const options = widget.options ?? {};
    const showLegend = options.legend !== false;

    if (dataset.kind === "empty") {
        return (
            <Centered>
                {isRunning ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-sky-600 dark:text-sky-300">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> computing…
                    </span>
                ) : (
                    <span className="text-xs text-muted-foreground/60">{dataset.reason}</span>
                )}
            </Centered>
        );
    }

    switch (dataset.kind) {
        case "kpi":
            return (
                <div className="flex h-full flex-col items-center justify-center">
                    <div className="text-4xl font-semibold tracking-tight text-foreground">
                        {formatNumber(dataset.value)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{dataset.label}</div>
                </div>
            );

        case "table":
            return (
                <div className="h-full overflow-auto">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                            <tr>
                                {dataset.columns.map((c) => (
                                    <th key={c.id} className="px-2 py-1.5 text-left font-medium">
                                        {c.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                            {dataset.rows.map((row, i) => (
                                <tr key={i}>
                                    {row.map((cell, j) => (
                                        <td
                                            key={j}
                                            className="px-2 py-1.5 align-top text-foreground/90 max-w-[200px] truncate"
                                            title={cell}
                                        >
                                            {cell || <span className="text-muted-foreground/40">—</span>}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );

        case "scatter":
            return (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                        <XAxis
                            type="number"
                            dataKey="x"
                            name={dataset.xLabel}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v) => formatNumber(Number(v))}
                        />
                        <YAxis
                            type="number"
                            dataKey="y"
                            name={dataset.yLabel}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v) => formatNumber(Number(v))}
                        />
                        <ZAxis range={[60, 60]} />
                        <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                        <Scatter data={dataset.points} fill={colorAt(0, options)} />
                    </ScatterChart>
                </ResponsiveContainer>
            );

        case "pie":
            return (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <PieChart>
                        <Pie
                            data={dataset.data}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="value"
                            nameKey="name"
                        >
                            {dataset.data.map((_, i) => (
                                <Cell key={i} fill={colorAt(i, options)} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(v) => formatNumber(Number(v))} />
                        {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
                    </PieChart>
                </ResponsiveContainer>
            );

        case "categorical": {
            const { data, series, xKey } = dataset;
            const stacked = options.stacked === true;
            const common = (
                <>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey={xKey} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(Number(v))} />
                    <Tooltip formatter={(v) => formatNumber(Number(v))} />
                    {showLegend && series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                </>
            );

            if (widget.type === "line") {
                return (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <LineChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
                            {common}
                            {series.map((s, i) => (
                                <Line
                                    key={s}
                                    type="monotone"
                                    dataKey={s}
                                    name={s}
                                    stroke={colorAt(i, options)}
                                    strokeWidth={2}
                                    dot={false}
                                    connectNulls
                                />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                );
            }
            if (widget.type === "area") {
                return (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <AreaChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
                            {common}
                            {series.map((s, i) => (
                                <Area
                                    key={s}
                                    type="monotone"
                                    dataKey={s}
                                    name={s}
                                    stackId={stacked ? "1" : undefined}
                                    stroke={colorAt(i, options)}
                                    fill={colorAt(i, options)}
                                    fillOpacity={0.3}
                                    connectNulls
                                />
                            ))}
                        </AreaChart>
                    </ResponsiveContainer>
                );
            }
            // bar
            return (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                    <BarChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
                        {common}
                        {series.map((s, i) => (
                            <Bar
                                key={s}
                                dataKey={s}
                                name={s}
                                stackId={stacked ? "1" : undefined}
                                fill={colorAt(i, options)}
                                radius={stacked ? undefined : [3, 3, 0, 0]}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            );
        }

        default:
            return (
                <Centered>
                    <span className="text-xs text-muted-foreground/60">Unsupported widget.</span>
                </Centered>
            );
    }
}

export function WidgetRenderer({ widget, ctx, isRunning }: Props) {
    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pt-2.5 pb-1 text-xs font-medium text-foreground/90 truncate shrink-0">
                {widget.title || widget.type}
            </div>
            <div className="flex-1 min-h-0 px-1 pb-2">
                <WidgetErrorBoundary title={widget.title}>
                    <ChartBody widget={widget} ctx={ctx} isRunning={isRunning} />
                </WidgetErrorBoundary>
            </div>
        </div>
    );
}
