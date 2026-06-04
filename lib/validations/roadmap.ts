import { z } from "zod";
import { getTodayDateString } from "@/lib/date-helpers";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateMessage = "Date must be in YYYY-MM-DD format";

/**
 * Schema for creating a new roadmap
 */
export const createRoadmapSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  longTermGoal: z.string().max(2000).optional(),
  startedAt: z.string().regex(dateRegex, dateMessage).optional(),
  targetEndDate: z.string().regex(dateRegex, dateMessage).optional(),
});

/**
 * Schema for updating a roadmap (all fields optional, at least one required)
 */
export const updateRoadmapSchema = createRoadmapSchema.partial().refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: "At least one field must be provided" }
);

export const milestoneSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(500),
  completed: z.boolean(),
  completed_at: z.string().datetime().nullable(),
});

/**
 * Schema for creating a new phase
 */
export const createPhaseSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  // nullable so the edit dialog can clear a previously-set value: it sends null
  // (not undefined) for emptied fields, and updatePhase's presence-based merge
  // writes that null to clear the column. Matches the goal fields below.
  description: z.string().max(2000).nullable().optional(),
  objectives: z.string().max(2000).nullable().optional(),
  startDate: z.string().regex(dateRegex, dateMessage).nullable().optional(),
  endDate: z.string().regex(dateRegex, dateMessage).nullable().optional(),
  durationWeeks: z.number().int().min(1).max(104).optional(),
  orderIndex: z.number().int().min(0).optional(),
  phaseGoalWeight: z.number().min(20).max(700).nullable().optional(),
  phaseGoalBodyFatPercentage: z.number().min(3).max(60).nullable().optional(),
  milestones: z.array(milestoneSchema).max(20).optional(),
});

/**
 * Schema for updating a phase (all fields optional, at least one required)
 */
export const updatePhaseSchema = createPhaseSchema.partial().refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: "At least one field must be provided" }
);

/**
 * Schema for updating client goals (all fields optional, at least one required).
 *
 * This is a partial-UPDATE schema: every field is optional and at least one must
 * be present. Optional fields are `.nullable()` so the coach Goals editor can
 * CLEAR a previously-set value — it sends explicit null (not undefined) for an
 * emptied field, and updateGoals' presence-based merge writes that null to clear
 * the column. `goalWeight` is NOT nullable: it cannot be cleared to null. It may
 * still be omitted on a partial update (updateGoals carries the existing weight
 * forward); the Goals editor always supplies it, so the "every goal has a weight"
 * invariant holds in practice. `goalDeadline` rejects past dates — a past
 * deadline is what produced the check-in "unrealistic" false alarm.
 */
export const updateGoalsSchema = z
  .object({
    goalWeight: z.number().min(20).max(700).optional(),
    goalBodyFatPercentage: z.number().min(3).max(60).nullable().optional(),
    goalDeadline: z.string().regex(dateRegex, dateMessage).nullable().optional(),
    goalStartDate: z.string().regex(dateRegex, dateMessage).nullable().optional(),
    primaryGoal: z.string().max(500).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  })
  .refine((data) => !data.goalDeadline || data.goalDeadline >= getTodayDateString(), {
    message: "Goal deadline cannot be in the past",
    path: ["goalDeadline"],
  });

export type CreateRoadmapInput = z.infer<typeof createRoadmapSchema>;
export type UpdateRoadmapInput = z.infer<typeof updateRoadmapSchema>;
export type CreatePhaseInput = z.infer<typeof createPhaseSchema>;
export type UpdatePhaseInput = z.infer<typeof updatePhaseSchema>;
export type UpdateGoalsInput = z.infer<typeof updateGoalsSchema>;
