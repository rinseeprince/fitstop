"use client"

import { useState } from "react"
import { Loader2, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { TextSkeleton } from "@/components/text-skeleton"
import { FOCUS_RING, THUMB_CLASS } from "@/components/clients/training/program-builder/builder-tokens"
import {
  clientInvitationKey,
  useClearClientInvitation,
  useClientInvitation,
} from "@/hooks/use-client-invitation"
import { AUTH_ERROR_SENTENCES } from "@/lib/auth-error-messages"
import { formatDateOnlyShort } from "@/lib/date-helpers"
import { cn } from "@/lib/utils"
import type { InvitationRead } from "@/types/auth"

interface InviteClientDialogProps {
  client: {
    id: string
    name: string
    email: string
  }
  trigger: React.ReactNode
}

const SENTENCE_CLASS = "text-sm text-[#5a7d82]"
// TextSkeleton's own fill is the dark bands'; the dialog is white.
const PENDING_FILL = "bg-[rgba(13,148,136,0.08)]"
const PRIMARY_CLASS = cn("bg-[#0d9488] text-white hover:bg-[#0b7f75]", FOCUS_RING)
const TOO_MANY_REQUESTS = 429
/**
 * The statuses the box's route refuses a send with (404, 409, 500, 502), each
 * carrying the route's own plain sentence. Any other answer (the proxy's 401
 * for a session that ended, the CSRF check's 403) is not the route's, and its
 * words are not for a coach.
 */
const SEND_REFUSALS = new Set([404, 409, 500, 502])

/**
 * What the box says (rule 21), worked out from the read: an account first,
 * then whether an invitation went, when, and whether its link still works.
 */
export function invitationSentence(name: string, { hasAccount, invitation }: InvitationRead): string {
  if (hasAccount) return `${name} has an account.`
  if (!invitation) return "Not invited yet."
  const { sentOn, expiresOn, linkWorks } = invitation
  const link = linkWorks
    ? expiresOn
      ? `The link works until ${formatDateOnlyShort(expiresOn)}.`
      : "The link works."
    : expiresOn
      ? `The link expired on ${formatDateOnlyShort(expiresOn)}.`
      : "The link no longer works."
  return sentOn ? `Sent ${formatDateOnlyShort(sentOn)}. ${link}` : link
}

/** Why a send didn't go, in plain words: the route's own sentence, never the email service's or another layer's. */
function notSentReason(status: number, error: string | undefined): string {
  if (status === TOO_MANY_REQUESTS) return AUTH_ERROR_SENTENCES.tooManyAttempts
  return SEND_REFUSALS.has(status) && error ? error : AUTH_ERROR_SENTENCES.generic
}

/**
 * The Invite box on a client's page (rules 20 to 22): the client's invitation
 * read as the box opens, and a send while the client has no account. The read
 * is cleared as the box opens, so it never shows an earlier open's answer
 * (CONVENTIONS §7); pending, its sentence is pending text and no send button shows.
 * A send closes the box in the same tick its answer lands; one that didn't go
 * leaves the box open as it was, and its sentence and button with it.
 */
export function InviteClientDialog({ client, trigger }: InviteClientDialogProps) {
  const [open, setOpen] = useState(false)
  // The read is held from the first open on, never dropped by a close: Radix
  // re-renders the closing card from live state, so a read that stopped with
  // the close would fade the card out on pending text (CONVENTIONS §7 → "No
  // frame disagrees", rule 5). Each open clears it.
  const [reading, setReading] = useState(false)
  // The send in flight, owned here so a success's fading card keeps its busy
  // button (add-client-dialog's shape); a failure and the next open clear it.
  const [sending, setSending] = useState(false)
  const clearInvitation = useClearClientInvitation()
  const { invitation, failed, retrying, retry } = useClientInvitation(client.id, reading)

  const handleOpenChange = (next: boolean) => {
    // A send settles before the box closes: its answer decides whether it does.
    if (!next && sending) return
    if (next) {
      void clearInvitation(client.id)
      setReading(true)
      setSending(false)
    }
    setOpen(next)
  }

  const send = async () => {
    setSending(true)
    try {
      const response = await fetch(clientInvitationKey(client.id), { method: "POST" })
      const body = (await response.json()) as { success?: boolean; error?: string }
      if (response.ok && body.success) {
        toast.success("Invitation sent", { description: `Sent to ${client.email}.` })
        setOpen(false)
        return
      }
      setSending(false)
      toast.error("Invitation not sent", { description: notSentReason(response.status, body.error) })
    } catch (error) {
      console.error("Error sending the invitation:", error)
      setSending(false)
      toast.error("Invitation not sent", { description: AUTH_ERROR_SENTENCES.generic })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={cn(THUMB_CLASS, "h-9 w-9")}>
              <UserPlus className="h-4 w-4" strokeWidth={1.5} />
            </div>
            <DialogTitle>Invite {client.name}</DialogTitle>
          </div>
          <DialogDescription className="pt-2">{client.email}</DialogDescription>
        </DialogHeader>

        <div className="py-1">
          {failed ? (
            <p className={SENTENCE_CLASS}>Couldn&apos;t load the invitation.</p>
          ) : (
            <p className={SENTENCE_CLASS}>
              {invitation ? (
                invitationSentence(client.name, invitation)
              ) : (
                <TextSkeleton className={cn("w-60", PENDING_FILL)} />
              )}
            </p>
          )}
        </div>

        {/* Cancel in every state, so at sm and up, where the footer's buttons
            sit in one row, it keeps its height and the card doesn't move when
            the read lands. */}
        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          {failed && (
            <Button className={PRIMARY_CLASS} onClick={retry} disabled={retrying}>
              {retrying && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Try again
            </Button>
          )}
          {invitation && !invitation.hasAccount && (
            <Button className={PRIMARY_CLASS} onClick={() => void send()} disabled={sending}>
              {sending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {invitation.invitation ? "Resend invitation" : "Send invitation"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
