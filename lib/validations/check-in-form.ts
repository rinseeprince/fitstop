import { z } from "zod";
import { MAX_CHECK_IN_QUESTIONS } from "@/lib/constants";
import {
  CHECK_IN_FORM_FIELD_KEYS,
  type CheckInFormFieldKey,
} from "@/lib/check-in/form-fields";

/**
 * Coach-side validation for the customisable check-in form (#4).
 *
 * The field enum is derived from the kernel rather than retyped, so the zod
 * schema, the wizard's step derivation and migration 157's CHECK constraint
 * cannot disagree about what the 14 keys are.
 */

const fieldKeySchema = z.enum(
  CHECK_IN_FORM_FIELD_KEYS as unknown as [CheckInFormFieldKey, ...CheckInFormFieldKey[]]
);

const formQuestionSchema = z.object({
  questionId: z.string().uuid(),
  enabled: z.boolean(),
});

/**
 * The body of `PUT /api/clients/[id]/check-in-form`.
 *
 * **Position is the array index**, not a field — a client cannot send two
 * questions claiming position 3, and `UNIQUE (form_id, position)` cannot be
 * violated by a payload. Ids are unique-checked here rather than left to the
 * primary key, so a duplicate reads as a 400 naming the problem instead of a
 * raw constraint violation (CONVENTIONS §10 "User-facing errors").
 */
export const saveCheckInFormSchema = z
  .object({
    fields: z.array(fieldKeySchema).max(CHECK_IN_FORM_FIELD_KEYS.length),
    questions: z.array(formQuestionSchema).max(MAX_CHECK_IN_QUESTIONS),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.fields).size !== data.fields.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: "A field is listed twice",
      });
    }
    const ids = data.questions.map((q) => q.questionId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions"],
        message: "A question is listed twice",
      });
    }
  });

/** `POST /api/check-ins/forms` — the editor's current state, saved as a template. */
export const saveCheckInTemplateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
  })
  .and(saveCheckInFormSchema);

/** `POST /api/check-ins/questions` */
export const createCheckInQuestionSchema = z.object({
  prompt: z.string().trim().min(1, "Question is required").max(300),
});

/**
 * `PATCH /api/check-ins/questions/[questionId]`
 *
 * Reword, archive, or restore. Archiving is the only retirement gesture: a
 * question that has been answered cannot be deleted (migration 157's FK), and
 * its past answers keep resolving their prompt through that row.
 */
export const updateCheckInQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(300).optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (data) => data.prompt !== undefined || data.archived !== undefined,
    { message: "Nothing to update" }
  );

export type SaveCheckInFormInput = z.infer<typeof saveCheckInFormSchema>;
