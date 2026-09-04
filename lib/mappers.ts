import type { ActivityLevel, CheckIn, Client, Coach, AIInsight, AIRecommendation, EnhancedAIData, ReminderPreferences } from "@/types/check-in";
import type { ClientIntake, ClientIntakeRow, OnboardingStatus } from "@/types/client-intake";
import type { MeasurementValues } from "@/lib/measurements/keys";
import { toUnitSystem } from "@/utils/unit-conversions";
import type {
  CheckInRow,
  ClientMeasurementEmbed,
  ClientRowWithMeasurements,
  CoachRow,
} from "./database-helpers";

/**
 * Map a database check-in row to a CheckIn type.
 *
 * A check-in owns no measurement columns: its readings are rows in the
 * measurement log stamped with its id, folded in by the caller
 * (`getMeasurementsForCheckIns`). The seven fields keep their PLACE in the
 * object so the JSON a route emits is byte-for-byte what it was — a mapper that
 * assigned them afterwards would move every key. Canonical kg/cm.
 */
export function mapCheckInRow(row: CheckInRow, measurements: MeasurementValues = {}): CheckIn {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status as "pending" | "ai_processed" | "reviewed",
    mood: row.mood ?? undefined,
    energy: row.energy ?? undefined,
    sleep: row.sleep ?? undefined,
    stress: row.stress ?? undefined,
    soreness: row.soreness ?? undefined,
    notes: row.notes ?? undefined,
    weight: measurements.weight,
    bodyFatPercentage: measurements.bodyFat,
    waist: measurements.waist,
    hips: measurements.hips,
    chest: measurements.chest,
    arms: measurements.arms,
    thighs: measurements.thighs,
    photoFront: row.photo_front ?? undefined,
    photoSide: row.photo_side ?? undefined,
    photoBack: row.photo_back ?? undefined,
    workoutsCompleted: row.workouts_completed ?? undefined,
    adherencePercentage: row.adherence_percentage ?? undefined,
    prs: row.prs ?? undefined,
    challenges: row.challenges ?? undefined,
    nutritionDaysOnTarget: row.nutrition_days_on_target ?? undefined,
    nutritionNotes: row.nutrition_notes ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    aiInsights: (row.ai_insights ?? undefined) as AIInsight[] | EnhancedAIData | undefined,
    aiRecommendations: (row.ai_recommendations ?? undefined) as AIRecommendation[] | undefined,
    aiResponseDraft: row.ai_response_draft ?? undefined,
    aiProcessedAt: row.ai_processed_at ?? undefined,
    coachResponse: row.coach_response ?? undefined,
    coachReviewedAt: row.coach_reviewed_at ?? undefined,
    responseSentAt: row.response_sent_at ?? undefined,
    periodStart: row.period_start ?? undefined,
    periodEnd: row.period_end ?? undefined,
    periodSnapshot: row.period_snapshot ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}

/** The value of one metric in an embedded measurement view, if the client has one. */
function embeddedReading(
  rows: ClientMeasurementEmbed[] | null | undefined,
  metricKey: "weight" | "bodyFat"
): number | undefined {
  const row = rows?.find((candidate) => candidate.metric_key === metricKey);
  return row?.value == null ? undefined : Number(row.value);
}

/**
 * Map a database client row to a Client type.
 *
 * The four reading fields come from the two measurement views embedded beside
 * the row — `client_current_measurements` for "now" (the newest reading of any
 * source) and `client_baseline_measurements` for "at the start" (the reading
 * as of `start_date`). A row read without the embeds maps them undefined; the
 * roster never reads them, and every single-client read carries the embeds.
 */
export function mapClientRow(row: ClientRowWithMeasurements): Client {
  return {
    id: row.id,
    coachId: row.coach_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url ?? undefined,
    notes: row.notes ?? undefined,
    active: row.active ?? true,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
    // Centimetres, canonical. No `heightUnit` companion any more: the shim that
    // used to sit here existed solely to keep client-settings-dialog's unit
    // <Select> from reading "in" and multiplying a save by 2.54 (178 -> 452).
    // That dialog now renders height in the VIEWER's units and converts back
    // through hooks/use-unit-inputs.ts, so the tag has no reader and no writer.
    height: row.height ?? undefined,
    gender: (row.gender ?? undefined) as "male" | "female" | "other" | undefined,
    dateOfBirth: row.date_of_birth ?? undefined,
    phone: row.phone ?? undefined,
    goalWeight: row.goal_weight ?? undefined,
    goalBodyFatPercentage: row.goal_body_fat_percentage ?? undefined,
    currentWeight: embeddedReading(row.client_current_measurements, "weight"),
    currentBodyFatPercentage: embeddedReading(row.client_current_measurements, "bodyFat"),
    bmr: row.bmr ?? undefined,
    tdee: row.tdee ?? undefined,
    workActivityLevel: (row.work_activity_level ?? undefined) as ActivityLevel | undefined,
    checkInFrequency: (row.check_in_frequency ?? "weekly") as "weekly" | "biweekly" | "monthly" | "none",
    checkInFrequencyDays: row.check_in_frequency_days ?? undefined,
    nextCheckInDue: row.next_check_in_due ?? undefined,
    lastReminderSentAt: row.last_reminder_sent_at ?? undefined,
    reminderPreferences: (row.reminder_preferences ?? undefined) as ReminderPreferences | undefined,
    totalCheckInsExpected: row.total_check_ins_expected ?? undefined,
    totalCheckInsCompleted: row.total_check_ins_completed ?? undefined,
    checkInAdherenceRate: row.check_in_adherence_rate ?? undefined,
    currentStreak: row.current_streak ?? undefined,
    longestStreak: row.longest_streak ?? undefined,
    // Display preferences.
    //
    // Normalized through toUnitSystem like mapCoachRow, so a NULL column reads
    // METRIC. It used to read imperial, which disagreed with all three of the
    // other defaults: the column's own DEFAULT (flipped to 'metric' by
    // migration 141), DEFAULT_UNIT_SYSTEM, and readClientPreference — which
    // serves the same client's preference to /api/me/unit-preference through
    // toUnitSystem. A client with a NULL preference was therefore shown metric
    // everywhere useUnits() reached, while this mapper told the settings form
    // and the nutrition drawer imperial.
    unitPreference: toUnitSystem(row.unit_preference),
    includeActivityBurn: row.include_activity_burn ?? true,
    surplusAsCarbs: row.surplus_as_carbs ?? false,
    startingWeight: embeddedReading(row.client_baseline_measurements, "weight"),
    startingBodyFatPercentage: embeddedReading(row.client_baseline_measurements, "bodyFat"),
    bmrManualOverride: row.bmr_manual_override ?? undefined,
    tdeeManualOverride: row.tdee_manual_override ?? undefined,
    welcomeMessage: row.welcome_message ?? undefined,
    onboardingStatus: (row.onboarding_status ?? undefined) as OnboardingStatus | undefined,
    walkthroughCompletedAt: row.walkthrough_completed_at ?? undefined,
    startDate: row.start_date ?? undefined,
    timezone: row.timezone,
  };
}

function pickAllowed<T>(source: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// Client-facing allowlist for a Client (M6). Every field a client may see about
// themselves is named; `notes` (the coach's private notes) is excluded, and any
// FUTURE coach-only column is excluded by default rather than shipped — the same
// "allowlist, don't denylist" posture as CLIENT_SELF_COLUMNS on the read path.
const CLIENT_SELF_KEYS = [
  "id", "coachId", "name", "email", "avatarUrl", "active", "createdAt", "updatedAt",
  "height", "gender", "dateOfBirth", "goalWeight", "goalBodyFatPercentage",
  "currentWeight", "currentBodyFatPercentage", "bmr", "tdee",
  "checkInFrequency", "checkInFrequencyDays", "nextCheckInDue", "lastReminderSentAt",
  "reminderPreferences", "totalCheckInsExpected", "totalCheckInsCompleted",
  "checkInAdherenceRate", "currentStreak", "longestStreak", "unitPreference",
  "includeActivityBurn", "surplusAsCarbs", "startingWeight", "startingBodyFatPercentage",
  "bmrManualOverride", "tdeeManualOverride", "welcomeMessage", "onboardingStatus",
  "walkthroughCompletedAt", "startDate", "timezone", "logsOpenFrom",
] as const satisfies readonly (keyof Client)[];

export function toClientSelfView(client: Client): Partial<Client> {
  return pickAllowed(client, CLIENT_SELF_KEYS);
}

// Client-facing allowlist for a ClientIntake (M6). Excludes `coachReviewNotes`
// (the coach's private review field, "Only visible to you"); every other field
// is client-entered or non-sensitive. Allowlist so a future coach-only field is
// excluded by default.
const CLIENT_INTAKE_KEYS = [
  "id", "clientId", "status", "dateOfBirth", "gender", "height",
  "currentWeight", "bodyFatPercentage", "workActivityLevel", "primaryGoal",
  "goalDetails", "targetWeight", "goalBodyFatPercentage", "goalDeadline", "goalDescription",
  "motivation", "trainingExperienceLevel", "trainingTimePreference", "trainingLocation",
  "availableEquipment", "daysPerWeek", "sessionDurationMinutes", "dietaryRequirements",
  "cookingFrequency", "nutritionNotes", "foodAllergies", "dietDescription",
  "hasTrackedMacrosBefore", "mealsPerDay", "biggestNutritionChallenge",
  "injuriesOrLimitations", "medicalNotes", "previousCoachingExperience",
  "previousCoachingDetails", "anythingElse", "startedAt",
  "completedAt", "createdAt", "updatedAt",
] as const satisfies readonly (keyof ClientIntake)[];

export function toClientFacingIntake(intake: ClientIntake): Partial<ClientIntake> {
  return pickAllowed(intake, CLIENT_INTAKE_KEYS);
}

// Client-facing allowlist for a CheckIn. The AI fields (aiSummary, aiInsights,
// aiRecommendations, aiResponseDraft, aiProcessedAt) are coach-only analysis —
// the AI prompt targets the coach and surfaces disordered-eating/injury risk,
// and aiResponseDraft is the coach's UNSENT drafted reply. coachResponse stays
// (it is the coach's reply TO the client). Allowlist, not denylist, so a future
// coach-only column is excluded by default rather than shipped.
const CLIENT_FACING_CHECKIN_KEYS = [
  "id", "clientId", "clientName", "clientAvatarUrl", "status",
  "mood", "energy", "sleep", "stress", "soreness", "notes",
  "weight", "bodyFatPercentage", "waist", "hips", "chest", "arms",
  "thighs",
  "photoFront", "photoSide", "photoBack",
  "workoutsCompleted", "adherencePercentage", "prs", "challenges",
  "nutritionDaysOnTarget", "nutritionNotes",
  "coachResponse", "coachReviewedAt", "responseSentAt",
  "periodStart", "periodEnd", "periodSnapshot",
  "createdAt", "updatedAt",
] as const satisfies readonly (keyof CheckIn)[];

export function toClientFacingCheckIn(checkIn: CheckIn): Partial<CheckIn> {
  return pickAllowed(checkIn, CLIENT_FACING_CHECKIN_KEYS);
}

/**
 * Map a database coach row to a Coach type
 */
export function mapCoachRow(row: CoachRow): Coach {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url ?? undefined,
    timezone: row.timezone,
    unitPreference: toUnitSystem(row.unit_preference),
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Map a database client_intake row to a ClientIntake type
 */
export function mapClientIntakeRow(row: ClientIntakeRow): ClientIntake {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status as ClientIntake["status"],
    dateOfBirth: row.date_of_birth ?? undefined,
    gender: (row.gender ?? undefined) as ClientIntake["gender"],
    height: row.height ?? undefined,
    currentWeight: row.current_weight ?? undefined,
    bodyFatPercentage: row.body_fat_percentage ?? undefined,
    workActivityLevel: (row.work_activity_level ?? undefined) as ClientIntake["workActivityLevel"],
    primaryGoal: (row.primary_goal ?? undefined) as ClientIntake["primaryGoal"],
    goalDetails: row.goal_details ?? undefined,
    targetWeight: row.target_weight ?? undefined,
    goalBodyFatPercentage: row.goal_body_fat_percentage ?? undefined,
    goalDeadline: row.goal_deadline ?? undefined,
    goalDescription: row.goal_description ?? undefined,
    motivation: row.motivation ?? undefined,
    trainingExperienceLevel: (row.training_experience_level ?? undefined) as ClientIntake["trainingExperienceLevel"],
    trainingTimePreference: (row.training_time_preference ?? undefined) as ClientIntake["trainingTimePreference"],
    trainingLocation: (row.training_location ?? undefined) as ClientIntake["trainingLocation"],
    availableEquipment: row.available_equipment ?? undefined,
    daysPerWeek: row.days_per_week ?? undefined,
    sessionDurationMinutes: row.session_duration_minutes ?? undefined,
    dietaryRequirements: row.dietary_requirements ?? undefined,
    cookingFrequency: (row.cooking_frequency ?? undefined) as ClientIntake["cookingFrequency"],
    nutritionNotes: row.nutrition_notes ?? undefined,
    foodAllergies: row.food_allergies ?? undefined,
    dietDescription: row.diet_description ?? undefined,
    hasTrackedMacrosBefore: row.has_tracked_macros_before ?? undefined,
    mealsPerDay: row.meals_per_day ?? undefined,
    biggestNutritionChallenge: row.biggest_nutrition_challenge ?? undefined,
    injuriesOrLimitations: row.injuries_or_limitations ?? undefined,
    medicalNotes: row.medical_notes ?? undefined,
    previousCoachingExperience: row.previous_coaching_experience ?? undefined,
    previousCoachingDetails: row.previous_coaching_details ?? undefined,
    anythingElse: row.anything_else ?? undefined,
    coachReviewNotes: row.coach_review_notes ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}