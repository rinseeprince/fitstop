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
import { toast } from "sonner"
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Rocket,
} from "lucide-react"
import type { DayOfWeek } from "@/types/check-in"

interface ClientActivationDialogProps {
  client: {
    id: string
    name: string
    email: string
  }
  trigger: React.ReactNode
  onActivated?: () => void
}

type Readiness = {
  hasTrainingPlan: boolean
  hasNutritionPlan: boolean
  hasHabits: boolean
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const

function getDefaultMessage(name: string): string {
  const firstName = name.split(" ")[0]
  return `Hey ${firstName}! I've reviewed your intake and put together a personalised plan for you. Let me know if you have any questions. Let's get after it!`
}

export function ClientActivationDialog({
  client,
  trigger,
  onActivated,
}: ClientActivationDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [welcomeMessage, setWelcomeMessage] = useState("")
  const [firstCheckInDay, setFirstCheckInDay] = useState<DayOfWeek>("monday")
  const [startDate, setStartDate] = useState<string>("")

  useEffect(() => {
    if (open) {
      setWelcomeMessage(getDefaultMessage(client.name))
      setStartDate(new Date().toISOString().split("T")[0])
      setReadiness(null)
      fetchReadiness()
    }
  }, [open])

  const fetchReadiness = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/clients/${client.id}/activation-readiness`)
      const data = await response.json()
      if (data.success) {
        setReadiness(data.data)
      }
    } catch (error) {
      console.error("Error fetching activation readiness:", error)
    } finally {
      setLoading(false)
    }
  }

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
        toast.success(`${client.name} is now active`)
        onActivated?.()
        setOpen(false)
      } else {
        toast.error(data.error || "Failed to activate client")
      }
    } catch (error) {
      console.error("Error activating client:", error)
      toast.error("Failed to activate client")
    } finally {
      setSubmitting(false)
    }
  }

  const hasMissingPlans = readiness && (!readiness.hasTrainingPlan || !readiness.hasNutritionPlan || !readiness.hasHabits)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Activate {client.name}</DialogTitle>
          <DialogDescription>
            Review the setup checklist and activate this client.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Plan checklist */}
            {readiness && (
              <div className="rounded-lg border p-4 space-y-2">
                <ChecklistItem label="Nutrition plan" checked={readiness.hasNutritionPlan} />
                <ChecklistItem label="Training plan" checked={readiness.hasTrainingPlan} />
                <ChecklistItem label="Habits" checked={readiness.hasHabits} />
              </div>
            )}

            {hasMissingPlans && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>
                  Some plans haven&apos;t been set up yet. You can still activate, but
                  the client won&apos;t see a complete program.
                </p>
              </div>
            )}

            {/* Welcome message */}
            <div className="space-y-2">
              <Label htmlFor="welcome-message">Welcome message</Label>
              <Textarea
                id="welcome-message"
                className="rounded-xs"
                rows={4}
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
              />
            </div>

            {/* Program start date */}
            <div className="space-y-2">
              <Label htmlFor="start-date">Program start date</Label>
              <Input
                id="start-date"
                type="date"
                className="rounded-xs"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            {/* First check-in day */}
            <div className="space-y-2">
              <Label htmlFor="checkin-day">First check-in day</Label>
              <Select value={firstCheckInDay} onValueChange={(v) => setFirstCheckInDay(v as DayOfWeek)}>
                <SelectTrigger id="checkin-day" className="rounded-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((day) => (
                    <SelectItem key={day} value={day}>
                      {day.charAt(0).toUpperCase() + day.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="gap-3">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleActivate}
            disabled={submitting || loading}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Activating...
              </>
            ) : (
              <>
                <Rocket className="mr-2 h-4 w-4" />
                Activate Client
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChecklistItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {checked ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : (
        <XCircle className="h-4 w-4 text-amber-500" />
      )}
      <span>{label}</span>
    </div>
  )
}
