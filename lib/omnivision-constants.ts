/**
 * Omnivision constants.
 *
 * Kept in a non-"use server" module so they can be imported by both server
 * actions (lib/actions/admin.ts) and client components (components/admin/
 * OmnivisionDashboard.tsx). Server action modules can only export async
 * functions, so value exports like UUID sentinels must live elsewhere.
 */

/**
 * Sentinel UUID used to represent the synthetic "(unattributed)" bucket
 * returned by the `get_omnivision_user_aggregates` RPC for chats whose
 * `user_id IS NULL`. The dashboard excludes this row from the "users"
 * headline count while still counting its chats.
 */
export const SENTINEL_ORPHAN_USER_ID = "00000000-0000-0000-0000-000000000000";
