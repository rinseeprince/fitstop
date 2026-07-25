/**
 * Strips health/PII fields from Sentry events before they leave the app.
 * Used in beforeSend and beforeBreadcrumb hooks.
 */

const SENSITIVE_KEYS = new Set([
  "weight",
  "bodyFat",
  "body_fat",
  "bodyFatPercentage",
  "body_fat_percentage",
  "currentWeight",
  "current_weight",
  "goalWeight",
  "goal_weight",
  "mood",
  "energy",
  "sleep",
  "stress",
  "soreness",
  "notes",
  "highlights",
  "measurements",
  "calories",
  "macros",
  "protein",
  "carb",
  "carbs",
  "fat",
  "bmr",
  "tdee",
  "coachResponse",
  "coach_response",
  "rawNotes",
  "raw_notes",
  "diet",
  "nutrition",
  "proteinG",
  "protein_g",
  "carbG",
  "carb_g",
  "fatG",
  "fat_g",
  "caloriesConsumed",
  "calories_consumed",
  "proteinConsumed",
  "protein_consumed",
  "sleepHours",
  "sleep_hours",
  "stressLevel",
  "stress_level",
  "energyLevel",
  "energy_level",
  "muscleSoreness",
  "muscle_soreness",
]);

 
export function scrubHealthData<T>(obj: T, depth = 0): T {
  // Prevent infinite recursion on deeply nested objects
  if (depth > 10 || obj == null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubHealthData(item, depth + 1)) as T;
  }

  const result = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = "[Scrubbed]";
    } else if (typeof result[key] === "object" && result[key] !== null) {
      result[key] = scrubHealthData(result[key], depth + 1);
    }
  }
  return result as T;
}
