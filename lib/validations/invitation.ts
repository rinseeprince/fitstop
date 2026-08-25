import { z } from "zod"

export const sendInvitationSchema = z.object({
  clientId: z.string().uuid("Invalid client ID"),
})

