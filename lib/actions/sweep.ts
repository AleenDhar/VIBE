"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { verifyAdmin } from "@/lib/actions/admin";
import { revalidatePath } from "next/cache";

// Service-role client for the few writes to deal_records (that table grants
// SELECT to authenticated but writes are service-role only). Admin gating is
// enforced in each action BEFORE this is used.
function svc() {
    return createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
    );
}

// 15- or 18-char Salesforce Opportunity id (also matches inside a Lightning URL).
const OPP_RE = /006[A-Za-z0-9]{12}([A-Za-z0-9]{3})?/;

export type TrackedOpp = {
    opp_id: string;
    opp_name: string | null;
    account_name: string | null;
    owner_name: string | null;
    stage: string | null;
    amount: number | null;
    close_date: string | null;
    swept_at: string | null;
};

export type RerunRow = {
    opp_id: string;
    opp_name: string | null;
    account_name: string | null;
    owner_name: string | null;
    source: string | null;
    status: string | null;
    duration_ms: number | null;
    model: string | null;
    total_tokens: number | null;
    cost_usd: number | null;
    error: string | null;
    created_at: string;
};

const RUN_COLS =
    "opp_id, opp_name, account_name, owner_name, source, status, duration_ms, model, total_tokens, cost_usd, error, created_at";

export async function getTrackedOpps(search?: string): Promise<TrackedOpp[]> {
    if (!(await verifyAdmin())) return [];
    const supabase = await createClient();
    let q = supabase
        .from("deal_records")
        .select("opp_id, opp_name, account_name, owner_name, stage, amount, close_date, swept_at")
        .order("swept_at", { ascending: false, nullsFirst: false })
        .limit(2000);
    const s = (search || "").trim();
    if (s) {
        q = q.or(
            `opp_name.ilike.%${s}%,account_name.ilike.%${s}%,owner_name.ilike.%${s}%,opp_id.ilike.%${s}%`
        );
    }
    const { data, error } = await q;
    if (error) {
        console.error("getTrackedOpps:", error.message);
        return [];
    }
    return (data ?? []) as TrackedOpp[];
}

export async function addTrackedOpp(
    input: string
): Promise<{ success: boolean; error?: string; opp_id?: string }> {
    if (!(await verifyAdmin())) return { success: false, error: "Unauthorized" };
    const m = (input || "").match(OPP_RE);
    if (!m) {
        return {
            success: false,
            error: "No Salesforce Opportunity id (006…) found in the input. Paste an id or a Lightning URL.",
        };
    }
    const oppId = m[0].slice(0, 15); // normalize to 15-char key (Lightning URLs carry 18-char ids)
    const { error } = await svc()
        .from("deal_records")
        .upsert(
            {
                opp_id: oppId,
                opp_name: "(added manually — not yet swept)",
                forecast_critical: false,
                record: {},
                updated_at: new Date().toISOString(),
            },
            { onConflict: "opp_id" }
        );
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/sweep");
    return { success: true, opp_id: oppId };
}

export async function removeTrackedOpp(
    oppId: string
): Promise<{ success: boolean; error?: string }> {
    if (!(await verifyAdmin())) return { success: false, error: "Unauthorized" };
    // Match 15- or 18-char stored form by 15-char prefix.
    const prefix = (oppId || "").slice(0, 15);
    if (!prefix) return { success: false, error: "Missing opp id" };
    const { error } = await svc().from("deal_records").delete().like("opp_id", `${prefix}%`);
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/sweep");
    return { success: true };
}

export async function runOppNow(
    oppId: string
): Promise<{ success: boolean; status?: number; error?: string }> {
    if (!(await verifyAdmin())) return { success: false, error: "Unauthorized" };
    const base = (process.env.AGENT_API_URL || "").replace(/\/$/, "");
    const token = process.env.DISPATCH_SECRET || "";
    if (!base) return { success: false, error: "AGENT_API_URL not configured" };
    try {
        const r = await fetch(`${base}/api/deal-engine/sweep/trigger`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ opportunity_id: oppId }),
            cache: "no-store",
        });
        if (!r.ok) {
            const t = await r.text().catch(() => "");
            return { success: false, status: r.status, error: `HTTP ${r.status} ${t.slice(0, 200)}` };
        }
        return { success: true, status: r.status };
    } catch (e: any) {
        return { success: false, error: e?.message || "request failed" };
    }
}

// The 15-char opp keys whose single-opp re-analysis is in flight right now
// (manual "Run now", a Salesforce update trigger, or discovery). The sweep
// admin polls this every few seconds to render a live "Running…" pill. Cheap
// in-memory read on the backend; returns [] on any failure so the UI degrades
// to its last-known state rather than throwing.
export async function getActiveRuns(): Promise<string[]> {
    if (!(await verifyAdmin())) return [];
    const base = (process.env.AGENT_API_URL || "").replace(/\/$/, "");
    const token = process.env.DISPATCH_SECRET || "";
    if (!base) return [];
    try {
        const r = await fetch(`${base}/api/deal-engine/sweep/active`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
        });
        if (!r.ok) return [];
        const j = await r.json().catch(() => ({}));
        const ids = Array.isArray(j?.inflight) ? j.inflight : [];
        return ids.map((s: any) => String(s).slice(0, 15)).filter(Boolean);
    } catch {
        return [];
    }
}

export async function getReruns(limit = 100): Promise<RerunRow[]> {
    if (!(await verifyAdmin())) return [];
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("deal_trigger_runs")
        .select(RUN_COLS)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) {
        console.error("getReruns:", error.message);
        return [];
    }
    return (data ?? []) as RerunRow[];
}

export async function getErrors(limit = 100): Promise<RerunRow[]> {
    if (!(await verifyAdmin())) return [];
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("deal_trigger_runs")
        .select(RUN_COLS)
        .neq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) {
        console.error("getErrors:", error.message);
        return [];
    }
    return (data ?? []) as RerunRow[];
}

export async function getSweepPrompt(): Promise<string> {
    if (!(await verifyAdmin())) return "";
    const supabase = await createClient();
    const { data } = await supabase
        .from("app_config")
        .select("value")
        .eq("key", "deal_sweep_system_prompt")
        .single();
    return (data?.value as string) ?? "";
}

// Save the per-opportunity sweep system prompt. Writes app_config.deal_sweep_
// system_prompt (service-role; admin-gated). The backend's deal_engine_sweep
// reads this on every sweep (falling back to its bundled .md), so edits take
// effect on the next run with no redeploy.
export async function updateSweepPrompt(
    value: string
): Promise<{ success: boolean; error?: string }> {
    if (!(await verifyAdmin())) return { success: false, error: "Unauthorized" };
    if (!value || !value.trim()) return { success: false, error: "Prompt cannot be empty" };
    const { error } = await svc()
        .from("app_config")
        .upsert({ key: "deal_sweep_system_prompt", value }, { onConflict: "key" });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/sweep");
    return { success: true };
}

// ---------------------------------------------------------------------------
// Per-opp drill-in: run history + the analysis that the sweeps produced.
// ---------------------------------------------------------------------------

export type OppRun = RerunRow & {
    opp_id_15?: string | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
};

export type Delta = {
    date: string | null;     // swept date of the run that produced this change (YYYY-MM-DD)
    kind: string | null;     // added | changed | resolved | dormant
    type: string | null;     // stakeholder | requirement | gap | ...
    subject: string | null;
    from: string | null;
    to: string | null;
    source: string | null;
};

export type Move = {
    rank: number | null;
    action: string | null;
    owner: string | null;
    trigger: string | null;
    trigger_date: string | null;
    expected_effect: string | null;
};

export type OppAnalysis = {
    opp_id: string;
    opp_name: string | null;
    account_name: string | null;
    owner_name: string | null;
    stage: string | null;
    amount: number | null;
    close_date: string | null;
    forecast_category: string | null;
    swept_at: string | null;
    analysis_confidence: string | null;
    verdict: string | null;
    headline: string | null;
    moves: Move[];
    deltas: Delta[];
} | null;

const RUN_DETAIL_COLS =
    "opp_id, opp_id_15, opp_name, account_name, owner_name, source, status, duration_ms, model, input_tokens, output_tokens, total_tokens, cost_usd, error, created_at";

// All runs (sweeps / manual / salesforce_trigger) for ONE opportunity, newest first.
export async function getOppRuns(oppId: string, limit = 100): Promise<OppRun[]> {
    if (!(await verifyAdmin())) return [];
    const key = (oppId || "").slice(0, 15);
    if (!key) return [];
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("deal_trigger_runs")
        .select(RUN_DETAIL_COLS)
        .eq("opp_id_15", key)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) {
        console.error("getOppRuns:", error.message);
        return [];
    }
    return (data ?? []) as OppRun[];
}

// The current canonical analysis for ONE opportunity: verdict + recommended
// moves + the full change-log (deltas). deal_records stores only the LATEST full
// analysis, but each delta is tagged with the run date that produced it — so the
// UI can attribute "what changed" to a specific rerun.
export async function getOppAnalysis(oppId: string): Promise<OppAnalysis> {
    if (!(await verifyAdmin())) return null;
    const key = (oppId || "").slice(0, 15);
    if (!key) return null;
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("deal_records")
        .select("opp_id, opp_name, account_name, owner_name, stage, amount, close_date, swept_at, record")
        .like("opp_id", `${key}%`)
        .limit(1);
    const row = (data ?? [])[0] as any;
    if (error || !row) {
        if (error) console.error("getOppAnalysis:", error.message);
        return null;
    }
    const rec: any = row.record || {};
    const hard: any = rec.hard || {};
    const ai: any = rec.ai || {};
    const verdict: any = ai.north_star_verdict || {};
    const movesRaw: any[] = (ai.recommended_moves && ai.recommended_moves.items) || [];
    const deltasRaw: any[] = Array.isArray(rec.deltas) ? rec.deltas : [];
    return {
        opp_id: row.opp_id,
        opp_name: row.opp_name ?? hard.opp_name ?? null,
        account_name: row.account_name ?? hard.account_name ?? null,
        owner_name: row.owner_name ?? hard.owner_name ?? null,
        stage: row.stage ?? hard.stage ?? null,
        amount: row.amount ?? hard.amount ?? null,
        close_date: row.close_date ?? hard.close_date ?? null,
        forecast_category: hard.forecast_category ?? null,
        swept_at: row.swept_at ?? rec.swept_at ?? null,
        analysis_confidence: rec.analysis_confidence ?? null,
        verdict: verdict.verdict ?? null,
        headline: verdict.headline ?? null,
        moves: movesRaw.slice(0, 12).map((m: any) => ({
            rank: m.rank ?? null,
            action: m.action ?? null,
            owner: m.owner ?? null,
            trigger: m.trigger ?? null,
            trigger_date: m.trigger_date ?? null,
            expected_effect: m.expected_effect ?? null,
        })),
        deltas: deltasRaw.slice(0, 500).map((d: any) => ({
            date: d.date ?? null,
            kind: d.kind ?? null,
            type: d.type ?? null,
            subject: d.subject ?? null,
            from: d.from ?? null,
            to: d.to ?? null,
            source: d.source ?? null,
        })),
    };
}
