import useSWR from "swr"
import { getDateDaysAgo, getTodayDateString } from "@/lib/date-helpers"
import { swrFetcher } from "@/lib/swr-fetcher"
import type { DailyLog } from "@/types/daily-log"

interface UseWellnessDataReturn {
  logs: DailyLog[]
  isLoading: boolean
}

export interface DailyLogRange {
  startDate: string
  endDate: string
}

interface UseWellnessDataOptions {
  /** How many days back the window starts. Default 28 (the wellness strip). */
  daysBack?: number
  /**
   * An explicit window instead of the rolling one — the check-in review reads
   * the period a check-in reported on. `null` fetches nothing (the key stays
   * null) for a caller whose window is not known yet; `undefined` keeps the
   * rolling default.
   */
  range?: DailyLogRange | null
}

// Stable empty: `data?.data || []` minted a fresh [] per unresolved render,
// so a consumer memo keyed on the array recomputed every time.
const NO_LOGS: DailyLog[] = []

/**
 * Rolling daily-log window for a client. Defaults reproduce the 28-day
 * wellness strip exactly; the Overview's wellness cards narrow it to 7 days and
 * the check-in review reads its own period, so the surfaces share one read
 * path rather than duplicating it.
 */
export function useWellnessData(
  clientId: string,
  options: UseWellnessDataOptions = {}
): UseWellnessDataReturn {
  const { daysBack = 28, range } = options
  const bounds =
    range === undefined
      ? { startDate: getDateDaysAgo(daysBack), endDate: getTodayDateString() }
      : range

  const { data: dailyData, isLoading } = useSWR<{ data: DailyLog[] }>(
    bounds
      ? `/api/clients/${clientId}/daily-logs?startDate=${bounds.startDate}&endDate=${bounds.endDate}`
      : null,
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  return {
    logs: dailyData?.data ?? NO_LOGS,
    isLoading,
  }
}
