import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET  - Get the global daily credit setting
 * POST - Update the global daily credit (admin/super_admin only)
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: setting } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "default_daily_credit")
    .single();

  return NextResponse.json({
    default_daily_credit: setting ? Number(setting.value) : 50,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { default_daily_credit } = body;

  const credit = Number(default_daily_credit);
  if (isNaN(credit) || credit < 0) {
    return NextResponse.json(
      { error: "default_daily_credit must be a positive number" },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("app_config").upsert({
    key: "default_daily_credit",
    value: String(credit),
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, default_daily_credit: credit });
}
