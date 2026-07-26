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

interface UseWellnessDataOptions {
  /** How many days back the window starts. Default 28 (the wellness strip). */
  daysBack?: number
  /** Fetch habit logs alongside the daily logs. Default true. */
  withHabitLogs?: boolean
}

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
  const { daysBack = 28, withHabitLogs = true } = options
  const startDate = getDateDaysAgo(daysBack)
  const endDate = getTodayDateString()

  const { data: dailyData, isLoading: dailyLoading } = useSWR<{ data: DailyLog[] }>(
    `/api/clients/${clientId}/daily-logs?startDate=${startDate}&endDate=${endDate}`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const { data: habitData, isLoading: habitLoading } = useSWR<{ data: HabitLogWithDetails[] }>(
    withHabitLogs
      ? `/api/clients/${clientId}/habits/logs?startDate=${startDate}&endDate=${endDate}`
      : null,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  return {
    logs: dailyData?.data || [],
    habitLogs: habitData?.data || [],
    isLoading: dailyLoading || habitLoading,
  }
}
