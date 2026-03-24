import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET  - List all users with their daily spend caps
 * POST - Update a user's daily spend cap (admin/super_admin only)
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

  const { data: users, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, daily_spend_cap")
    .order("full_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users });
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
  const { user_id, daily_spend_cap } = body;

  if (!user_id) {
    return NextResponse.json(
      { error: "user_id is required" },
      { status: 400 }
    );
  }

  // null means no cap, otherwise must be a positive number
  const capValue =
    daily_spend_cap === null || daily_spend_cap === ""
      ? null
      : Number(daily_spend_cap);

  if (capValue !== null && (isNaN(capValue) || capValue < 0)) {
    return NextResponse.json(
      { error: "daily_spend_cap must be a positive number or null" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ daily_spend_cap: capValue })
    .eq("id", user_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, daily_spend_cap: capValue });
}
