import { supabaseAdmin } from "./supabase-admin";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";

/**
 * "Today" for a date on the CLIENT's calendar (plan placement, promotion,
 * streaks, check-in window), per the locked timezone model — see
 * docs/ARCHITECTURE.md "Timezone model".
 *
 * Resolution: client timezone → coach timezone → UTC. A stored 'UTC' is the
 * "never device-synced" sentinel (the column default; the device sync of
 * Session 7.81 writes real region zones), so a coach placing a plan before
 * the client has ever opened the portal anchors to their own zone instead of
 * the server clock. Accepted edge: a device that genuinely reports literal
 * "UTC" is indistinguishable from unsynced and gets the coach fallback here —
 * sites that read client.timezone directly are unaffected.
 *
 * Prefer the pure helpers (getTodayDateStringInTimezone / getTodayInTimezone)
 * when a Client record is already in scope — this helper costs a DB fetch and
 * exists for call sites that only hold a clientId.
 */
export async function getClientTodayString(
  clientId: string,
  now: Date = new Date()
): Promise<string> {
  // The coaches embed MUST name the FK: coach_client_views also relates
  // clients to coaches, so a bare `coaches(...)` is ambiguous and PostgREST
  // rejects the whole query (PGRST201) — which the UTC fallback below would
  // silently absorb for every client.
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("timezone, coaches!clients_coach_id_fkey ( timezone )")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    console.error(
      "getClientTodayString: timezone fetch failed, falling back to UTC",
      error
    );
  }

  const clientTz = data?.timezone;
  const coachTz = data?.coaches?.timezone;
  const tz =
    clientTz && clientTz !== "UTC"
      ? clientTz
      : coachTz && coachTz !== "UTC"
        ? coachTz
        : "UTC";

  return getTodayDateStringInTimezone(tz, now);
}

/**
 * "Today" for a date on the COACH's calendar (attention feed, current-week
 * metrics, history summaries). Sibling of getClientTodayString — resolve once
 * per request, never per client in a loop.
 */
export async function getCoachTodayString(
  coachId: string,
  now: Date = new Date()
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("coaches")
    .select("timezone")
    .eq("id", coachId)
    .maybeSingle();

  if (error) {
    console.error(
      "getCoachTodayString: timezone fetch failed, falling back to UTC",
      error
    );
  }

  return getTodayDateStringInTimezone(data?.timezone ?? "UTC", now);
}
