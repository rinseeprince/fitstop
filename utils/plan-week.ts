import { differenceInDays } from "@/lib/date-helpers";

/**
 * Which week of a placed training plan a given date falls in (1-based).
 *
 * Mirrors the canonical date-walk math (services/plan-amendment-service.ts:
 * slotPosition = daysBetween(effective_from, date), week = floor(position / 7)):
 * week N covers days [7*(N-1), 7*N) after effective_from. Returns null when
 * today is before the plan starts or past the authored window; a plan with no
 * duration is open-ended, so the computed week is returned uncapped.
 */
export function planWeek(
  effectiveFrom: string,
  todayStr: string,
  durationWeeks: number | null | undefined
): number | null {
  if (todayStr < effectiveFrom) return null;
  const elapsedDays = differenceInDays(
    new Date(todayStr + "T00:00:00"),
    new Date(effectiveFrom + "T00:00:00")
  );
  const week = Math.floor(elapsedDays / 7) + 1;
  if (durationWeeks != null && week > durationWeeks) return null;
  return week;
}
