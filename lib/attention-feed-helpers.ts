/**
 * Helper functions for the attention feed service.
 * Extracts data-grouping and trigger-evaluation logic to keep the service file focused on DB queries.
 */

import type { Database } from "@/types/database"
import type { DailyLog } from "@/types/daily-log"
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit"
import type { ClientWithAlerts, AttentionAlert } from "@/types/attention-feed"
import {
  evaluateMoodEnergyDrop,
  evaluateLoggingGap,
  evaluateNutritionMisses,
  evaluateTrainingMisses,
  evaluatePartialTrainingPattern,
  evaluateHighStress,
  evaluateHighSoreness,
  evaluateHabitDropoff,
  evaluateActivityCalMismatch,
  evaluateNoEngagement,
  evaluatePrescriptionEnding,
  type TriggerResult
} from "@/lib/attention-triggers"
import type {
  BlockWindow,
  ClientBlockWindow,
  ClientPlanWindow,
  PlanWindow,
} from "@/lib/prescription-triggers"
import { sortAlertsBySeverity } from "@/lib/attention-alert-severity"
import { checkInWeekday } from "@/lib/check-in-week"
import {
  hasNutritionEntry,
  hasWellnessReading,
  isTrainingLogStatus,
  loggedDays,
} from "@/lib/logged-days"
import {
  assembleDayLog,
  type NutritionLogRow,
  type WellnessLogRow,
} from "@/services/daily-logs-service"
import type { ClientNutritionDayTarget } from "@/services/nutrition-days-service"
import type { DayOfWeek } from "@/types/check-in"

type ClientRow = Database["public"]["Tables"]["clients"]["Row"]
type ClientInfo = Pick<ClientRow, 'id' | 'name' | 'avatar_url'>
type ClientInfoWithCheckIn = ClientInfo & Pick<ClientRow, 'next_check_in_due' | 'start_date'>

/**
 * The feed's two day-form reads over the window: the roster's wellness rows
 * and its food rows, each table by client and date. The nutrition columns are
 * what the client ATE; a day's target and its verdict come from the computed
 * day (`dayTargets` below), never off a row.
 */
type DayFormRows = {
  wellness: WellnessLogRow[]
  nutrition: NutritionLogRow[]
}

export type TrainingEventRow = {
  client_id: string
  date: string
  /** Whether the client logged the workout — never how it went. */
  status: string
  estimated_calories: number | null
  /** The workout's log, embedded by the named foreign key: where its quality lives. */
  session_log?: { completion_quality: string | null } | null
}

/** A measurement the client logged themselves: `client_measurements_live`, `source = 'client_log'`. */
export type ClientLogRow = {
  client_id: string | null
  recorded_on: string | null
}

type DailyHabitRow = Database["public"]["Tables"]["daily_habits"]["Row"]
type DailyHabitLogRow = Database["public"]["Tables"]["daily_habit_logs"]["Row"]

type ClientData = {
  client: ClientInfo
  logs: DailyLog[]
  habits: DailyHabit[]
  habitLogs: DailyHabitLog[]
  trainingEvents: TrainingEventRow[]
  /** Days the client logged a body measurement themselves — the fifth logged-day source. */
  clientLogDates: string[]
  /** Every active nutrition version's window — the prescription-ending trigger's input. */
  nutritionWindows: PlanWindow[]
  /** Every live program's window, capped at the next plan's start — its training twin. */
  trainingWindows: PlanWindow[]
  /** The client's non-archived journey blocks — named in the prescription-ending messages, never a bound. */
  blocks: BlockWindow[]
  plannedSessionCount: number
  /** Resolved through `checkInWeekday`, so never null — see lib/check-in-week.ts. */
  checkInDay: DayOfWeek
  startDate: string | null
}

/**
 * Groups raw query results into a per-client map of domain objects.
 *
 * `dayRows` are the roster's wellness rows and food rows over the window; each
 * client's days are assembled from them, a day listed when either table holds
 * a row on it, newest first — the order the triggers walk — through the same
 * fold the day reader uses, so the feed and the check-in read a day one way.
 * `dayTargets` is every client's computed target per date over the window
 * (`getNutritionTargetsForClients`, one pass for the roster): each day
 * takes its target from it and its verdict is derived from what was
 * eaten against that target — the food log stores neither. A degraded read
 * (null) leaves every day target-less, which silences the nutrition
 * triggers for the request rather than judging a day against nothing.
 */
export function groupClientData(
  clients: ClientInfoWithCheckIn[],
  dayRows: DayFormRows | null,
  allHabits: DailyHabitRow[] | null,
  allHabitLogs: DailyHabitLogRow[] | null,
  eventRows: TrainingEventRow[] | null,
  clientLogRows: ClientLogRow[] | null,
  nutritionWindows: ClientPlanWindow[] | null = null,
  trainingWindows: ClientPlanWindow[] | null = null,
  blocks: ClientBlockWindow[] | null = null,
  dayTargets: ClientNutritionDayTarget[] | null = null,
): Map<string, ClientData> {
  const clientDataMap = new Map<string, ClientData>()

  const targetByClientDate = new Map<string, ClientNutritionDayTarget>()
  for (const target of dayTargets ?? []) {
    targetByClientDate.set(`${target.clientId}:${target.date}`, target)
  }

  // Initialize map with clients
  clients.forEach(client => {
    clientDataMap.set(client.id, {
      client,
      logs: [],
      habits: [],
      habitLogs: [],
      trainingEvents: [],
      clientLogDates: [],
      nutritionWindows: [],
      trainingWindows: [],
      blocks: [],
      plannedSessionCount: 0,
      checkInDay: checkInWeekday({ nextCheckInDue: client.next_check_in_due }),
      startDate: client.start_date ?? null,
    })
  })

  // Assemble each client's days from the two tables: the rows merged per
  // (client, date), then folded newest first.
  if (dayRows) {
    type DayRows = { wellness: WellnessLogRow | null; nutrition: NutritionLogRow | null }
    const daysByClient = new Map<string, Map<string, DayRows>>()
    const dayFor = (clientId: string, date: string): DayRows => {
      let days = daysByClient.get(clientId)
      if (!days) {
        days = new Map()
        daysByClient.set(clientId, days)
      }
      let day = days.get(date)
      if (!day) {
        day = { wellness: null, nutrition: null }
        days.set(date, day)
      }
      return day
    }
    for (const row of dayRows.wellness) dayFor(row.client_id, row.date).wellness = row
    for (const row of dayRows.nutrition) dayFor(row.client_id, row.date).nutrition = row

    for (const [clientId, days] of daysByClient) {
      const clientData = clientDataMap.get(clientId)
      if (!clientData) continue
      const newestFirst = [...days.entries()].sort(([a], [b]) => b.localeCompare(a))
      for (const [date, { wellness, nutrition }] of newestFirst) {
        const target = targetByClientDate.get(`${clientId}:${date}`) ?? null
        clientData.logs.push(assembleDayLog(clientId, date, wellness, nutrition, target))
      }
    }
  }

  // Group habits by client
  if (allHabits) {
    allHabits.forEach((habitRow: DailyHabitRow) => {
      const clientData = clientDataMap.get(habitRow.client_id)
      if (clientData) {
        const habit: DailyHabit = {
          id: habitRow.id,
          coachId: habitRow.coach_id,
          clientId: habitRow.client_id,
          name: habitRow.name,
          description: habitRow.description ?? undefined,
          targetValue: habitRow.target_value ?? undefined,
          targetUnit: habitRow.target_unit ?? undefined,
          isBoolean: habitRow.is_boolean,
          isActive: habitRow.is_active,
          sortOrder: habitRow.sort_order,
          effectiveDate: habitRow.effective_date,
          createdAt: habitRow.created_at,
          updatedAt: habitRow.updated_at,
        }
        clientData.habits.push(habit)
      }
    })
  }

  // Group habit logs by client
  if (allHabitLogs) {
    allHabitLogs.forEach((logRow: DailyHabitLogRow) => {
      const clientData = clientDataMap.get(logRow.client_id)
      if (clientData) {
        const log: DailyHabitLog = {
          id: logRow.id,
          dailyHabitId: logRow.daily_habit_id,
          clientId: logRow.client_id,
          date: logRow.date,
          completed: logRow.completed,
          value: logRow.value ?? undefined,
          notes: logRow.notes ?? undefined,
          createdAt: logRow.created_at,
          updatedAt: logRow.updated_at,
        }
        clientData.habitLogs.push(log)
      }
    })
  }

  // Group training events per client
  if (eventRows) {
    for (const row of eventRows) {
      const clientData = clientDataMap.get(row.client_id)
      if (clientData) {
        clientData.trainingEvents.push(row)
      }
    }
    for (const [_, clientData] of clientDataMap) {
      clientData.plannedSessionCount = clientData.trainingEvents.length
    }
  }

  // Group the client's own measurement logs per client, as dates
  if (clientLogRows) {
    for (const row of clientLogRows) {
      if (!row.client_id || !row.recorded_on) continue
      clientDataMap.get(row.client_id)?.clientLogDates.push(row.recorded_on)
    }
  }

  // Group each track's plan windows per client
  for (const window of nutritionWindows ?? []) {
    clientDataMap.get(window.clientId)?.nutritionWindows.push({ start: window.start, end: window.end })
  }
  for (const window of trainingWindows ?? []) {
    clientDataMap.get(window.clientId)?.trainingWindows.push({ start: window.start, end: window.end })
  }
  for (const block of blocks ?? []) {
    clientDataMap.get(block.clientId)?.blocks.push({ name: block.name, start: block.start, end: block.end })
  }

  return clientDataMap
}

/**
 * The client's logged days over the feed's window, assembled from the rows the
 * feed already holds and answered by the one definition (`lib/logged-days.ts`)
 * — never a private union. An assembled day carries the wellness scores of its
 * wellness row and the consumed values of its food row, so it counts for each
 * source whose values it carries; a workout counts by its event's status; a
 * habit log counts whether ticked or not, because either is the client acting.
 */
export function loggedDaysFor(
  data: ClientData,
  dateRange: { start: string; end: string },
): string[] {
  return loggedDays(
    {
      wellness: data.logs.filter(hasWellnessReading).map((log) => log.date),
      nutrition: data.logs.filter(hasNutritionEntry).map((log) => log.date),
      habits: data.habitLogs.map((log) => log.date),
      training: data.trainingEvents
        .filter((event) => isTrainingLogStatus(event.status))
        .map((event) => event.date),
      measurements: data.clientLogDates,
    },
    { from: dateRange.start, to: dateRange.end },
  )
}

/** Evaluates triggers per client and returns a severity-sorted list of clients with alerts */
export function evaluateAndSortTriggers(
  clientDataMap: Map<string, ClientData>,
  dateRange: { start: string; end: string },
): ClientWithAlerts[] {
  const clientsWithAlerts: ClientWithAlerts[] = []

  for (const [_clientId, data] of clientDataMap) {
    const alerts: AttentionAlert[] = []

    // Skip only a client with nothing logged and nothing prescribed: the
    // pattern triggers need logs, the absence signal needs prescribed work, and
    // a client with prescribed work but no logs must NOT be skipped. A plan
    // window counts as prescribed: the client whose every prescription has
    // ended and who has stopped logging is exactly the one the
    // prescription-ending trigger exists for.
    const logged = loggedDaysFor(data, dateRange)
    if (
      logged.length === 0 &&
      data.trainingEvents.length === 0 &&
      data.habits.length === 0 &&
      data.nutritionWindows.length === 0 &&
      data.trainingWindows.length === 0
    ) {
      continue
    }

    // Run all trigger evaluations. Day-deciding triggers receive a "now"
    // derived from the feed's window end (the COACH-local today, Session 7.84)
    // so the whole feed judges days on one anchor — a trigger defaulting to
    // the server clock would mix UTC days into a coach-local window.
    const windowNow = new Date(dateRange.end + "T00:00:00")
    const triggers: (TriggerResult | null)[] = [
      evaluateMoodEnergyDrop(data.logs, "mood"),
      evaluateMoodEnergyDrop(data.logs, "energy"),
      evaluateLoggingGap(logged, dateRange),
      evaluateNutritionMisses(data.logs),
      evaluateTrainingMisses(data.trainingEvents, windowNow, data.checkInDay),
      evaluatePartialTrainingPattern(data.trainingEvents),
      evaluateHighStress(data.logs),
      evaluateHighSoreness(data.logs),
      evaluateHabitDropoff(data.habitLogs, data.habits, windowNow),
      evaluateActivityCalMismatch(data.logs, data.trainingEvents, windowNow),
      evaluateNoEngagement({
        loggedDays: logged,
        habits: data.habits,
        trainingEvents: data.trainingEvents,
        startDate: data.startDate,
        now: windowNow,
      }),
      evaluatePrescriptionEnding({ track: "nutrition", windows: data.nutritionWindows, blocks: data.blocks, today: dateRange.end }),
      evaluatePrescriptionEnding({ track: "training", windows: data.trainingWindows, blocks: data.blocks, today: dateRange.end }),
    ]

    // Convert trigger results to alerts
    triggers.forEach(result => {
      if (result) {
        alerts.push({
          type: result.type,
          severity: result.severity,
          message: result.message,
          affectedDays: result.affectedDays,
          metricData: result.metricData
        })
      }
    })

    // Only include clients that have at least one alert. Their alerts leave
    // here most severe first: the list above is trigger order, and a surface
    // that renders it as given would put a HIGH from a late trigger under the
    // mediums that ran before it.
    if (alerts.length > 0) {
      clientsWithAlerts.push({
        clientId: data.client.id,
        clientName: data.client.name,
        clientAvatar: data.client.avatar_url,
        alerts: sortAlertsBySeverity(alerts),
      })
    }
  }

  // Sort clients: high severity alerts first, then medium, then alphabetical by name
  clientsWithAlerts.sort((a, b) => {
    const aHighCount = a.alerts.filter(alert => alert.severity === "high").length
    const bHighCount = b.alerts.filter(alert => alert.severity === "high").length

    if (aHighCount !== bHighCount) {
      return bHighCount - aHighCount // More high severity alerts first
    }

    const aMediumCount = a.alerts.filter(alert => alert.severity === "medium").length
    const bMediumCount = b.alerts.filter(alert => alert.severity === "medium").length

    if (aMediumCount !== bMediumCount) {
      return bMediumCount - aMediumCount // More medium severity alerts next
    }

    return a.clientName.localeCompare(b.clientName) // Alphabetical by name
  })

  return clientsWithAlerts
}

export type DismissalRow = {
  client_id: string
  alert_type: string
  dismissed_at: string
}

/** Filters out alerts that were dismissed before the most recent affected day */
export function filterDismissedAlerts(
  clients: ClientWithAlerts[],
  dismissals: DismissalRow[] | null
): ClientWithAlerts[] {
  if (!dismissals || dismissals.length === 0) return clients

  const dismissalMap = new Map<string, string>()
  for (const d of dismissals) {
    dismissalMap.set(`${d.client_id}:${d.alert_type}`, d.dismissed_at)
  }

  const filtered: ClientWithAlerts[] = []
  for (const client of clients) {
    const remainingAlerts = client.alerts.filter(alert => {
      const dismissedAt = dismissalMap.get(`${client.clientId}:${alert.type}`)
      if (!dismissedAt) return true
      const maxAffectedDay = alert.affectedDays.reduce((max, day) => day > max ? day : max, "")
      return maxAffectedDay > dismissedAt
    })
    if (remainingAlerts.length > 0) {
      filtered.push({ ...client, alerts: remainingAlerts })
    }
  }
  return filtered
}
