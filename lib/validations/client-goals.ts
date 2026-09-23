import { z } from "zod";
import {
  GOAL_BODY_FAT_MAX,
  GOAL_BODY_FAT_MIN,
  GOAL_DESCRIPTION_MAX,
  GOAL_NAME_MAX,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
} from "@/lib/constants";
import { GOAL_TYPE_SETTINGS, GOAL_TYPES, type GoalType } from "@/lib/goals/goal-types";

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

/**
 * The target a goal's type needs — a weight to lose weight or build muscle, a
 * body fat for a recomp. Any other target is the coach's to add or leave out.
 */
function requireTheTypesTarget(
  goal: { type: GoalType; targetWeight?: number | null; targetBodyFatPercentage?: number | null },
  ctx: z.RefinementCtx
): void {
  const settings = GOAL_TYPE_SETTINGS[goal.type];
  if (settings.target === "weight" && goal.targetWeight == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetWeight"],
      message: `A ${settings.name} goal needs a target weight`,
    });
  }
  if (settings.target === "bodyFat" && goal.targetBodyFatPercentage == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetBodyFatPercentage"],
      message: `A ${settings.name} goal needs a target body fat`,
    });
  }
}

const goalFields = z.object({
  type: z.enum(GOAL_TYPES),
  name: name.optional(),
  targetWeight: targetWeight.nullable().optional(),
  targetBodyFatPercentage: targetBodyFat.nullable().optional(),
  description: description.nullable().optional(),
  deadline: day.nullable().optional(),
});

/** A client's first goal on the manual Add client: it starts on their today. */
export const firstGoalSchema = goalFields.superRefine(requireTheTypesTarget);

/** A goal from today, or planned from a later day. The name defaults to the type's. */
export const addGoalSchema = goalFields
  .extend({
    /** Absent = today. */
    startsOn: day.optional(),
  })
  .superRefine(requireTheTypesTarget);

/** A planned goal, or today's, rewritten whole — every field as it should stand. */
export const editGoalSchema = z
  .object({
    type: z.enum(GOAL_TYPES),
    name,
    targetWeight: targetWeight.nullable(),
    targetBodyFatPercentage: targetBodyFat.nullable(),
    description: description.nullable(),
    startsOn: day,
    deadline: day.nullable(),
  })
  .superRefine(requireTheTypesTarget);

export const goalDeadlineSchema = z.object({ deadline: day.nullable() });

export const renameGoalSchema = z.object({ name, description: description.nullable() });

/** The signed copy a delete handed out. */
export const restoreGoalSchema = z.object({ undo: z.string().min(1).max(20_000) });
