"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FOCUS_RING,
  MONO_INPUT_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens"
import { useToast } from "@/hooks/use-toast"
import { REQUIRED_ITEMS, type Readiness } from "@/lib/activation-readiness-items"
import { getTodayDateString } from "@/lib/date-helpers"
import { getFirstName } from "@/lib/client-name"
import { cn } from "@/lib/utils"
import type { DayOfWeek } from "@/types/check-in"

interface ClientActivationDialogProps {
  client: {
    id: string
    name: string
    email: string
  }
  /**
   * Passed in by the activation card, which has already read it. The dialog
   * used to fetch the same three booleans again on every open and repeat the
   * card's checklist back at the coach one click later.
   */
  readiness: Readiness
  trigger: React.ReactNode
  onActivated?: () => void
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const

const FIELD_LABEL = "text-[11px] text-[#5a7d82]"
const FIELD_INPUT = cn(
  "rounded-[6px] border-[rgba(13,148,136,0.08)] bg-white text-[13px]",
  FOCUS_RING
)

function getDefaultMessage(name: string): string {
  // "Hey there" rather than the "Hey !" the old inline split produced for a
  // client invited by email whose name was never filled in.
  const greeting = getFirstName(name) ?? "there"
  return `Hey ${greeting}! I've reviewed your intake and put together a personalised plan for you. Let me know if you have any questions. Let's get after it!`
}

/** "nutrition plan and daily habits" — British list, no Oxford comma. */
function listMissing(readiness: Readiness): string | null {
  const missing = REQUIRED_ITEMS.filter((item) => !readiness[item.key]).map((item) =>
    item.label.toLowerCase()
  )
  if (missing.length === 0) return null
  if (missing.length === 1) return missing[0]
  return `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`
}

export function ClientActivationDialog({
  client,
  readiness,
  trigger,
  onActivated,
}: ClientActivationDialogProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [welcomeMessage, setWelcomeMessage] = useState("")
  const [firstCheckInDay, setFirstCheckInDay] = useState<DayOfWeek>("monday")
  const [startDate, setStartDate] = useState<string>("")
  const { toast } = useToast()

  useEffect(() => {
    if (open) {
      setWelcomeMessage(getDefaultMessage(client.name))
      setStartDate(getTodayDateString())
    }
  }, [open, client.name])

  const missing = listMissing(readiness)

  const handleActivate = async () => {
    setSubmitting(true)
    try {
      const response = await fetch(`/api/clients/${client.id}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ welcomeMessage, firstCheckInDay, startDate: startDate || undefined }),
      })
      const data = await response.json()

      if (data.success) {
        toast({
          title: `${client.name} is now active`,
          description: "They have been emailed and can see their plans.",
        })
        onActivated?.()
        setOpen(false)
      } else {
        toast({
          title: "Activation failed",
          description: data.error || "Something went wrong",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error activating client:", error)
      toast({
        title: "Activation failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Activate {client.name}</DialogTitle>
          <DialogDescription>
            Set the start date and first check-in day, then send the welcome email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* The card behind this dialog is the checklist; one sentence is all
              the decision needs here. */}
          {missing && (
            <p className="text-[11px] text-[#93b0b4]">
              No {missing} yet. Activating now is fine, and the client sees each one as
              soon as you add it.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="welcome-message" className={FIELD_LABEL}>
              Welcome message
            </Label>
            <Textarea
              id="welcome-message"
              rows={4}
              className={cn(FIELD_INPUT, "min-h-[92px] resize-none")}
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="start-date" className={FIELD_LABEL}>
              Program start date
            </Label>
            <Input
              id="start-date"
              type="date"
              className={cn(FIELD_INPUT, MONO_INPUT_CLASS, "h-9 w-[170px]")}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="checkin-day" className={FIELD_LABEL}>
              First check-in day
            </Label>
            <Select value={firstCheckInDay} onValueChange={(v) => setFirstCheckInDay(v as DayOfWeek)}>
              <SelectTrigger id="checkin-day" className={cn(FIELD_INPUT, "h-9")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-1 shadow-lg">
                {DAYS.map((day) => (
                  <SelectItem key={day} value={day}>
                    {day.charAt(0).toUpperCase() + day.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleActivate}
            disabled={submitting}
            className={cn(
              "rounded-[6px] bg-[#0d9488] text-white hover:bg-[#0b7f75]",
              FOCUS_RING
            )}
          >
            {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {submitting ? "Activating" : "Activate client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
