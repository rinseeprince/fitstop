import type { DailyLog } from "@/types/daily-log"
import type { ClientHabit, HabitEntryRead } from "@/types/habits"
import type { TriggerResult } from "./attention-triggers"
import type { TrainingEventRow } from "./attention-feed-helpers"
import {
  HABIT_MISSED_DAYS,
  HABIT_MISSED_WINDOW_DAYS,
  ACTIVITY_CAL_MISMATCH_DAY_COUNT,
  ACTIVITY_CAL_MISMATCH_WINDOW_DAYS,
} from "@/lib/constants"
import { addDaysToDateString } from "@/lib/date-helpers"
import { isTrainingLogStatus } from "@/lib/logged-days"
import { missedPlannedDates } from "@/lib/habits/habit-week"

/**
 * Missed habits, one line each (decision D4): a habit is listed when the
 * client missed at least HABIT_MISSED_DAYS of its planned days over the last
 * HABIT_MISSED_WINDOW_DAYS days gone by — the days before the feed's today, in
 * a row or not. A missed day is a planned day without the habit done on it,
 * a number short of its target included; a day made up on another day stays
 * missed on its own. A habit done a number of times a week plans no day, so
 * it is never listed. The missed days are the line's affected days, so a
 * dismissal (keyed by the habit, `alertDismissalKey`) lasts until the habit is
 * missed again on a later day.
 */
export function evaluateMissedHabits(
  habits: Pick<ClientHabit, "id" | "name" | "measure" | "direction" | "versions" | "dayEdits">[],
  entries: HabitEntryRead[],
  today: string
): TriggerResult[] {
  const days = Array.from({ length: HABIT_MISSED_WINDOW_DAYS }, (_, i) =>
    addDaysToDateString(today, i - HABIT_MISSED_WINDOW_DAYS)
  )
  return habits.flatMap((habit) => {
    const missed = missedPlannedDates(habit, entries, days)
    if (missed.length < HABIT_MISSED_DAYS) return []
    return [
      {
        type: "habit_missed" as const,
        severity: "medium" as const,
        message: `Missed ${habit.name} ${missed.length} days`,
        affectedDays: missed,
        metricData: [],
        habitId: habit.id,
      },
    ]
  })
}

/**
 * Evaluates if client ate as if they completed activities they actually skipped.
 * Reads training completion from training_events — sums estimated_calories from
 * the day's workouts the client never logged.
 *
 * A partly completed workout is a workout they DID, so it is not skipped
 * activity (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md, §4.7 M10): `completed`
 * says logged at any quality, so the one word answers it.
 */
export function evaluateActivityCalMismatch(
  logs: DailyLog[],
  events: TrainingEventRow[],
  now: Date = new Date()
): TriggerResult | null {
  // Only look at logs within the window
  const windowStart = new Date(now)
  windowStart.setDate(windowStart.getDate() - ACTIVITY_CAL_MISMATCH_WINDOW_DAYS)

  const recentLogs = logs.filter(log => {
    const logDate = new Date(log.date + 'T00:00:00')
    return logDate >= windowStart
  })

  const mismatchDays: string[] = []
  const metricData: Array<{ date: string; value: number }> = []

  for (const log of recentLogs) {
    if (!log.caloriesConsumed || !log.targetCalories) {
      continue
    }

    // Sum estimated calories from the day's workouts the client never logged
    let skippedActivityCalories = 0
    for (const event of events) {
      if (event.date === log.date && !isTrainingLogStatus(event.status) && event.estimated_calories && event.estimated_calories > 0) {
        skippedActivityCalories += event.estimated_calories
      }
    }

    // Target calories already includes planned activities, so if they skipped activities
    // but still ate the full target amount, they overate relative to what they actually did
    if (skippedActivityCalories > 0 &&
        log.caloriesConsumed >= log.targetCalories) {
      mismatchDays.push(log.date)
      metricData.push({ date: log.date, value: log.caloriesConsumed })
    }
  }

  // Check if we have enough mismatches AND at least one is recent (last 7 days)
  if (mismatchDays.length >= ACTIVITY_CAL_MISMATCH_DAY_COUNT) {
    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const hasRecentMismatch = mismatchDays.some(day => {
      const dayDate = new Date(day + 'T00:00:00')
      return dayDate >= sevenDaysAgo
    })

    if (hasRecentMismatch) {
      // Sort explicitly rather than trusting the order rows arrived in. These
      // two lines are built by iterating `recentLogs`, so they inherited the
      // query's ORDER BY — and when the attention feed's day-form reads
      // were flipped to date DESC (to stop truncation discarding the recent end),
      // `slice(-7)` silently started returning the OLDEST 7 points instead of
      // the newest. Sorting here makes both correct regardless of caller.
      const byDateAsc = <T extends { date: string }>(rows: T[]) =>
        [...rows].sort((a, b) => a.date.localeCompare(b.date))

      const orderedDays = [...mismatchDays].sort((a, b) => a.localeCompare(b))

      return {
        type: "activity_cal_mismatch",
        severity: "high",
        message: `Calorie intake matched planned activities despite skipping them on ${mismatchDays.length} days`,
        affectedDays: orderedDays.slice(0, ACTIVITY_CAL_MISMATCH_DAY_COUNT),
        metricData: byDateAsc(metricData).slice(-7) // most recent 7 data points
      }
    }
  }

  return null
}