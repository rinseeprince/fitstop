import { z } from "zod";

// PATCH /api/coach/settings — coach-controlled settings.
//
// timezone is a bare string (forward-compatible with new IANA zones); the route
// validates against Intl.supportedValuesOf("timeZone"), mirroring the client
// settings route.
//
// Both fields are optional with a non-empty refine, mirroring
// `updateSettingsSchema` (lib/validations/client.ts): the two writers touch
// different fields — `useTimezoneSync` PATCHes `{ timezone }` on every app load,
// the settings units card PATCHes `{ unitPreference }` — and neither may clobber
// the other's by being forced to echo it back.
export const updateCoachSettingsSchema = z
  .object({
    timezone: z.string().min(1).optional(),
    unitPreference: z.enum(["metric", "imperial"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export type UpdateCoachSettingsInput = z.infer<typeof updateCoachSettingsSchema>;
