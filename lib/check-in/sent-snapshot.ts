import { z } from "zod";
import { GOAL_TYPES } from "@/lib/goals/goal-types";
import { MEASUREMENT_KEYS, type MeasurementValues } from "@/lib/measurements/keys";
import { sumWeekFigures } from "@/lib/habits/habit-week";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { HabitPeriodWeek } from "@/types/habits";

/**
 * A sent check-in, as it stood when the client sent it (migration 195;
 * docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d1, owner ruling 2026-09-22): the
 * readings they reported, the goal it was judged against and where they stood,
 * the week's food against its targets, their habit week, the days they logged
 * and each question's wording. Saved once, in the statement that saves the
 * check-in, and never changed — the database refuses it (a write-once
 * trigger). Every check-in surface reads it, so nothing a coach does
 * afterwards — correcting a weigh-in, changing the goal, moving the start
 * date, switching a nutrition setting, changing or stopping a habit,
 * rewording a question — moves a sent check-in. A correction changes the
 * client's log.
 *
 * What it does not copy is the client's own logging of that week — their
 * workouts and sets, their food and their wellness: sending the check-in
 * closes the week (`resolveLogsOpenFrom`) and no coach screen edits it, so the
 * surfaces read those as they are.
 *
 * The shape is declared here once, with its version inside, and validated when
 * it is written (`parseSentSnapshot`) and when it is read (`readSentSnapshot`).
 * A later shape is a new version beside the earlier ones, never an edit of
 * one: version 3 holds the habit week as it was prescribed and as it happened
 * (docs/HABITS-REBUILD-PLAN.md §2.2 rule 9); version 2 held each habit's ticks
 * over the days it existed, which read as a tick habit planned on every one of
 * those days; version 1 also recorded each goal row's trend as yes or no —
 * moving towards the target or not — which reads as towards or away.
 */

export const SENT_SNAPSHOT_VERSION = 3;

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const NUMBER = z.number().finite();
const NUMBER_OR_NULL = NUMBER.nullable();
const WEEKDAY = z.enum(DAYS_OF_WEEK);

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
    dayOfWeek: WEEKDAY,
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

/** Versions 1 and 2's habits: the Overview's rail and, per habit, its ticks over the days it existed. */
const habitsV2Schema = z
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

const FIGURES = z
  .object({ planned: z.number().int(), done: z.number().int(), met: z.number().int() })
  .strict();

/**
 * Version 3's habit week (rule 9): each habit a version covered during the
 * period — its name as it stood and how it is measured, the day it first
 * started (before the period or in it: what tells a day before it had the
 * habit, "not yet added", from a gap or a stop, "not running"), its versions
 * running those days (the prescription, worded when read), each day as it
 * happened (covered, planned, that day's target, the entry with its note,
 * met) and the week's figures — and the week's totals.
 */
const habitWeekSchema = z
  .object({
    habits: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          measure: z.enum(["tick", "number"]),
          unit: z.string().nullable(),
          direction: z.enum(["at_least", "at_most"]).nullable(),
          firstStartsOn: DAY,
          versions: z.array(
            z
              .object({
                startsOn: DAY,
                endsOn: DAY.nullable(),
                target: NUMBER_OR_NULL,
                timesPerWeek: z.number().int().nullable(),
                weekdays: z.array(WEEKDAY),
              })
              .strict()
          ),
          days: z.array(
            z
              .object({
                date: DAY,
                covered: z.boolean(),
                planned: z.boolean(),
                target: NUMBER_OR_NULL,
                entry: z
                  .object({ done: z.boolean().nullable(), value: NUMBER_OR_NULL, note: z.string().nullable() })
                  .strict()
                  .nullable(),
                met: z.boolean(),
              })
              .strict()
          ),
          figures: FIGURES,
        })
        .strict()
    ),
    totals: FIGURES,
  })
  .strict();

/** The week it reported on, as versions 1 and 2 saved it. */
const periodV2Schema = z
  .object({
    dates: z.array(DAY),
    loggedDates: z.array(DAY),
    /** The week's food against the targets of each day, as they stood. */
    nutrition: z.array(nutritionDaySchema),
    habits: habitsV2Schema,
  })
  .strict();

/** The week it reported on. */
const periodSchema = z
  .object({
    dates: z.array(DAY),
    loggedDates: z.array(DAY),
    /** The week's food against the targets of each day, as they stood. */
    nutrition: z.array(nutritionDaySchema),
    /** The habit week as it was prescribed and as it happened. */
    habitWeek: habitWeekSchema,
  })
  .strict();

function sentSnapshotSchema<Version extends number, Position extends z.ZodTypeAny, Period extends z.ZodTypeAny>(
  version: Version,
  position: Position,
  period: Period
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
      period: period.nullable(),
      /** Each question the client answered, in the wording they saw. */
      questions: z.array(z.object({ questionId: z.string().uuid(), prompt: z.string() }).strict()),
    })
    .strict();
}

const currentSchema = sentSnapshotSchema(SENT_SNAPSHOT_VERSION, positionSchema, periodSchema);
const version2Schema = sentSnapshotSchema(2, positionSchema, periodV2Schema);
const version1Schema = sentSnapshotSchema(1, positionV1Schema, periodV2Schema);

/**
 * A saved copy as every reader has it: the current shape, with the version it
 * was saved at.
 */
export type SentSnapshot = Omit<z.infer<typeof currentSchema>, "version"> & {
  version: 1 | 2 | typeof SENT_SNAPSHOT_VERSION;
};

/** A sent check-in's habit week, as every reader has it. */
export type SentHabitWeek = z.infer<typeof habitWeekSchema>;

/** One habit of a sent check-in's habit week. */
type SentHabitRow = SentHabitWeek["habits"][number];

type Version2Copy = z.infer<typeof version2Schema>;

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
 * at and read into the current one. Null when the check-in has none yet — a
 * row a seed script inserted and the fill has not reached. Throws when it is
 * there and does not match its shape: that is corruption, never a state to
 * render.
 */
export function readSentSnapshot(value: unknown): SentSnapshot | null {
  if (value == null) return null;
  const version = (value as { version?: unknown }).version;
  if (version === 1) return fromVersion2(fromVersion1(matched(version1Schema.safeParse(value))));
  if (version === 2) return fromVersion2(matched(version2Schema.safeParse(value)));
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
 * A version 1 copy in version 2's shape. Its yes or no reads as towards or
 * away: it never recorded "no trend" or "unchanged", so a copy saved then
 * reads as it always did. It keeps the version it was saved at.
 */
function fromVersion1(copy: z.infer<typeof version1Schema>): Omit<Version2Copy, "version"> & { version: 1 } {
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

/**
 * A version 2 copy — or a version 1 copy read into version 2 — in the current
 * shape. It keeps the version it was saved at.
 */
function fromVersion2(copy: Omit<Version2Copy, "version"> & { version: 1 | 2 }): SentSnapshot {
  // Overwritten in place, so every key keeps the kernel's order.
  if (!copy.period) return { ...copy, period: null };
  const { habits, ...week } = copy.period;
  return { ...copy, period: { ...week, habitWeek: habitWeekFromVersion2(habits, copy.period.dates) } };
}

/**
 * Version 2's habits as a habit week (rule 9): each habit a tick habit planned
 * on every day it existed that week — every day from the first its rail
 * reaches, which is the day it first started as far as the copy can say —
 * with its ticks as its entries and the figures it froze, over the days done /
 * the days it existed. A habit that existed on none of the days says nothing
 * about the week and is left out, as the review always left it out. A rail
 * that does not line up with the week's days is corruption.
 */
function habitWeekFromVersion2(habits: z.infer<typeof habitsV2Schema>, dates: string[]): SentHabitWeek {
  const rows: SentHabitRow[] = habits.perHabit.flatMap((habit) => {
    if (habit.rail.length !== dates.length) {
      throw new Error(
        `A check-in's saved copy does not match its shape: habit ${habit.id}'s rail covers ${habit.rail.length} days of a ${dates.length}-day week`
      );
    }
    const first = habit.rail.findIndex((day) => day !== null);
    if (first === -1) return [];
    return [
      {
        id: habit.id,
        name: habit.name,
        measure: "tick" as const,
        unit: null,
        direction: null,
        firstStartsOn: dates[first],
        versions: [{ startsOn: dates[first], endsOn: null, target: null, timesPerWeek: null, weekdays: [...DAYS_OF_WEEK] }],
        days: dates.map((date, i) => {
          const ticked = habit.rail[i];
          if (ticked === null) return { date, covered: false, planned: false, target: null, entry: null, met: false };
          return {
            date,
            covered: true,
            planned: true,
            target: null,
            entry: ticked ? { done: true, value: null, note: null } : null,
            met: ticked,
          };
        }),
        figures: { planned: habit.eligibleDays, done: habit.completedDays, met: habit.completedDays },
      },
    ];
  });
  return { habits: rows, totals: sumWeekFigures(rows.map((row) => row.figures)) };
}

/**
 * The habit week a check-in freezes at Send, from the figures service's week
 * over its period: each habit's name and how it is measured, the day it first
 * started, its versions running those days, each day's facts and the week's
 * figures, and the totals — values, never references, so nothing a coach
 * changes later can reach them.
 */
export function composeHabitWeek(week: HabitPeriodWeek): SentHabitWeek {
  return {
    habits: week.habits.map(({ habit, firstStartsOn, versions, days, figures }) => ({
      id: habit.id,
      name: habit.name,
      measure: habit.measure,
      unit: habit.unit,
      direction: habit.direction,
      firstStartsOn,
      versions: versions.map(({ startsOn, endsOn, target, timesPerWeek, weekdays }) => ({
        startsOn,
        endsOn,
        target,
        timesPerWeek,
        weekdays,
      })),
      days: days.map(({ date, covered, planned, target, entry, met }) => ({ date, covered, planned, target, entry, met })),
      figures,
    })),
    totals: week.totals,
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
