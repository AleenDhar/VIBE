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

/**
 * Sentinel error message thrown by searchOmnivisionMessages when the
 * underlying Postgres query is cancelled by statement_timeout. The UI
 * pattern-matches on this to render a "search timed out" hint that's
 * distinct from a generic failure or a legitimate empty result.
 *
 * Kept here rather than in lib/actions/admin.ts because that module has
 * a "use server" directive at the top, which forbids non-async exports.
 */
export const SEARCH_TIMEOUT_SENTINEL = "OMNIVISION_SEARCH_TIMEOUT";
