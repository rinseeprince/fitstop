import { z } from "zod";

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
  height: z.number().positive("Height must be positive").optional(),
  heightUnit: z.enum(["in", "cm"]).optional().default("in"),
  gender: z.enum(["male", "female", "other"]).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),

  // Goal fields
  goalWeight: z.number().positive("Goal weight must be positive").optional(),
  goalBodyFatPercentage: z.number().min(0).max(100, "Body fat must be between 0 and 100").optional(),
  weightUnit: z.enum(["lbs", "kg"]).optional().default("lbs"),

  // Initial current metrics
  currentWeight: z.number().positive("Current weight must be positive").optional(),
  currentBodyFatPercentage: z.number().min(0).max(100, "Body fat must be between 0 and 100").optional(),

  // Onboarding mode
  setupMode: z.enum(["intake", "manual"]).optional(),
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
  height: z.number().positive("Height must be positive").optional(),
  heightUnit: z.enum(["in", "cm"]).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),
  // Free text — phone formats vary too much for a shape constraint
  phone: z.string().trim().max(30, "Phone must be less than 30 characters").optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").optional(),

  // Goal fields
  goalWeight: z.number().positive("Goal weight must be positive").optional(),
  goalBodyFatPercentage: z.number().min(0).max(100, "Body fat must be between 0 and 100").optional(),
  weightUnit: z.enum(["lbs", "kg"]).optional(),

  // Current metrics (typically updated automatically, but can be manually set)
  currentWeight: z.number().positive("Current weight must be positive").optional(),
  currentBodyFatPercentage: z.number().min(0).max(100, "Body fat must be between 0 and 100").optional(),
});

// Schema for updating client check-in configuration
export const updateCheckInConfigSchema = z.object({
  checkInFrequency: z.enum(["weekly", "biweekly", "monthly", "custom", "none"]),
  checkInFrequencyDays: z.number().int().min(1).max(365).optional(),
  expectedCheckInDay: z
    .enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
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
export type CreateClientNoteInput = z.infer<typeof createClientNoteSchema>;
export type UpdateClientNoteInput = z.infer<typeof updateClientNoteSchema>;
