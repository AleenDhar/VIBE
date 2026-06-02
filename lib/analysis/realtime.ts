"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// Analysis realtime client
// =============================================================================
// Live reads come straight from Supabase with the anon key (no backend
// round-trip). The analysis tables may live in a different Supabase project
// than the main app, so we read dedicated env vars and fall back to the app's
// existing ones when they're not set.
//
// Writes never go through this client — they go through the Bearer REST API
// (lib/analysis/api.ts). This client is SELECT + realtime only.
// =============================================================================

const URL =
    process.env.NEXT_PUBLIC_ANALYSIS_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
const ANON =
    process.env.NEXT_PUBLIC_ANALYSIS_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

let client: SupabaseClient | null = null;

export function analysisRealtimeClient(): SupabaseClient {
    if (!client) {
        client = createClient(URL, ANON, {
            auth: { persistSession: false },
            realtime: { params: { eventsPerSecond: 20 } },
        });
    }
    return client;
}

export type ChangeEvent = "INSERT" | "UPDATE" | "DELETE";

export interface TableChange<T> {
    table: string;
    eventType: ChangeEvent;
    new: T | null;
    old: Partial<T> | null;
}

// Subscribe to all analysis-scoped tables for one analysis in a single
// channel. The callback receives normalized change objects. Returns an
// unsubscribe function.
export function subscribeToAnalysis(
    analysisId: string,
    onChange: (change: TableChange<Record<string, unknown>>) => void
): () => void {
    const supabase = analysisRealtimeClient();
    const tables = [
        "analysis_cells",
        "analysis_rows",
        "analysis_columns",
        "analysis_runs",
        "dashboards",
    ];

    const channel = supabase.channel(`analysis:${analysisId}`);

    // supabase-js's postgres_changes overload typing is awkward to satisfy with
    // a dynamic table list; cast the `.on` to a permissive signature.
    const on = channel.on.bind(channel) as (
        type: "postgres_changes",
        filter: { event: "*"; schema: string; table: string; filter: string },
        cb: (payload: {
            eventType: ChangeEvent;
            new: Record<string, unknown> | null;
            old: Record<string, unknown> | null;
        }) => void
    ) => void;

    for (const table of tables) {
        on(
            "postgres_changes",
            { event: "*", schema: "public", table, filter: `analysis_id=eq.${analysisId}` },
            (payload) => {
                onChange({
                    table,
                    eventType: payload.eventType,
                    new: payload.new && Object.keys(payload.new).length ? payload.new : null,
                    old: payload.old && Object.keys(payload.old).length ? payload.old : null,
                });
            }
        );
    }

    channel.subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
}
