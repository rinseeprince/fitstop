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
  type TriggerResult
} from "@/lib/attention-triggers"
import { checkInWeekday } from "@/lib/check-in-week"
import type { DayOfWeek } from "@/types/check-in"

type ClientRow = Database["public"]["Tables"]["clients"]["Row"]
type ClientInfo = Pick<ClientRow, 'id' | 'name' | 'avatar_url'>
type ClientInfoWithCheckIn = ClientInfo & Pick<ClientRow, 'expected_check_in_day' | 'start_date'>

// View row shape - daily_logs_full joins spine + wellness + nutrition + training
export type DailyLogRow = {
  id: string; client_id: string; date: string; notes: string | null;
  created_at: string; updated_at: string;
  mood: number | null; energy: number | null; sleep: number | null; stress: number | null;
  soreness: number | null;
  calories_consumed: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null;
  target_calories: number | null; target_protein_g: number | null; target_carbs_g: number | null; target_fat_g: number | null;
  nutrition_adherence: string | null; calorie_surplus_deficit: number | null;
  trained: boolean | null; training_session_id: string | null; training_data: unknown;
}

export type TrainingEventRow = {
  client_id: string
  date: string
  status: string
  estimated_calories: number | null
}

type DailyHabitRow = Database["public"]["Tables"]["daily_habits"]["Row"]
type DailyHabitLogRow = Database["public"]["Tables"]["daily_habit_logs"]["Row"]

export type ClientData = {
  client: ClientInfo
  logs: DailyLog[]
  habits: DailyHabit[]
  habitLogs: DailyHabitLog[]
  trainingEvents: TrainingEventRow[]
  plannedSessionCount: number
  /** Resolved through `checkInWeekday`, so never null — see lib/check-in-week.ts. */
  checkInDay: DayOfWeek
  startDate: string | null
}

/** Groups raw query results into a per-client map of domain objects */
export function groupClientData(
  clients: ClientInfoWithCheckIn[],
  allLogs: DailyLogRow[] | null,
  allHabits: DailyHabitRow[] | null,
  allHabitLogs: DailyHabitLogRow[] | null,
  eventRows: TrainingEventRow[] | null,
): Map<string, ClientData> {
  const clientDataMap = new Map<string, ClientData>()

  // Initialize map with clients
  clients.forEach(client => {
    clientDataMap.set(client.id, {
      client,
      logs: [],
      habits: [],
      habitLogs: [],
      trainingEvents: [],
      plannedSessionCount: 0,
      checkInDay: checkInWeekday({ expectedCheckInDay: client.expected_check_in_day }),
      startDate: client.start_date ?? null,
    })
  })

  // Group logs by client
  if (allLogs) {
    allLogs.forEach((logRow: DailyLogRow) => {
      const clientData = clientDataMap.get(logRow.client_id)
      if (clientData) {
        const log: DailyLog = {
          id: logRow.id,
          clientId: logRow.client_id,
          date: logRow.date,
          mood: logRow.mood ?? undefined,
          energy: logRow.energy ?? undefined,
          sleep: logRow.sleep ?? undefined,
          stress: logRow.stress ?? undefined,
          soreness: logRow.soreness ?? undefined,
          notes: logRow.notes ?? undefined,
          trained: logRow.trained ?? undefined,
          trainingSessionId: logRow.training_session_id ?? undefined,
          trainingData: logRow.training_data as DailyLog['trainingData'],
          caloriesConsumed: logRow.calories_consumed ?? undefined,
          proteinG: logRow.protein_g ?? undefined,
          carbsG: logRow.carbs_g ?? undefined,
          fatG: logRow.fat_g ?? undefined,
          targetCalories: logRow.target_calories ?? undefined,
          targetProteinG: logRow.target_protein_g ?? undefined,
          targetCarbsG: logRow.target_carbs_g ?? undefined,
          targetFatG: logRow.target_fat_g ?? undefined,
          nutritionAdherence: logRow.nutrition_adherence as DailyLog['nutritionAdherence'],
          calorieSurplusDeficit: logRow.calorie_surplus_deficit ?? undefined,
          createdAt: logRow.created_at,
          updatedAt: logRow.updated_at,
        }
        clientData.logs.push(log)
      }
    })
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

  return clientDataMap
}

/** Evaluates triggers per client and returns a severity-sorted list of clients with alerts */
export function evaluateAndSortTriggers(
  clientDataMap: Map<string, ClientData>,
  dateRange: { start: string; end: string },
): ClientWithAlerts[] {
  const clientsWithAlerts: ClientWithAlerts[] = []

  for (const [_clientId, data] of clientDataMap) {
    const alerts: AttentionAlert[] = []

    // Skip only clients with nothing to evaluate. Event/habit-driven triggers
    // (training misses, partial pattern, no-engagement) read sources other than
    // daily_logs, so a client with prescribed work but no logs must NOT be skipped.
    if (
      data.logs.length === 0 &&
      data.trainingEvents.length === 0 &&
      data.habitLogs.length === 0 &&
      data.habits.length === 0
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
      evaluateLoggingGap(data.logs, dateRange),
      evaluateNutritionMisses(data.logs),
      evaluateTrainingMisses(data.trainingEvents, windowNow, data.checkInDay),
      evaluatePartialTrainingPattern(data.trainingEvents),
      evaluateHighStress(data.logs),
      evaluateHighSoreness(data.logs),
      evaluateHabitDropoff(data.habitLogs, data.habits, windowNow),
      evaluateActivityCalMismatch(data.logs, data.trainingEvents, windowNow),
      evaluateNoEngagement({
        logs: data.logs,
        habits: data.habits,
        habitLogs: data.habitLogs,
        trainingEvents: data.trainingEvents,
        startDate: data.startDate,
        now: windowNow,
      })
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

    // Only include clients that have at least one alert
    if (alerts.length > 0) {
      clientsWithAlerts.push({
        clientId: data.client.id,
        clientName: data.client.name,
        clientAvatar: data.client.avatar_url,
        alerts
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
