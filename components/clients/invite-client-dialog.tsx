"use client"

import { useState, useEffect } from "react"
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
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  Loader2,
  Mail,
  CheckCircle,
  Clock,
  AlertCircle,
  UserPlus,
} from "lucide-react"
import type { ClientInvitation, InvitationStatus } from "@/types/auth"

interface InviteClientDialogProps {
  client: {
    id: string
    name: string
    email: string
  }
  trigger?: React.ReactNode
}

type InvitationState = {
  invitation: ClientInvitation | null
  hasAccount: boolean
}

const STATUS_CONFIG: Record<
  InvitationStatus | "none",
  { label: string; variant: "default" | "secondary" | "outline"; icon: React.ElementType }
> = {
  none: { label: "Not invited", variant: "outline", icon: AlertCircle },
  pending: { label: "Pending", variant: "secondary", icon: Clock },
  sent: { label: "Invitation sent", variant: "secondary", icon: Mail },
  accepted: { label: "Accepted", variant: "default", icon: CheckCircle },
  expired: { label: "Expired", variant: "outline", icon: AlertCircle },
}

export function InviteClientDialog({
  client,
  trigger,
}: InviteClientDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [state, setState] = useState<InvitationState>({
    invitation: null,
    hasAccount: false,
  })

  // Fetch invitation status when dialog opens
  useEffect(() => {
    if (open) {
      fetchInvitationStatus()
    }
  }, [open])

  const fetchInvitationStatus = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/invitations/status/${client.id}`)
      const data = await response.json()

      if (data.success) {
        setState({
          invitation: data.data.invitation,
          hasAccount: data.data.hasAccount,
        })
      }
    } catch (error) {
      console.error("Error fetching invitation status:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSendInvitation = async () => {
    setSending(true)
    try {
      const response = await fetch("/api/invitations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      })

      const data = await response.json()

      if (data.success) {
        toast.success(`Invitation sent to ${client.email}`)
        setState((prev) => ({
          ...prev,
          invitation: data.data,
        }))
      } else {
        toast.error(data.error || "Failed to send invitation")
      }
    } catch (error) {
      console.error("Error sending invitation:", error)
      toast.error("Failed to send invitation")
    } finally {
      setSending(false)
    }
  }

  const status = state.hasAccount
    ? "accepted"
    : state.invitation?.status || "none"
  const statusConfig = STATUS_CONFIG[status]
  const StatusIcon = statusConfig.icon

  const canSendInvitation =
    !state.hasAccount && (!state.invitation || status === "expired")
  const canResendInvitation =
    !state.hasAccount && state.invitation?.status === "sent"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite {client.name}</DialogTitle>
          <DialogDescription>
            Send an invitation email so {client.name} can access their client
            portal.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Client info */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{client.name}</p>
                  <p className="text-sm text-muted-foreground">{client.email}</p>
                </div>
                <Badge variant={statusConfig.variant}>
                  <StatusIcon className="mr-1 h-3 w-3" />
                  {statusConfig.label}
                </Badge>
              </div>
            </div>

            {/* Status-specific messaging */}
            {state.hasAccount && (
              <div className="flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
                <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>
                  {client.name} has already set up their account and can access
                  the client portal.
                </p>
              </div>
            )}

            {state.invitation?.status === "sent" && !state.hasAccount && (
              <div className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-sm text-primary">
                <Mail className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <p>
                    An invitation was sent on{" "}
                    {new Date(state.invitation.invitedAt!).toLocaleDateString()}.
                  </p>
                  <p className="mt-1 text-primary">
                    You can resend the invitation if needed.
                  </p>
                </div>
              </div>
            )}

            {status === "expired" && (
              <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>
                  The previous invitation has expired. Send a new invitation for{" "}
                  {client.name} to set up their account.
                </p>
              </div>
            )}

            {status === "none" && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <UserPlus className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>
                  {client.name} hasn&apos;t been invited yet. Send an invitation
                  so they can access their training plans and progress.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>

          {(canSendInvitation || canResendInvitation) && (
            <Button onClick={handleSendInvitation} disabled={sending}>
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  {canResendInvitation ? "Resend Invitation" : "Send Invitation"}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
