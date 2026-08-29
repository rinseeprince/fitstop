"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { swrFetcher } from "@/lib/swr-fetcher";
import { expandDateRange, getDateString } from "@/lib/date-helpers";
import { useWellnessData, type DailyLogRange } from "@/hooks/use-wellness-data";
import type { CheckInWithDetails, GetCheckInComparisonResponse } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";

type FullWeekTarget = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

// GET /api/check-in/[id] answers this bare pair — a pre-existing deviation from
// the { success, data } envelope, carried rather than codified.
type CheckInWithClient = {
  checkIn: CheckInWithDetails;
  client: {
    id: string;
    name: string;
    email?: string;
    avatar_url?: string;
  } | null;
};

type PlanTarget = {
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
};
type PlanTargetsResponse = { targets: PlanTarget[] };

const SWR_OPTS = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
};

// Key construction and invalidation are co-located (CONVENTIONS §7). The
// per-check-in area is the detail and everything under it (its comparison).
export const checkInDetailKey = (checkInId: string) => `/api/check-in/${checkInId}`;
const checkInComparisonKey = (checkInId: string) =>
  `${checkInDetailKey(checkInId)}/comparison`;
// The review is this endpoint's only reader, so its key lives here too.
const planTargetsKey = (clientId: string, dates: string[]) =>
  `/api/clients/${clientId}/nutrition/plan-targets?dates=${dates.join(",")}`;

/**
 * Revalidates every cached read of one check-in (detail + comparison) from
 * outside the hooks that read it — the ONE sanctioned way (CONVENTIONS §7).
 */
export function useInvalidateCheckInDetail() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (checkInId: string) => {
      const key = checkInDetailKey(checkInId);
      // Exact-or-child rather than a bare prefix: ids are opaque strings, and
      // a bare startsWith would let one id match another that begins with it.
      return mutate(
        (k) => typeof k === "string" && (k === key || k.startsWith(`${key}/`))
      );
    },
    [mutate]
  );
}

function useCheckInDetail(checkInId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<CheckInWithClient>(
    checkInId ? checkInDetailKey(checkInId) : null,
    swrFetcher,
    {
      ...SWR_OPTS,
      onError: (err) => console.error("Failed to fetch check-in:", err),
    }
  );
  return { data: data ?? null, isLoading, isError: !!error, mutate };
}

function useCheckInComparison(checkInId: string | null) {
  const { data, error, isLoading } = useSWR<GetCheckInComparisonResponse>(
    checkInId ? checkInComparisonKey(checkInId) : null,
    swrFetcher,
    {
      ...SWR_OPTS,
      onError: (err) => console.error("Failed to fetch check-in comparison:", err),
    }
  );
  return { data: data ?? null, isLoading, isError: !!error };
}

/**
 * The daily-log window a check-in reports on: the stored period, else the six
 * days up to its submission (rows from before Session 6.4 carry no period).
 * Local-midnight Dates, so the meta line and the cards agree on the days.
 */
export function resolveCheckInDetailWindow(
  checkIn: Pick<CheckInWithDetails, "periodStart" | "periodEnd" | "createdAt">
): { start: Date; end: Date } {
  if (checkIn.periodStart && checkIn.periodEnd) {
    return {
      start: new Date(checkIn.periodStart + "T00:00:00"),
      end: new Date(checkIn.periodEnd + "T00:00:00"),
    };
  }
  const end = new Date(checkIn.createdAt);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start, end };
}

/** The window's dates with no daily log — the ones whose target must come from the plan. */
export function unloggedDates(range: DailyLogRange, logs: DailyLog[]): string[] {
  const logged = new Set(logs.map((log) => log.date));
  return expandDateRange(range.startDate, range.endDate).filter((date) => !logged.has(date));
}

/**
 * The week's nutrition target: every logged day's own snapshotted target plus
 * the plan target for each unlogged day, so a half-logged week is measured
 * against its whole window rather than the days that happen to have a log.
 */
export function buildFullWeekTarget(
  logs: DailyLog[],
  planTargets: PlanTarget[]
): FullWeekTarget {
  const total = { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const log of logs) {
    total.calories += log.targetCalories ?? 0;
    total.proteinG += log.targetProteinG ?? 0;
    total.carbsG += log.targetCarbsG ?? 0;
    total.fatG += log.targetFatG ?? 0;
  }
  for (const target of planTargets) {
    total.calories += target.calories ?? 0;
    total.proteinG += target.proteinG ?? 0;
    total.carbsG += target.carbsG ?? 0;
    total.fatG += target.fatG ?? 0;
  }
  return total;
}

type UseCheckInDetailDataProps = {
  checkInId: string | null;
  clientId: string;
};

/**
 * Everything the review surface renders for one check-in: the detail and its
 * comparison (parallel), then the window's daily + habit logs (parallel), then
 * the plan targets for the window's unlogged days — the same three stages the
 * raw-fetch version ran, now cached and deduped by SWR.
 */
export function useCheckInDetailData({ checkInId, clientId }: UseCheckInDetailDataProps) {
  const detail = useCheckInDetail(checkInId);
  const comparison = useCheckInComparison(checkInId);
  const checkIn = detail.data?.checkIn ?? null;

  // The detail is fetched by check-in id but the context by the page's client
  // id, and the API refuses only a FOREIGN coach — a coach's own other-client
  // id would pair one client's check-in with another's logs and targets. A
  // mismatch renders as an error and fetches no context at all.
  const isForeign = checkIn !== null && checkIn.clientId !== clientId;

  const period = useMemo(
    () => (checkIn && !isForeign ? resolveCheckInDetailWindow(checkIn) : null),
    [checkIn, isForeign]
  );
  const range = useMemo<DailyLogRange | null>(
    () =>
      period
        ? { startDate: getDateString(period.start), endDate: getDateString(period.end) }
        : null,
    [period]
  );

  const { logs: dailyLogs, habitLogs, isLoading: logsLoading } = useWellnessData(clientId, {
    range,
  });

  const datesNeedingPlanTarget = useMemo(
    () => (range && !logsLoading ? unloggedDates(range, dailyLogs) : []),
    [range, logsLoading, dailyLogs]
  );
  const { data: planTargets, isLoading: planTargetsLoading } = useSWR<PlanTargetsResponse>(
    datesNeedingPlanTarget.length > 0 ? planTargetsKey(clientId, datesNeedingPlanTarget) : null,
    swrFetcher,
    {
      ...SWR_OPTS,
      onError: (err) => console.error("Failed to fetch plan targets:", err),
    }
  );

  const fullWeekTarget = useMemo<FullWeekTarget | null>(() => {
    if (!range || logsLoading) return null;
    if (datesNeedingPlanTarget.length === 0) return buildFullWeekTarget(dailyLogs, []);
    // Still loading, or failed: null hands the ribbon its logged-days fallback.
    if (!planTargets) return null;
    return buildFullWeekTarget(dailyLogs, planTargets.targets ?? []);
  }, [range, logsLoading, datesNeedingPlanTarget, dailyLogs, planTargets]);

  const { mutate: mutateDetail } = detail;
  // After Regenerate the rail asks for the fresh review; the bound mutate
  // revalidates exactly this detail in place.
  const refreshDetail = useCallback(() => {
    void mutateDetail();
  }, [mutateDetail]);

  return {
    data: detail.data,
    isLoading: detail.isLoading,
    isError: detail.isError,
    isForeign,
    comparisonData: comparison.data,
    isLoadingComparison: comparison.isLoading,
    dailyLogs,
    habitLogs,
    dailyContextLoading: period !== null && (logsLoading || planTargetsLoading),
    contextStartDate: period?.start ?? null,
    contextEndDate: period?.end ?? null,
    fullWeekTarget,
    refreshDetail,
  };
}
