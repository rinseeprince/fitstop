import { z } from "zod";

// PATCH /api/coach/settings — coach-controlled settings.
// timezone is a bare string (forward-compatible with new IANA zones); the route
// validates against Intl.supportedValuesOf("timeZone"), mirroring the client
// settings route.
export const updateCoachSettingsSchema = z.object({
  timezone: z.string().min(1),
});

export type UpdateCoachSettingsInput = z.infer<typeof updateCoachSettingsSchema>;
