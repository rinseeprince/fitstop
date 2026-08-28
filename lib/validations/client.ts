import { z } from "zod";

// Weights are KILOGRAMS and lengths are CENTIMETRES on this wire, always.
//
// `weightUnit` / `heightUnit` are gone from both schemas. They were per-payload
// tags describing what the sender happened to be looking at, which is exactly
// the model migration 141 removed from storage — and while they existed,
// client-settings-dialog round-tripped one back through `client.heightUnit`,
// so a save that touched only the phone number could multiply a stored 178 cm
// by 2.54. The forms convert from the coach's own display units before
// submitting (hooks/use-unit-inputs.ts).

// Schema for creating a new client
export const createClientSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters")
    .trim(),
  email: z
    .string()
    .email("Please enter a valid email address")
    .toLowerCase()
    .trim(),
  notes: z.string().max(5000, "Notes must be less than 5000 characters").optional(),

  // Static profile fields
  height: z.number().positive("Height must be positive").optional(), // centimetres
  gender: z.enum(["male", "female", "other"]).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),

  // Goal fields
  goalWeight: z.number().positive("Goal weight must be positive").optional(),
  goalBodyFatPercentage: z.number().min(0).max(100, "Body fat must be between 0 and 100").optional(),

  // Initial current metrics
  currentWeight: z.number().positive("Current weight must be positive").optional(),
  currentBodyFatPercentage: z.number().min(0).max(100, "Body fat must be between 0 and 100").optional(),

  // Onboarding mode
  setupMode: z.enum(["intake", "manual"]).optional(),
}).superRefine((data, ctx) => {
  // A MANUAL setup is the only path that can mint a client with no starting
  // measurement at all. The intake questionnaire requires a weight of its own
  // (`intakeStep1Schema.currentWeight`), and `createClient` copies whatever it
  // is handed into BOTH the current and the starting columns — so a manual add
  // with the box left blank produced a client who could be fully set up and
  // activated having never had a start weight, with no BMR, no TDEE and no
  // baseline for any progress figure.
  //
  // `setupMode` is optional on the wire and `createClient` treats anything but
  // "intake" as manual (`isIntakeMode`), so the predicate matches that exactly
  // rather than testing for "manual".
  if (data.setupMode !== "intake" && data.currentWeight === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currentWeight"],
      message: "A current weight is required — it is this client's starting point",
    });
  }
});

// Schema for updating an existing client
export const updateClientSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be less than 100 characters")
    .trim()
    .optional(),
  email: z
    .string()
    .email("Please enter a valid email address")
    .toLowerCase()
    .trim()
    .optional(),
  notes: z.string().max(5000, "Notes must be less than 5000 characters").optional(),
  active: z.boolean().optional(),

  // Static profile fields
  height: z.number().positive("Height must be positive").optional(), // centimetres
  gender: z.enum(["male", "female", "other"]).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  // Free text — phone formats vary too much for a shape constraint
  phone: z.string().trim().max(30, "Phone must be less than 30 characters").optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),

  // A CLIENT fact that drives their TDEE. Set from the client settings dialog;
  // nothing under the nutrition builder may write it.
  workActivityLevel: z
    .enum(["sedentary", "lightly_active", "moderately_active", "very_active", "extremely_active"])
    .optional(),

  // Goal fields
  goalWeight: z.number().positive("Goal weight must be positive").optional(),
  goalBodyFatPercentage: z.number().min(0).max(100, "Body fat must be between 0 and 100").optional(),

  // Current metrics (typically updated automatically, but can be manually set)
  currentWeight: z.number().positive("Current weight must be positive").optional(),
  // NULLABLE, unlike every weight beside it. A body fat is an estimate — a
  // caliper reading, a smart scale, a client's guess — and a wrong one is not
  // merely a wrong number: `computeEnergyPair` switches from Mifflin-St Jeor
  // to Katch-McArdle whenever a body fat is present, so a bad figure silently
  // changes which formula produces the client's BMR and TDEE. Clearing it is
  // the honest correction, and it must not be expressible only as another
  // guess. A weight has no such power and stays non-clearable.
  currentBodyFatPercentage: z
    .number()
    .min(0)
    .max(100, "Body fat must be between 0 and 100")
    .nullable()
    .optional(),

  // The recorded START of this client's journey. Editable because it is the one
  // measurement nobody can re-take: a coach who left it blank at setup, or
  // typed it wrong, has no other way to correct it. Written ONCE at creation
  // (createClient copies the single typed measurement into both the current and
  // the starting columns) and by the intake sync; after that only this PATCH.
  // Deliberately NOT nullable — the sibling metrics are not either, and a start
  // value that can be blanked is a delta that can silently disappear.
  startingWeight: z.number().positive("Start weight must be positive").optional(),
  /** Nullable for the same reason as the current one above. */
  startingBodyFatPercentage: z
    .number()
    .min(0)
    .max(100, "Body fat must be between 0 and 100")
    .nullable()
    .optional(),
});

// Schema for updating client check-in configuration
export const updateCheckInConfigSchema = z.object({
  checkInFrequency: z.enum(["weekly", "biweekly", "monthly", "custom", "none"]),
  checkInFrequencyDays: z.number().int().min(1).max(365).optional(),
  // Format only. The past-date bound is enforced route-side against the
  // COACH's today (they are the one setting it) — the same split as the goal
  // deadline. NULL clears the schedule.
  nextCheckInDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .nullable()
    .optional(),
  reminderPreferences: z.object({
    enabled: z.boolean(),
    autoSend: z.boolean(),
    sendBeforeHours: z.number().int().min(1).max(168), // Max 7 days
  }),
});

export const sendReminderSchema = z.object({
  reminderType: z.enum(["overdue", "checkin", "general"]).default("overdue"),
});

// Coach notes about a client (client_notes rows, Overview redesign)
export const createClientNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Note cannot be empty")
    .max(5000, "Note must be less than 5000 characters"),
});

export const updateClientNoteSchema = z.object({
  isPinned: z.boolean(),
});

// Schema for PATCH /api/client/settings (client-controlled preferences)
// Kept separate from updateClientSchema (coach-facing) so client and coach
// surfaces can evolve independently without one loosening the other.
export const updateSettingsSchema = z
  .object({
    unitPreference: z.enum(["metric", "imperial"]).optional(),
    timezone: z.string().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

// Type exports
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type UpdateCheckInConfigInput = z.infer<typeof updateCheckInConfigSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
