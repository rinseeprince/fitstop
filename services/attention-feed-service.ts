/**
 * Service for evaluating attention triggers across all of a coach's clients
 *
 * Tables queried:
 * - clients: to get the list of clients for a coach
 * - daily_logs: 28-day rolling window of logs for all clients
 * - daily_habits: habit definitions for all clients
 * - daily_habit_logs: 28-day rolling window of habit logs for all clients
 * - training_events: the window's events, for the training triggers and the workout logs
 * - client_measurements_live: the client's own measurement logs (source = client_log)
 *
 * "Did the client log today?" is answered once, by `lib/logged-days.ts`, from
 * these rows (`loggedDaysFor` in lib/attention-feed-helpers.ts).
 */

import { supabaseAdmin } from "./supabase-admin"
import type { Database } from "@/types/database"
import type { ClientWithAlerts, AttentionAlert } from "@/types/attention-feed"
import { getDateDaysFrom } from "@/lib/date-helpers"
import { getCoachTodayString } from "./today-service"
import { groupClientData, evaluateAndSortTriggers, filterDismissedAlerts } from "@/lib/attention-feed-helpers"
import { fetchAllPages, fetchAllByChunkedIds } from "@/lib/paged-fetch"
import { CLIENT_MEASUREMENT_SOURCE } from "@/lib/logged-days"
import type { ClientLogRow, DailyLogRow } from "@/lib/attention-feed-helpers"

type ClientRow = Database["public"]["Tables"]["clients"]["Row"]
type ClientInfo = Pick<ClientRow, 'id' | 'name' | 'avatar_url'>
type ClientInfoWithCheckIn = ClientInfo & Pick<ClientRow, 'next_check_in_due' | 'start_date'>

/**
 * Evaluates all attention triggers for all of a coach's clients
 */
export async function evaluateAllClientTriggers(coachId: string): Promise<{ clients: ClientWithAlerts[], totalClientCount: number }> {
  // Coach-local 28-day window: the feed is the COACH's dashboard view, so its
  // "today" is the coach's local day (one fetch per request, not per client).
  const endDate = await getCoachTodayString(coachId)
  const startDate = getDateDaysFrom(new Date(endDate + "T00:00:00"), -28)
  const dateRange = { start: startDate, end: endDate }

  // 1. Get all clients for this coach.
  // PAGED: unpaged this dropped clients past ~1000 from both the feed and
  // totalClientCount. It is also load-bearing for the reads below: that 1000-row
  // truncation used to incidentally cap the id list, and now that those reads
  // chunk the ids properly, nothing else bounds this one.
  let clients: ClientInfoWithCheckIn[]
  try {
    clients = await fetchAllPages<ClientInfoWithCheckIn>((from, to) =>
      supabaseAdmin
        .from("clients")
        .select("id, name, avatar_url, next_check_in_due, start_date")
        .eq("coach_id", coachId)
        .eq("active", true)
        .eq("onboarding_status", "active")
        .order("id", { ascending: true })
        .range(from, to),
      { errorLabel: "clients for attention feed" },
    )
  } catch {
    throw new Error("Failed to fetch clients for attention feed")
  }

  if (clients.length === 0) {
    return { clients: [], totalClientCount: 0 }
  }

  // Store total count before filtering
  const totalClientCount = clients.length

  const clientIds = clients.map(c => c.id)

  // Fetch all data sources in parallel (Q2-Q7 are independent after Q1)
  // Uses Promise.allSettled to preserve graceful degradation: logs are required,
  // but habits/events/dismissals degrade gracefully if they fail
  // Every cross-client read below is CHUNKED BY CLIENT ID *and* PAGED, because
  // these reads have two independent ceilings and fixing one leaves the other:
  //
  //  - ROW cap: PostgREST truncates an unpaged response at ~1000 rows with no
  //    error. At 5 habits x 29 dates = 145 rows/client the habit logs were
  //    losing rows from the SEVENTH client onward, silently skewing the
  //    habit-dropoff percentage shown to the coach.
  //  - URL cap: inlining every client id into `.in()` costs ~38 B/uuid, so the
  //    request line passes a typical 8 KB proxy limit at ~205 clients and 16 KB
  //    at ~425. Paging does NOT help — the loop re-sends the whole id list on
  //    every page. The daily-logs read is the REQUIRED one (a rejection throws),
  //    so a 414 there fails the entire feed for that coach rather than degrading.
  //
  // Chunking by client_id is safe for these consumers: every row for a given
  // client falls inside exactly one chunk and that chunk is paged to completion,
  // so the per-client date-DESC ordering the triggers depend on is preserved.
  // groupClientData re-buckets by client, so cross-chunk global order is moot.
  //
  // daily_logs_full is ordered date DESC (it was ASC): under truncation ASC kept
  // the OLDEST dates and discarded exactly the recent end that every trigger
  // reads (dropoff = last 7 days, no_engagement = last 3, cal-mismatch = 28).
  // The `id` tiebreak keeps offset paging stable across pages.
  const [logsResult, habitsResult, habitLogsResult, eventsResult, clientLogsResult, dismissalsResult] = await Promise.allSettled([
    // 2. Daily logs (cross-domain view, required for core triggers)
    fetchAllByChunkedIds<DailyLogRow, string>(clientIds, (chunk, from, to) =>
      supabaseAdmin
        .from("daily_logs_full")
        .select("*")
        .in("client_id", chunk)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: DailyLogRow[] | null; error: { message: string } | null }>,
      { errorLabel: "daily logs" },
    ),
    // 3. Habit definitions (graceful degradation)
    fetchAllByChunkedIds(clientIds, (chunk, from, to) =>
      supabaseAdmin
        .from("daily_habits")
        .select("*")
        .in("client_id", chunk)
        .eq("is_active", true)
        .order("id", { ascending: true })
        .range(from, to),
      { errorLabel: "habits" },
    ),
    // 4. Habit logs (graceful degradation)
    fetchAllByChunkedIds(clientIds, (chunk, from, to) =>
      supabaseAdmin
        .from("daily_habit_logs")
        .select("*")
        .in("client_id", chunk)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
      { errorLabel: "habit logs" },
    ),
    // 5. Training events (graceful degradation)
    fetchAllByChunkedIds(clientIds, (chunk, from, to) =>
      supabaseAdmin
        .from("training_events")
        .select("client_id, date, status, estimated_calories, id")
        .in("client_id", chunk)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
      { errorLabel: "training events" },
    ),
    // 6. The client's own measurement logs (graceful degradation). Empty until
    //    the client app can log a weight; read now so the derived logged-day
    //    definition cannot silently lose its fifth source the day it can.
    fetchAllByChunkedIds<ClientLogRow, string>(clientIds, (chunk, from, to) =>
      supabaseAdmin
        .from("client_measurements_live")
        .select("client_id, recorded_on")
        .in("client_id", chunk)
        .eq("source", CLIENT_MEASUREMENT_SOURCE)
        .gte("recorded_on", startDate)
        .lte("recorded_on", endDate)
        .order("recorded_on", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
      { errorLabel: "client measurement logs" },
    ),
    // 7. Dismissed alerts (graceful degradation)
    fetchAllPages((from, to) =>
      supabaseAdmin
        .from("attention_dismissals")
        .select("client_id, alert_type, dismissed_at")
        .eq("coach_id", coachId)
        .order("client_id", { ascending: true })
        .order("alert_type", { ascending: true })
        .range(from, to),
      { errorLabel: "dismissals" },
    ),
  ])

  // Extract results, preserving original error semantics: logs are required
  // (throw), others degrade gracefully (log and continue). fetchAllPages throws
  // on a page error rather than returning { error }, so a failure now surfaces
  // as a rejected settlement -- the two old branches collapse into one.
  if (logsResult.status === "rejected") {
    throw new Error("Failed to fetch daily logs for attention feed")
  }
  const allLogs = logsResult.value

  let allHabits = null
  if (habitsResult.status === "fulfilled") {
    allHabits = habitsResult.value
  } else {
    console.error("Error fetching habits:", habitsResult.reason)
  }

  let allHabitLogs = null
  if (habitLogsResult.status === "fulfilled") {
    allHabitLogs = habitLogsResult.value
  } else {
    console.error("Error fetching habit logs:", habitLogsResult.reason)
  }

  let eventRows = null
  if (eventsResult.status === "fulfilled") {
    eventRows = eventsResult.value
  } else {
    console.error("Error fetching training events:", eventsResult.reason)
  }

  let clientLogRows = null
  if (clientLogsResult.status === "fulfilled") {
    clientLogRows = clientLogsResult.value
  } else {
    console.error("Error fetching client measurement logs:", clientLogsResult.reason)
  }

  // Group all query results by client
  const clientDataMap = groupClientData(
    clients,
    allLogs,
    allHabits,
    allHabitLogs,
    eventRows,
    clientLogRows,
  )

  // Evaluate triggers and sort
  const clientsWithAlerts = evaluateAndSortTriggers(clientDataMap, dateRange)

  // Filter out dismissed alerts that haven't resurfaced
  let dismissals = null
  if (dismissalsResult.status === "fulfilled") {
    dismissals = dismissalsResult.value
  }

  const filteredClients = filterDismissedAlerts(clientsWithAlerts, dismissals)

  return { clients: filteredClients, totalClientCount }
}

/**
 * Single-client attention alerts for the overview brief (Session 7.6).
 *
 * Scopes the same 28-day window + trigger evaluation as evaluateAllClientTriggers
 * to ONE client, reusing the pure groupClientData / evaluateAndSortTriggers /
 * filterDismissedAlerts helpers. The caller (the brief service) has already
 * verified the coach owns this client. Returns [] when the client has no alerts.
 */
export async function evaluateSingleClientAlerts(
  coachId: string,
  clientId: string
): Promise<AttentionAlert[]> {
  // Coach-local window — see evaluateAllClientTriggers.
  const endDate = await getCoachTodayString(coachId)
  const startDate = getDateDaysFrom(new Date(endDate + "T00:00:00"), -28)
  const dateRange = { start: startDate, end: endDate }

  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .select("id, name, avatar_url, next_check_in_due, start_date")
    .eq("id", clientId)
    .eq("coach_id", coachId)
    .maybeSingle()

  if (clientError || !client) return []

  const [logsResult, habitsResult, habitLogsResult, eventsResult, clientLogsResult, dismissalsResult] =
    await Promise.allSettled([
      supabaseAdmin
        .from("daily_logs_full")
        .select("*")
        .eq("client_id", clientId)
        .gte("date", startDate)
        .lte("date", endDate)
        // date DESC to match evaluateAllClientTriggers, so the two entry points
        // hand the same trigger functions rows in the same order. Single-client
        // and 29 days, so unlike the cross-client path this one cannot truncate.
        .order("date", { ascending: false }) as unknown as Promise<{ data: DailyLogRow[] | null; error: { message: string } | null }>,
      supabaseAdmin.from("daily_habits").select("*").eq("client_id", clientId).eq("is_active", true),
      supabaseAdmin
        .from("daily_habit_logs")
        .select("*")
        .eq("client_id", clientId)
        .gte("date", startDate)
        .lte("date", endDate),
      supabaseAdmin
        .from("training_events")
        .select("client_id, date, status, estimated_calories")
        .eq("client_id", clientId)
        .gte("date", startDate)
        .lte("date", endDate),
      supabaseAdmin
        .from("client_measurements_live")
        .select("client_id, recorded_on")
        .eq("client_id", clientId)
        .eq("source", CLIENT_MEASUREMENT_SOURCE)
        .gte("recorded_on", startDate)
        .lte("recorded_on", endDate),
      supabaseAdmin
        .from("attention_dismissals")
        .select("client_id, alert_type, dismissed_at")
        .eq("coach_id", coachId)
        .eq("client_id", clientId),
    ])

  // Logs are required for the core triggers; without them there are no alerts.
  if (logsResult.status !== "fulfilled" || logsResult.value.error) return []
  const allLogs = logsResult.value.data

  const allHabits =
    habitsResult.status === "fulfilled" && !habitsResult.value.error ? habitsResult.value.data : null
  const allHabitLogs =
    habitLogsResult.status === "fulfilled" && !habitLogsResult.value.error ? habitLogsResult.value.data : null
  const eventRows =
    eventsResult.status === "fulfilled" && !eventsResult.value.error ? eventsResult.value.data : null
  const clientLogRows =
    clientLogsResult.status === "fulfilled" && !clientLogsResult.value.error
      ? clientLogsResult.value.data
      : null
  const dismissals =
    dismissalsResult.status === "fulfilled" && !dismissalsResult.value.error
      ? dismissalsResult.value.data
      : null

  const clientDataMap = groupClientData(
    [client] as ClientInfoWithCheckIn[],
    allLogs,
    allHabits,
    allHabitLogs,
    eventRows,
    clientLogRows,
  )
  const withAlerts = evaluateAndSortTriggers(clientDataMap, dateRange)
  const filtered = filterDismissedAlerts(withAlerts, dismissals)
  return filtered[0]?.alerts ?? []
}
