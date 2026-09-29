import { z } from "zod";
import { isCalendarDay } from "@/lib/date-helpers";
import {
  HABIT_AMOUNT_MAX,
  HABIT_NOTE_MAX,
  HABIT_ORDER_MAX,
  HABIT_PROGRESS_WEEKS_DEFAULT,
  HABIT_PROGRESS_WEEKS_MAX,
} from "@/lib/constants";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";

// The habit routes' inputs (docs/HABITS-REBUILD-PLAN.md §2.4), every object
// strict. The date rules — a change, a stop or a one-date edit on today or a
// later day — are the habit functions', judged against the CLIENT's today; a
// bound here against a server clock would refuse a day that is already today
// where the client is. Whether a target fits the habit (a number habit has
// one, a tick habit none) is the functions' too: only they know the habit.

/** A calendar day, YYYY-MM-DD, that exists. */
export const habitDate = z.string().refine(isCalendarDay, { message: "Date must be a real day in YYYY-MM-DD format" });

/** A habit's id in a path: anything else is no habit. */
export const habitIdParam = z.string().uuid();

/**
 * A target or a number entry: zero or more, to two decimals (NUMERIC(10,2)).
 * The decimals are read off the number as written, so a value in exponent
 * notation (1e-7) or a float artefact (0.30000000000000004) is refused rather
 * than rounded by Postgres.
 */
const amount = z
  .number()
  .min(0)
  .max(HABIT_AMOUNT_MAX)
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(String(value)), { message: "At most two decimal places" });

const unique = (values: readonly string[]) => new Set(values).size === values.length;

const changeFields = {
  startsOn: habitDate.optional(),
  target: amount.nullable().optional(),
};

/**
 * A habit's target and days from a day — the client's today when absent:
 * chosen weekdays (every day is all seven), or N times a week — one or the
 * other, never both.
 */
export const changeHabitSchema = z.union([
  z
    .object({
      ...changeFields,
      weekdays: z.array(z.enum(DAYS_OF_WEEK)).min(1).max(7).refine(unique, { message: "Each weekday once" }),
    })
    .strict(),
  z.object({ ...changeFields, timesPerWeek: z.number().int().min(1).max(7) }).strict(),
]);

/** A habit stopped from a day — the client's today when absent. */
export const stopHabitSchema = z.object({ stopsOn: habitDate.optional() }).strict();

/** The client's habits in their new order: every one of them, stopped ones included, once. */
export const orderHabitsSchema = z
  .object({
    habitIds: z.array(z.string().uuid()).min(1).max(HABIT_ORDER_MAX).refine(unique, { message: "Each habit once" }),
  })
  .strict();

/** One date of a set-days habit: planned or not, and a planned number habit's own target (null: the version's). */
export const habitDayEditSchema = z
  .object({
    planned: z.boolean(),
    target: amount.nullable().optional(),
  })
  .strict()
  .refine((body) => body.planned || body.target == null, { message: "A day off has no target", path: ["target"] });

/** A note: trimmed, and an empty one is none. */
const note = z
  .string()
  .trim()
  .max(HABIT_NOTE_MAX)
  .transform((text) => text || null);

/**
 * The client's entry: a tick habit's `done`, or a number habit's `value` —
 * exactly one — and an optional note (null clears it; absent keeps it).
 */
export const habitEntrySchema = z.union([
  z.object({ done: z.boolean(), note: note.nullable().optional() }).strict(),
  z.object({ value: amount, note: note.nullable().optional() }).strict(),
]);

/** How many client weeks the Journey's habits show. */
export const habitProgressWeeksSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(HABIT_PROGRESS_WEEKS_MAX)
  .default(HABIT_PROGRESS_WEEKS_DEFAULT);
