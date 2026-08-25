import { z } from "zod";
import { WEIGHT_KG_MAX, WEIGHT_KG_MIN } from "@/lib/constants";

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
 *
 * `goalWeight` is canonical KILOGRAMS (migration 141) — the Overview's inline
 * editor converts from the coach's unit before sending, through
 * `useCanonicalInput`. Its bound was `.max(700)`, a pounds ceiling left over
 * from display-unit storage.
 */
export const updateGoalsSchema = z
  .object({
    goalWeight: z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX).optional(),
    goalBodyFatPercentage: z.number().min(3).max(60).nullable().optional(),
    goalDeadline: z.string().regex(dateRegex, dateMessage).nullable().optional(),
    goalStartDate: z.string().regex(dateRegex, dateMessage).nullable().optional(),
    primaryGoal: z.string().max(500).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  })
  // A goal cannot start after it ends. Nothing checked this until the Overview
  // editor put both dates in one form, one keystroke apart — before that they
  // were set on separate screens and the combination was never expressible in a
  // single payload.
  //
  // **Known hole, and it is real rather than theoretical.** A refine only sees
  // the payload, so a PARTIAL update carrying just one of the two passes here and
  // can still land an invalid pair against the stored value. That matters for
  // React Native, whose contract this schema is — "the browser form always sends
  // both" says nothing about it. The complete check belongs inside `updateGoals`
  // after its merge, the one place both final values are known; it is unbuilt
  // because this session has no other reason to touch that merge, NOT because
  // the hole is unreachable.
  .refine(
    (data) =>
      !(data.goalStartDate && data.goalDeadline) ||
      data.goalStartDate <= data.goalDeadline,
    {
      message: "Start date must be on or before the deadline",
      path: ["goalStartDate"],
    }
  );

