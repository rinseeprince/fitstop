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
import type { DailyLog } from "@/types/daily-log"
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit"
import type { ClientWithAlerts, AttentionAlert } from "@/types/attention-feed"
import { getDateDaysAgo } from "@/lib/date-helpers"
import {
  evaluateMoodEnergyDrop,
  evaluateLoggingGap,
  evaluateNutritionMisses,
  evaluateTrainingMisses,
  evaluateHighStress,
  evaluateHabitDropoff,
  evaluateActivityCalMismatch,
  type TriggerResult
} from "@/lib/attention-triggers"

type ClientRow = Database["public"]["Tables"]["clients"]["Row"]
type ClientInfo = Pick<ClientRow, 'id' | 'name' | 'avatar_url'>
type DailyLogRow = Database["public"]["Tables"]["daily_logs"]["Row"]
type DailyHabitRow = Database["public"]["Tables"]["daily_habits"]["Row"]
type DailyHabitLogRow = Database["public"]["Tables"]["daily_habit_logs"]["Row"]
type TrainingPlanRow = Database["public"]["Tables"]["training_plans"]["Row"]
type TrainingSessionRow = Database["public"]["Tables"]["training_sessions"]["Row"]

// Type for the training plan query result with nested sessions
interface TrainingPlanWithSessions {
  id: string
  client_id: string
  training_sessions: Array<{
    id: string
    session_type: string | null
    day_of_week: string | null
  }>
}

/**
 * Evaluates all attention triggers for all of a coach's clients
 */
export async function evaluateAllClientTriggers(coachId: string): Promise<{ clients: ClientWithAlerts[], totalClientCount: number }> {
  const startDate = getDateDaysAgo(28)
  const endDate = new Date().toISOString().split('T')[0]
  const dateRange = { start: startDate, end: endDate }

  // 1. Get all clients for this coach
  const { data: clients, error: clientsError } = await supabaseAdmin
    .from("clients")
    .select("id, name, avatar_url")
    .eq("coach_id", coachId)
    .eq("active", true)
    .eq("onboarding_status", "active")

  if (clientsError || !clients) {
    console.error("Error fetching clients:", clientsError)
    return { clients: [], totalClientCount: 0 }
  }

  if (clients.length === 0) {
    return { clients: [], totalClientCount: 0 }
  }
  
  // Store total count before filtering
  const totalClientCount = clients.length

  const clientIds = clients.map(c => c.id)

  // 2. Batch query all daily logs for all clients (28-day window)
  const { data: allLogs, error: logsError } = await supabaseAdmin
    .from("daily_logs")
    .select("*")
    .in("client_id", clientIds)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true })

  if (logsError) {
    console.error("Error fetching daily logs:", logsError)
    return { clients: [], totalClientCount }
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

  // 5. Get active training plans and session counts for all clients
  const { data: trainingPlans, error: plansError } = await supabaseAdmin
    .from("training_plans")
    .select(`
      id,
      client_id,
      training_sessions(
        id,
        session_type,
        day_of_week
      )
    `)
    .in("client_id", clientIds)
    .eq("status", "active")
    .is("deleted_at", null)

  if (plansError) {
    console.error("Error fetching training plans:", plansError)
  }

  // Group data by client
  const clientDataMap = new Map<string, {
    client: ClientInfo
    logs: DailyLog[]
    habits: DailyHabit[]
    habitLogs: DailyHabitLog[]
    plannedSessionCount: number
  }>()

  // Initialize map with clients
  clients.forEach(client => {
    clientDataMap.set(client.id, {
      client,
      logs: [],
      habits: [],
      habitLogs: [],
      plannedSessionCount: 0
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

  // Count planned training sessions per client
  if (trainingPlans) {
    trainingPlans.forEach((plan: TrainingPlanWithSessions) => {
      const clientData = clientDataMap.get(plan.client_id)
      if (clientData && plan.training_sessions) {
        // Count sessions where session_type = 'training' and day_of_week is not null
        const sessionCount = plan.training_sessions.filter(
          (session) => session.session_type === 'training' && session.day_of_week !== null
        ).length
        clientData.plannedSessionCount = sessionCount
      }
    })
  }

  // Evaluate triggers for each client
  const clientsWithAlerts: ClientWithAlerts[] = []

  for (const [clientId, data] of clientDataMap) {
    const alerts: AttentionAlert[] = []

    // Skip clients with no logs
    if (data.logs.length === 0) {
      continue
    }

    // Run all trigger evaluations
    const triggers: (TriggerResult | null)[] = [
      evaluateMoodEnergyDrop(data.logs, "mood"),
      evaluateMoodEnergyDrop(data.logs, "energy"),
      evaluateLoggingGap(data.logs, dateRange),
      evaluateNutritionMisses(data.logs),
      evaluateTrainingMisses(data.logs, data.plannedSessionCount),
      evaluateHighStress(data.logs),
      evaluateHabitDropoff(data.habitLogs, data.habits),
      evaluateActivityCalMismatch(data.logs)
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

  return { clients: clientsWithAlerts, totalClientCount }
}