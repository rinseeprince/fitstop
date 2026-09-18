import {
  getCheckInPeriodAdherence,
  getCheckInWithDetails,
  resolveCheckInReportingPeriod,
} from "./check-in-details-service";
import { getClientById } from "./client-service";
import { getDailyLogs } from "./daily-logs-service";
import { getCheckInNutritionPeriod } from "./nutrition-period-service";
import {
  getExerciseSummariesForPeriod,
  getTrainingEventDetailsForPeriod,
} from "./check-in-context-service";
import { buildCheckInComparison } from "./comparison-service";
import { getCoachUnitPreference } from "@/lib/viewer-preferences";
import {
  addDaysToDateString,
  expandDateRange,
  getTodayDateStringInTimezone,
} from "@/lib/date-helpers";
import type { CheckInReviewInput } from "@/types/check-in-review-input";

/**
 * What the AI review is given for one check-in, assembled from the review
 * page's own reads — the check-in and its client's words, the period's
 * workouts with their logs and exercise lines, the nutrition rows the check-in
 * froze, the habit figures, the day-form rows, and the comparison behind the
 * goal strip. The client's submit and the coach's Regenerate both call this,
 * so the two reviews of one check-in start from the same input.
 *
 * The unit system is the OWNING coach's: they read the review whoever
 * triggered it, and on the Regenerate route the authed coach is that coach
 * (the route proves ownership first).
 *
 * Reads are constant per check-in: the check-in with its answers and
 * highlights, the client, the coach's preference, then the period's reads in
 * parallel, then the exercise lines for the logged sessions. A failed read
 * throws — a review written from half the week would read as the week — except
 * the comparison, which degrades to null exactly as the page's goal strip does.
 *
 * Null when the check-in does not exist.
 */
export async function getCheckInReviewInput(
  checkInId: string
): Promise<CheckInReviewInput | null> {
  const checkIn = await getCheckInWithDetails(checkInId);
  if (!checkIn) return null;

  const client = await getClientById(checkIn.clientId);
  if (!client) return null;
  const viewer = await getCoachUnitPreference(client.coachId);

  const submittedOn = getTodayDateStringInTimezone(client.timezone, new Date(checkIn.createdAt));

  // The window the check-in reported on, as the page resolves it. A legacy row
  // with no stored period and no schedule to anchor a week to has none: the
  // page shows it no training, nutrition or habit figures, and the review is
  // given the six days up to its submission for the day-form rows alone.
  const period = await resolveCheckInReportingPeriod(checkIn);
  const window = period
    ? { start: period.periodStart, end: period.periodEnd }
    : { start: addDaysToDateString(submittedOn, -6), end: submittedOn };

  const [workouts, adherence, dailyLogs, nutrition, comparison] = await Promise.all([
    period
      ? getTrainingEventDetailsForPeriod(checkIn.clientId, window.start, window.end)
      : Promise.resolve([]),
    getCheckInPeriodAdherence(checkIn),
    getDailyLogs(checkIn.clientId, window.start, window.end),
    getCheckInNutritionPeriod(checkIn, window.start, window.end),
    buildCheckInComparison(checkIn, client).catch((error: unknown) => {
      console.error(
        "Check-in review: comparison read failed, the review is written without the goal strip:",
        error instanceof Error ? error.message : "Unknown error"
      );
      return null;
    }),
  ]);

  const loggedSessionLogIds = workouts
    .filter((workout) => workout.logStatus === "logged")
    .map((workout) => workout.sessionLogId)
    .filter((id): id is string => Boolean(id));
  const exerciseLines = await getExerciseSummariesForPeriod(loggedSessionLogIds, viewer);

  return {
    checkIn,
    clientName: client.name,
    submittedOn,
    viewer,
    dates: adherence?.dates ?? expandDateRange(window.start, window.end),
    loggedDates: adherence?.loggedDates ?? null,
    workouts,
    exerciseLines,
    nutrition,
    habits: adherence?.habits.perHabit ?? [],
    dailyLogs,
    comparison,
  };
}
