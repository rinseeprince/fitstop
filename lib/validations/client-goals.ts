import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateMessage = "Date must be in YYYY-MM-DD format";

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
 * invariant holds in practice. `goalDeadline` is format-only here: the
 * "not in the past" bound is enforced route-side against the coach's local today
 * (`getCoachTodayString`) — a server-clock bound in the schema would reject an
 * east-of-UTC coach's own today as past (same rule as `dailyHabitLogSchema`).
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
  });

export type UpdateGoalsInput = z.infer<typeof updateGoalsSchema>;
