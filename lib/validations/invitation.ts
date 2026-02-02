import { z } from "zod"

export const sendInvitationSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
})

export const acceptInvitationSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
})

export type SendInvitationInput = z.infer<typeof sendInvitationSchema>
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>
