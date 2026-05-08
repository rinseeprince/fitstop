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
import type { ClientWithAlerts } from "@/types/attention-feed"
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

  // 2. Batch query all daily logs for all clients (28-day window)
  // Uses daily_logs_full view (cross-domain: needs wellness + nutrition + training)
  const { data: allLogs, error: logsError } = await supabaseAdmin
    // daily_logs_full is a DB view not in generated types — cast required until types are regenerated
    .from("daily_logs_full" as never)
    .select("*")
    .in("client_id" as never, clientIds as never)
    .gte("date" as never, startDate as never)
    .lte("date" as never, endDate as never)
    .order("date" as never, { ascending: true }) as unknown as { data: DailyLogRow[] | null; error: { message: string } | null }

  if (logsError) {
    throw new Error("Failed to fetch daily logs for attention feed")
  }

  // 3. Batch query all habits for all clients
  const { data: allHabits, error: habitsError } = await supabaseAdmin
    .from("daily_habits")
    .select("*")
    .in("client_id", clientIds)
    .eq("is_active", true)

  if (habitsError) {
    console.error("Error fetching habits:", habitsError)
  }

  // 4. Batch query all habit logs for all clients (28-day window)
  const { data: allHabitLogs, error: habitLogsError } = await supabaseAdmin
    .from("daily_habit_logs")
    .select("*")
    .in("client_id", clientIds)
    .gte("date", startDate)
    .lte("date", endDate)

  if (habitLogsError) {
    console.error("Error fetching habit logs:", habitLogsError)
  }

  // 5. Batch query training events per client in the 28-day window
  const { data: eventRows, error: eventsError } = await supabaseAdmin
    .from("training_events")
    .select("client_id, date, status, estimated_calories")
    .in("client_id", clientIds)
    .gte("date", startDate)
    .lte("date", endDate)

  if (eventsError) {
    console.error("Error fetching training events:", eventsError)
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

  // 6. Filter out dismissed alerts that haven't resurfaced
  const { data: dismissals } = await supabaseAdmin
    .from("attention_dismissals")
    .select("client_id, alert_type, dismissed_at")
    .eq("coach_id", coachId)

  const filteredClients = filterDismissedAlerts(clientsWithAlerts, dismissals)

  return { clients: filteredClients, totalClientCount }
}
