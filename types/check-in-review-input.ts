import type {
  CheckInTrainingEventDetail,
  CheckInWithDetails,
  GetCheckInComparisonResponse,
} from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";
import type { HabitBreakdown } from "@/types/coach-overview";
import type { NutritionDay } from "@/types/schedule";
import type { NutritionPeriodSummary } from "@/utils/nutrition-period-summary";
import type { UnitSystem } from "@/utils/unit-conversions";

/**
 * Everything the check-in AI review is given, assembled once per check-in by
 * `getCheckInReviewInput` (services/check-in-review-input-service.ts) from the
 * review page's own reads, and written into the prompt by
 * `buildCheckInReviewPrompt` (utils/ai-prompt-builder.ts). The client's submit
 * and the coach's Regenerate both go through it, so the two cannot differ.
 */
export type CheckInReviewInput = {
  checkIn: CheckInWithDetails;
  clientName: string;
  /** The check-in's day on the client's calendar — the day its readings were stamped with. */
  submittedOn: string;
  /** The COACH's unit system: they read the review, whoever triggered it. */
  viewer: UnitSystem;
  /** The week's dates, oldest first. */
  dates: string[];
  /**
   * Days in the week with any log the client made themselves — the one
   * definition (`loggedDays`, lib/logged-days.ts), read as the page's header
   * reads it. Null when a legacy row's period cannot be resolved.
   */
  loggedDates: string[] | null;
  /** The week's workouts in calendar order, each with the quality on its own log. */
  workouts: CheckInTrainingEventDetail[];
  /** One line per logged exercise, keyed by session log id, in the coach's units. */
  exerciseLines: Map<string, string[]>;
  /** The nutrition rows the check-in froze at send (live for a legacy row), and the kernel over them. */
  nutrition: { days: NutritionDay[]; summary: NutritionPeriodSummary };
  /** The habit figures as the page shows them: built from the habit list, one rail per habit over `dates`. */
  habits: HabitBreakdown[];
  /** The day-form rows: each day's wellness scores and the client's day note. */
  dailyLogs: DailyLog[];
  /** The comparison and goal strip as the page shows them; null when that read failed. */
  comparison: GetCheckInComparisonResponse | null;
};
