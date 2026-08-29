import useSWR from "swr"
import { getDateDaysAgo, getTodayDateString } from "@/lib/date-helpers"
import { swrFetcher } from "@/lib/swr-fetcher"
import type { DailyLog } from "@/types/daily-log"
import type { HabitLogWithDetails } from "@/types/daily-habit"

interface UseWellnessDataReturn {
  logs: DailyLog[]
  habitLogs: HabitLogWithDetails[]
  isLoading: boolean
}

export interface DailyLogRange {
  startDate: string
  endDate: string
}

interface UseWellnessDataOptions {
  /** How many days back the window starts. Default 28 (the wellness strip). */
  daysBack?: number
  /** Fetch habit logs alongside the daily logs. Default true. */
  withHabitLogs?: boolean
  /**
   * An explicit window instead of the rolling one — the check-in review reads
   * the period a check-in reported on. `null` fetches nothing (both keys stay
   * null) for a caller whose window is not known yet; `undefined` keeps the
   * rolling default.
   */
  range?: DailyLogRange | null
}

// Stable empties: `data?.data || []` minted a fresh [] per unresolved render,
// so a consumer memo keyed on the array recomputed every time.
const NO_LOGS: DailyLog[] = []
const NO_HABIT_LOGS: HabitLogWithDetails[] = []

/**
 * Rolling daily-log window for a client, plus (optionally) that window's habit
 * logs. Defaults reproduce the 28-day wellness strip exactly; the Overview's
 * wellness cards narrow it to 7 days and skip the habit fetch they don't use,
 * so the two surfaces share one read path rather than duplicating it.
 */
export function useWellnessData(
  clientId: string,
  options: UseWellnessDataOptions = {}
): UseWellnessDataReturn {
  const { daysBack = 28, withHabitLogs = true, range } = options
  const bounds =
    range === undefined
      ? { startDate: getDateDaysAgo(daysBack), endDate: getTodayDateString() }
      : range

  const { data: dailyData, isLoading: dailyLoading } = useSWR<{ data: DailyLog[] }>(
    bounds
      ? `/api/clients/${clientId}/daily-logs?startDate=${bounds.startDate}&endDate=${bounds.endDate}`
      : null,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const { data: habitData, isLoading: habitLoading } = useSWR<{ data: HabitLogWithDetails[] }>(
    bounds && withHabitLogs
      ? `/api/clients/${clientId}/habits/logs?startDate=${bounds.startDate}&endDate=${bounds.endDate}`
      : null,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  return {
    logs: dailyData?.data ?? NO_LOGS,
    habitLogs: habitData?.data ?? NO_HABIT_LOGS,
    isLoading: dailyLoading || habitLoading,
  }
}
