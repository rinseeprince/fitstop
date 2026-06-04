/**
 * Service for evaluating attention triggers across all of a coach's clients
 *
 * Tables queried:
 * - clients: to get the list of clients for a coach
 * - daily_logs: 28-day rolling window of logs for all clients
 * - daily_habits: habit definitions for all clients
 * - daily_habit_logs: 28-day rolling window of habit logs for all clients
 * - training_plans & training_sessions: to get planned session counts per client
 */

import { supabaseAdmin } from "./supabase-admin"
import type { Database } from "@/types/database"
import type { ClientWithAlerts, AttentionAlert } from "@/types/attention-feed"
import { getDateDaysAgo, getTodayDateString } from "@/lib/date-helpers"
import { groupClientData, evaluateAndSortTriggers, filterDismissedAlerts } from "@/lib/attention-feed-helpers"
import type { DailyLogRow } from "@/lib/attention-feed-helpers"

type ClientRow = Database["public"]["Tables"]["clients"]["Row"]
type ClientInfo = Pick<ClientRow, 'id' | 'name' | 'avatar_url'>
type ClientInfoWithCheckIn = ClientInfo & Pick<ClientRow, 'expected_check_in_day'>

/**
 * Evaluates all attention triggers for all of a coach's clients
 */
export async function evaluateAllClientTriggers(coachId: string): Promise<{ clients: ClientWithAlerts[], totalClientCount: number }> {
  const startDate = getDateDaysAgo(28)
  const endDate = getTodayDateString()
  const dateRange = { start: startDate, end: endDate }

  // 1. Get all clients for this coach
  const { data: clients, error: clientsError } = await supabaseAdmin
    .from("clients")
    .select("id, name, avatar_url, expected_check_in_day")
    .eq("coach_id", coachId)
    .eq("active", true)
    .eq("onboarding_status", "active")

  if (clientsError || !clients) {
    throw new Error("Failed to fetch clients for attention feed")
  }

  if (clients.length === 0) {
    return { clients: [], totalClientCount: 0 }
  }

  // Store total count before filtering
  const totalClientCount = clients.length

  const clientIds = clients.map(c => c.id)

  // Fetch all data sources in parallel (Q2-Q6 are independent after Q1)
  // Uses Promise.allSettled to preserve graceful degradation: logs are required,
  // but habits/events/dismissals degrade gracefully if they fail
  const [logsResult, habitsResult, habitLogsResult, eventsResult, dismissalsResult] = await Promise.allSettled([
    // 2. Daily logs (cross-domain view, required for core triggers)
    supabaseAdmin
      .from("daily_logs_full")
      .select("*")
      .in("client_id", clientIds)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true }) as unknown as Promise<{ data: DailyLogRow[] | null; error: { message: string } | null }>,
    // 3. Habit definitions (graceful degradation)
    supabaseAdmin
      .from("daily_habits")
      .select("*")
      .in("client_id", clientIds)
      .eq("is_active", true),
    // 4. Habit logs (graceful degradation)
    supabaseAdmin
      .from("daily_habit_logs")
      .select("*")
      .in("client_id", clientIds)
      .gte("date", startDate)
      .lte("date", endDate),
    // 5. Training events (graceful degradation)
    supabaseAdmin
      .from("training_events")
      .select("client_id, date, status, estimated_calories")
      .in("client_id", clientIds)
      .gte("date", startDate)
      .lte("date", endDate),
    // 6. Dismissed alerts (graceful degradation)
    supabaseAdmin
      .from("attention_dismissals")
      .select("client_id, alert_type, dismissed_at")
      .eq("coach_id", coachId),
  ])

  // Extract results, preserving original error semantics:
  // logs are required (throw), others degrade gracefully (log and continue)
  if (logsResult.status === "rejected") {
    throw new Error("Failed to fetch daily logs for attention feed")
  }
  const { data: allLogs, error: logsError } = logsResult.value
  if (logsError) {
    throw new Error("Failed to fetch daily logs for attention feed")
  }

  let allHabits = null
  if (habitsResult.status === "fulfilled") {
    if (habitsResult.value.error) {
      console.error("Error fetching habits:", habitsResult.value.error)
    } else {
      allHabits = habitsResult.value.data
    }
  }

  let allHabitLogs = null
  if (habitLogsResult.status === "fulfilled") {
    if (habitLogsResult.value.error) {
      console.error("Error fetching habit logs:", habitLogsResult.value.error)
    } else {
      allHabitLogs = habitLogsResult.value.data
    }
  }

  let eventRows = null
  if (eventsResult.status === "fulfilled") {
    if (eventsResult.value.error) {
      console.error("Error fetching training events:", eventsResult.value.error)
    } else {
      eventRows = eventsResult.value.data
    }
  }

  // Group all query results by client
  const clientDataMap = groupClientData(
    clients as ClientInfoWithCheckIn[],
    allLogs,
    allHabits,
    allHabitLogs,
    eventRows,
  )

  // Evaluate triggers and sort
  const clientsWithAlerts = evaluateAndSortTriggers(clientDataMap, dateRange)

  // Filter out dismissed alerts that haven't resurfaced
  let dismissals = null
  if (dismissalsResult.status === "fulfilled" && !dismissalsResult.value.error) {
    dismissals = dismissalsResult.value.data
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
  const startDate = getDateDaysAgo(28)
  const endDate = getTodayDateString()
  const dateRange = { start: startDate, end: endDate }

  const { data: client, error: clientError } = await supabaseAdmin
    .from("clients")
    .select("id, name, avatar_url, expected_check_in_day")
    .eq("id", clientId)
    .eq("coach_id", coachId)
    .maybeSingle()

  if (clientError || !client) return []

  const [logsResult, habitsResult, habitLogsResult, eventsResult, dismissalsResult] =
    await Promise.allSettled([
      supabaseAdmin
        .from("daily_logs_full")
        .select("*")
        .eq("client_id", clientId)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true }) as unknown as Promise<{ data: DailyLogRow[] | null; error: { message: string } | null }>,
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
  )
  const withAlerts = evaluateAndSortTriggers(clientDataMap, dateRange)
  const filtered = filterDismissedAlerts(withAlerts, dismissals)
  return filtered[0]?.alerts ?? []
}
