/**
 * Application-wide constants
 * Extracted from various files to centralize magic numbers
 */

// Timing constants
export const RATE_LIMIT_RETRY_DELAY_MS = 1500;
export const DEBOUNCE_DELAY_MS = 300;

// Custom macros validation
export const CUSTOM_MACRO_CALORIE_TOLERANCE = 50; // Max allowed difference between stated calories and macro totals
export const WEEKLY_BUDGET_ROUNDING_TOLERANCE = 10; // Max cal difference for calorie skewing budget validation

// Nutrition adherence thresholds
export const NUTRITION_ADHERENCE_HIT_THRESHOLD = 50; // Within 50 calories = "hit"
export const NUTRITION_ADHERENCE_PARTIAL_THRESHOLD = 200; // Within 200 calories = "partial"

// Weekly nutrition adherence thresholds (per day, scaled by days_in_week)
// 7-day week: hit <= 350 cal, partial <= 1001 cal, missed > 1001 cal
export const WEEKLY_NUTRITION_HIT_PER_DAY = 50;
export const WEEKLY_NUTRITION_PARTIAL_PER_DAY = 143;

// Date limits
export const MAX_DATE_LOOKBACK_DAYS = 30;

// Pagination
export const CLIENT_CHECKINS_PAGE_SIZE = 20; // "Load older" page size for the coach per-client check-ins tab

// Trigger thresholds for attention alerts
export const MOOD_ENERGY_DROP_THRESHOLD = 2; // Points below average
export const MOOD_ENERGY_DROP_CONSECUTIVE_DAYS = 3;
export const MOOD_ENERGY_ROLLING_DAYS = 7;

export const LOGGING_GAP_THRESHOLD_DAYS = 3;

export const NUTRITION_MISSED_CONSECUTIVE_DAYS = 3;

export const TRAINING_MISSED_WEEKLY_THRESHOLD = 2; // Sessions per week
export const PARTIAL_TRAINING_LOOKBACK_EVENTS = 9;
export const PARTIAL_TRAINING_THRESHOLD = 3;

// No-engagement (disengaged-client) thresholds
export const NO_ENGAGEMENT_SILENCE_DAYS = 3; // No activity (logs/habits/completed sessions) in this many days
export const NO_ENGAGEMENT_ACTIVATION_GRACE_DAYS = 3; // Days after start_date before a silent client is flagged

export const HIGH_STRESS_THRESHOLD = 8; // Stress level
export const HIGH_STRESS_CONSECUTIVE_DAYS = 3;

export const HIGH_SORENESS_THRESHOLD = 8; // Soreness level
export const HIGH_SORENESS_CONSECUTIVE_DAYS = 3;

export const HABIT_DROPOFF_THRESHOLD_PERCENT = 50; // Completion rate %
export const HABIT_DROPOFF_DAYS_IN_WEEK = 5; // Days out of 7

export const ACTIVITY_CAL_MISMATCH_DAY_COUNT = 2; // Days in 28-day window
export const ACTIVITY_CAL_MISMATCH_WINDOW_DAYS = 28;

// Audit log action keys (see services/audit-log-service.ts + migration 108).
// Dotted "<entity>.<verb>" convention. Add new keys here as more mutation routes
// are instrumented.
export const AUDIT_ACTIONS = {
  CLIENT_ACTIVATE: "client.activate",
  GOAL_CREATE: "goal.create",
  BODY_METRICS_CREATE: "body_metrics.create",
  INTAKE_SYNC_METRICS: "intake.sync_metrics",
  NUTRITION_PLAN_CREATE: "nutrition_plan.create",
  NUTRITION_PLAN_DELETE: "nutrition_plan.delete",
  TRAINING_PLAN_PLACE: "training_plan.place",
  TRAINING_PLAN_CREATE: "training_plan.create",
  TRAINING_PLAN_AMEND: "training_plan.amend",
  PHASE_TRANSITION: "phase.transition",
  INVITATION_SEND: "invitation.send",
} as const;

export type AuditActionKey = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];