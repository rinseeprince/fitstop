/**
 * Application-wide constants
 * Extracted from various files to centralize magic numbers
 */

// Timing constants
export const RATE_LIMIT_RETRY_DELAY_MS = 1500;
export const DEBOUNCE_DELAY_MS = 300;

// Custom macros validation
export const CUSTOM_MACRO_CALORIE_TOLERANCE = 50; // Max allowed difference between stated calories and macro totals

// Nutrition adherence thresholds
export const NUTRITION_ADHERENCE_HIT_THRESHOLD = 50; // Within 50 calories = "hit"
export const NUTRITION_ADHERENCE_PARTIAL_THRESHOLD = 200; // Within 200 calories = "partial"

// Date limits
export const MAX_DATE_LOOKBACK_DAYS = 30;

// Trigger thresholds for attention alerts
export const MOOD_ENERGY_DROP_THRESHOLD = 2; // Points below average
export const MOOD_ENERGY_DROP_CONSECUTIVE_DAYS = 3;
export const MOOD_ENERGY_ROLLING_DAYS = 7;

export const LOGGING_GAP_THRESHOLD_DAYS = 3;

export const NUTRITION_MISSED_CONSECUTIVE_DAYS = 3;

export const TRAINING_MISSED_WEEKLY_THRESHOLD = 2; // Sessions per week

export const HIGH_STRESS_THRESHOLD = 8; // Stress level
export const HIGH_STRESS_CONSECUTIVE_DAYS = 3;

export const HABIT_DROPOFF_THRESHOLD_PERCENT = 50; // Completion rate %
export const HABIT_DROPOFF_DAYS_IN_WEEK = 5; // Days out of 7

export const ACTIVITY_CAL_MISMATCH_DAY_COUNT = 2; // Days in 28-day window
export const ACTIVITY_CAL_MISMATCH_WINDOW_DAYS = 28;