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

export function useWellnessData(clientId: string): UseWellnessDataReturn {
  const startDate = getDateDaysAgo(28)
  const endDate = getTodayDateString()

  const { data: dailyData, isLoading: dailyLoading } = useSWR<{ data: DailyLog[] }>(
    `/api/clients/${clientId}/daily-logs?startDate=${startDate}&endDate=${endDate}`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const { data: habitData, isLoading: habitLoading } = useSWR<{ data: HabitLogWithDetails[] }>(
    `/api/clients/${clientId}/habits/logs?startDate=${startDate}&endDate=${endDate}`,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  return {
    logs: dailyData?.data || [],
    habitLogs: habitData?.data || [],
    isLoading: dailyLoading || habitLoading,
  }
}
