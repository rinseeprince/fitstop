"use client"

import { useCallback, useState } from "react"
import { useToast } from "@/hooks/use-toast"
import type { SendReminderResponse } from "@/types/check-in"

/**
 * The two row actions on the Clients roster: reactivating a removed client and
 * nudging an overdue one. Network and toasts only, no render concern.
 *
 * `pendingId` is the in-flight guard. Without one, a reminder sends once per
 * click — the affordance it replaced (the deleted overdue card) had that guard
 * and the move must not lose it. One id is enough for both actions: a client
 * cannot be inactive and overdue at once, because getOverdueClients only ever
 * looks at active clients.
 */

/** Every route in this area reports failure as `{ error }` with a non-OK
 *  status — never as a 200 carrying `success: false`. Read the body that is
 *  actually sent, so the coach sees the real reason rather than a generic one. */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? fallback
}

export function useRosterActions(onRosterChanged: () => void) {
  const { toast } = useToast()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const reactivate = useCallback(
    async (clientId: string) => {
      setPendingId(clientId)
      let reactivated = false
      try {
        const res = await fetch(`/api/clients/${clientId}/reactivate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
        if (!res.ok) {
          throw new Error(
            await readErrorMessage(
              res,
              "Could not reactivate this client. Please try again.",
            ),
          )
        }
        toast({ title: "Client reactivated" })
        reactivated = true
      } catch (error) {
        toast({
          title: "Error",
          description:
            error instanceof Error
              ? error.message
              : "Could not reactivate this client. Please try again.",
          variant: "destructive",
        })
      } finally {
        setPendingId(null)
      }
      // Outside the try: a failed refresh is not a failed reactivation, and
      // reporting it as one would contradict the toast above it.
      if (reactivated) onRosterChanged()
    },
    [toast, onRosterChanged],
  )

  const sendReminder = useCallback(
    async (clientId: string, clientName: string) => {
      setPendingId(clientId)
      try {
        const res = await fetch(`/api/clients/${clientId}/reminder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reminderType: "overdue" }),
        })
        const fallback = "Could not send the reminder. Please try again."
        if (!res.ok) throw new Error(await readErrorMessage(res, fallback))

        const data = (await res.json()) as SendReminderResponse
        if (!data.success) throw new Error(data.errorMessage ?? fallback)

        toast({
          title: "Reminder sent",
          description: `${clientName} has been asked to check in.`,
        })
      } catch (error) {
        toast({
          title: "Error",
          description:
            error instanceof Error
              ? error.message
              : "Could not send the reminder. Please try again.",
          variant: "destructive",
        })
      } finally {
        setPendingId(null)
      }
    },
    [toast],
  )

  return { pendingId, reactivate, sendReminder }
}
