import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/usage/track-spend
 * No longer needed — today's spend is calculated live from external backend.
 * Kept as a no-op so existing client calls don't 404.
 */
export async function POST(request: NextRequest) {
  return NextResponse.json({ success: true, tracked: 0 });
}
