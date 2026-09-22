import { z } from "zod";
import {
  GOAL_BODY_FAT_MAX,
  GOAL_BODY_FAT_MIN,
  GOAL_DESCRIPTION_MAX,
  GOAL_NAME_MAX,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";
import { GOAL_TYPES } from "@/lib/goals/goal-types";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateMessage = "Date must be in YYYY-MM-DD format";
const day = z.string().regex(dateRegex, dateMessage);

// Canonical units (CONVENTIONS §20): a weight target is kilograms — the form
// converts from the coach's unit before sending. The date rules (a start today
// or later, a deadline on or after its start and before the next goal's start)
// are the goal functions', against the CLIENT's today; a schema bound against a
// server clock would reject a day that is already today where the client is.

const targetWeight = z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX);
const targetBodyFat = z.number().min(GOAL_BODY_FAT_MIN).max(GOAL_BODY_FAT_MAX);
const name = z.string().trim().min(1).max(GOAL_NAME_MAX);
const description = z.string().trim().max(GOAL_DESCRIPTION_MAX);

/** A goal from today, or planned from a later day. The name defaults to the type's. */
export const addGoalSchema = z.object({
  type: z.enum(GOAL_TYPES),
  name: name.optional(),
  targetWeight: targetWeight.nullable().optional(),
  targetBodyFatPercentage: targetBodyFat.nullable().optional(),
  description: description.nullable().optional(),
  /** Absent = today. */
  startsOn: day.optional(),
  deadline: day.nullable().optional(),
});

/** A planned goal, or today's, rewritten whole — every field as it should stand. */
export const editGoalSchema = z.object({
  type: z.enum(GOAL_TYPES),
  name,
  targetWeight: targetWeight.nullable(),
  targetBodyFatPercentage: targetBodyFat.nullable(),
  description: description.nullable(),
  startsOn: day,
  deadline: day.nullable(),
});

export const goalDeadlineSchema = z.object({ deadline: day.nullable() });

export const renameGoalSchema = z.object({ name, description: description.nullable() });

/** The signed copy a delete handed out. */
export const restoreGoalSchema = z.object({ undo: z.string().min(1).max(20_000) });

/**
 * The client details sheet's goal fields, until commit 8d2 moves the goal to
 * its own sheet: a partial update, at least one field. `goalWeight` cannot be
 * cleared here (the sheet refuses it too); the other two accept null.
 */
export const updateGoalsSchema = z
  .object({
    goalWeight: targetWeight.optional(),
    goalBodyFatPercentage: targetBodyFat.nullable().optional(),
    goalDeadline: day.nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });
