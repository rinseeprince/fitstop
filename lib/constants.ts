/**
 * Application-wide constants
 * Extracted from various files to centralize magic numbers
 */

// Timing constants
export const RATE_LIMIT_RETRY_DELAY_MS = 1500;
export const DEBOUNCE_DELAY_MS = 300;

// Nutrition adherence thresholds
export const NUTRITION_ADHERENCE_HIT_THRESHOLD = 50; // Within 50 calories = "hit"
export const NUTRITION_ADHERENCE_PARTIAL_THRESHOLD = 200; // Within 200 calories = "partial"

// Date limits
export const MAX_DATE_LOOKBACK_DAYS = 30;