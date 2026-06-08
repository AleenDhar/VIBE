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
    const oppId = m[0];
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
