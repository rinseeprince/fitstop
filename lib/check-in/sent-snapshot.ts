import { z } from "zod";
import { GOAL_TYPES } from "@/lib/goals/goal-types";
import { MEASUREMENT_KEYS, type MeasurementValues } from "@/lib/measurements/keys";

/**
 * A sent check-in, as it stood when the client sent it (migration 195;
 * docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d1, owner ruling 2026-09-22): the
 * readings they reported, the goal it was judged against and where they stood,
 * the week's food against its targets, their habits, the days they logged and
 * each question's wording. Saved once, in the statement that saves the
 * check-in, and never changed — the database refuses it (a write-once
 * trigger). Every check-in surface reads it, so nothing a coach does
 * afterwards — correcting a weigh-in, changing the goal, moving the start
 * date, switching a nutrition setting, switching a habit off, rewording a
 * question — moves a sent check-in. A correction changes the client's log.
 *
 * What it does not copy is the client's own logging of that week — their
 * workouts and sets, their food and their wellness: sending the check-in
 * closes the week (`resolveLogsOpenFrom`) and no coach screen edits it, so the
 * surfaces read those as they are.
 *
 * The shape is declared here once, with its version inside, and validated when
 * it is written (`parseSentSnapshot`) and when it is read (`readSentSnapshot`).
 * A later shape is a new version beside this one, never an edit of it: version
 * 2 records each goal row's trend as a word, where version 1 recorded yes or
 * no — moving towards the target or not — which reads as towards or away.
 */

export const SENT_SNAPSHOT_VERSION = 2;

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const NUMBER = z.number().finite();
const NUMBER_OR_NULL = NUMBER.nullable();

const readingsSchema = z
  .object(
    Object.fromEntries(MEASUREMENT_KEYS.map((key) => [key, NUMBER_OR_NULL])) as Record<
      (typeof MEASUREMENT_KEYS)[number],
      typeof NUMBER_OR_NULL
    >
  )
  .strict();

const POSITION = {
  current: NUMBER,
  remaining: NUMBER,
  percentComplete: NUMBER,
  status: z.enum(["approaching", "achieved", "overshot"]),
};
const PACE = z.enum(["on_track", "behind_pace", "unrealistic"]).optional();

const positionSchema = z
  .object({
    ...POSITION,
    /** Null with fewer than two check-ins carrying the metric: no trend yet. */
    trend: z.enum(["towards", "away", "unchanged"]).nullable(),
    paceStatus: PACE,
  })
  .strict();

/** Version 1's row: the trend as yes or no — moving towards the target, or not. */
const positionV1Schema = z.object({ ...POSITION, isOnTrack: z.boolean(), paceStatus: PACE }).strict();

/** The goal section's rows exactly as the review's comparison carries them. */
function goalProgressSchema<Position extends z.ZodTypeAny>(position: Position) {
  return z
    .object({
      weight: z
        .object({
          goal: NUMBER,
          startingWeight: NUMBER.optional(),
          goalStartWeight: NUMBER.optional(),
          position: position.nullable(),
        })
        .strict()
        .optional(),
      bodyFat: z
        .object({
          goal: NUMBER,
          startingBodyFat: NUMBER.optional(),
          goalStartBodyFat: NUMBER.optional(),
          position: position.nullable(),
        })
        .strict()
        .optional(),
      deadline: z
        .object({ date: DAY, daysRemaining: z.number().int(), isPastDeadline: z.boolean() })
        .strict()
        .optional(),
    })
    .strict();
}

/** The goal judged, as it stood on the check-in's day. */
const goalSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.enum(GOAL_TYPES),
    targetWeight: NUMBER_OR_NULL,
    targetBodyFatPercentage: NUMBER_OR_NULL,
    startsOn: DAY,
    deadline: DAY.nullable(),
  })
  .strict();

const nutritionDaySchema = z
  .object({
    date: DAY,
    dayOfWeek: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
    status: z.enum(["hit", "partial", "missed", "not_logged", "no_target"]),
    targetCalories: NUMBER_OR_NULL,
    targetProteinG: NUMBER_OR_NULL,
    targetCarbsG: NUMBER_OR_NULL,
    targetFatG: NUMBER_OR_NULL,
    actualCalories: NUMBER_OR_NULL,
    actualProteinG: NUMBER_OR_NULL,
    actualCarbsG: NUMBER_OR_NULL,
    actualFatG: NUMBER_OR_NULL,
  })
  .strict();

const DOT = z.enum(["complete", "partial", "missed", "no_log", "none"]);

const habitsSchema = z
  .object({
    rail: z.array(DOT),
    avgPct: NUMBER_OR_NULL,
    daysBelow50: z.number().int(),
    perHabit: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          eligibleDays: z.number().int(),
          completedDays: z.number().int(),
          pct: NUMBER_OR_NULL,
          rail: z.array(z.boolean().nullable()),
        })
        .strict()
    ),
  })
  .strict();

/** The week it reported on. */
const periodSchema = z
  .object({
    dates: z.array(DAY),
    loggedDates: z.array(DAY),
    /** The week's food against the targets of each day, as they stood. */
    nutrition: z.array(nutritionDaySchema),
    habits: habitsSchema,
  })
  .strict();

function sentSnapshotSchema<Version extends number, Position extends z.ZodTypeAny>(
  version: Version,
  position: Position
) {
  return z
    .object({
      version: z.literal(version),
      /** The check-in's day on the client's calendar when it was sent. */
      day: DAY,
      /** What the client reported — canonical kg / cm / % — null where the form carried none. */
      readings: readingsSchema,
      /** The reading as of the day the goal section judged: the reported one, else the newest before it. */
      standing: z.object({ weight: NUMBER_OR_NULL, bodyFat: NUMBER_OR_NULL }).strict(),
      /** The goal in force on the day, or null — none was. */
      goal: goalSchema.nullable(),
      goalProgress: goalProgressSchema(position),
      /** The nutrition plan covering the day — what the weight-drift note compares with. */
      nutritionPlan: z.object({ baseWeightKg: NUMBER_OR_NULL, effectiveFrom: DAY }).strict().nullable(),
      /** Null when the week cannot be resolved: a row from before periods were stored, with no schedule. */
      period: periodSchema.nullable(),
      /** Each question the client answered, in the wording they saw. */
      questions: z.array(z.object({ questionId: z.string().uuid(), prompt: z.string() }).strict()),
    })
    .strict();
}

const currentSchema = sentSnapshotSchema(SENT_SNAPSHOT_VERSION, positionSchema);
const version1Schema = sentSnapshotSchema(1, positionV1Schema);

/**
 * A saved copy as every reader has it: the current shape, with the version it
 * was saved at.
 */
export type SentSnapshot = Omit<z.infer<typeof currentSchema>, "version"> & {
  version: 1 | typeof SENT_SNAPSHOT_VERSION;
};

/**
 * Validates a snapshot before it is written. Throws: a copy that does not
 * match its declared shape is a defect in the code that built it, and saving
 * it would freeze the defect for ever.
 */
export function parseSentSnapshot(value: unknown): SentSnapshot {
  return currentSchema.parse(value);
}

/**
 * The stored copy, validated against the shape of the version it was saved
 * at. Null when the check-in has none yet — a row a seed script inserted and
 * the fill has not reached. Throws when it is there and does not match its
 * shape: that is corruption, never a state to render.
 */
export function readSentSnapshot(value: unknown): SentSnapshot | null {
  if (value == null) return null;
  if ((value as { version?: unknown }).version === 1) {
    return fromVersion1(matched(version1Schema.safeParse(value)));
  }
  return matched(currentSchema.safeParse(value));
}

function matched<Input, Output>(parsed: z.SafeParseReturnType<Input, Output>): Output {
  if (!parsed.success) {
    throw new Error(
      `A check-in's saved copy does not match its shape: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}

/**
 * A version 1 copy in the current shape. Its yes or no reads as towards or
 * away: it never recorded "no trend" or "unchanged", so a copy saved then
 * reads as it always did.
 */
function fromVersion1(copy: z.infer<typeof version1Schema>): SentSnapshot {
  const { weight, bodyFat, deadline } = copy.goalProgress;
  return {
    ...copy,
    goalProgress: {
      ...(weight && { weight: { ...weight, position: weight.position && withTrend(weight.position) } }),
      ...(bodyFat && { bodyFat: { ...bodyFat, position: bodyFat.position && withTrend(bodyFat.position) } }),
      ...(deadline && { deadline }),
    },
  };
}

function withTrend({
  isOnTrack,
  paceStatus,
  ...position
}: z.infer<typeof positionV1Schema>): z.infer<typeof positionSchema> {
  return {
    ...position,
    trend: isOnTrack ? "towards" : "away",
    ...(paceStatus === undefined ? {} : { paceStatus }),
  };
}

/** The readings a sent check-in reported, as the check-in object carries them. */
export function reportedReadings(snapshot: SentSnapshot | null): MeasurementValues {
  const values: MeasurementValues = {};
  if (!snapshot) return values;
  for (const key of MEASUREMENT_KEYS) {
    const value = snapshot.readings[key];
    if (value != null) values[key] = value;
  }
  return values;
}
