"use client"

import { useState } from "react"
import { ClipboardList, Loader2 } from "lucide-react"
import { useIntakePanel } from "@/contexts/intake-panel-context"
import { useToast } from "@/hooks/use-toast"
import type { OnboardingStatus, ClientIntake } from "@/types/client-intake"

type PinIntakeButtonProps = {
  clientId: string
  clientName: string
  onboardingStatus?: OnboardingStatus
}

const STATUSES_WITH_INTAKE: OnboardingStatus[] = [
  "intake_completed",
  "setup_in_progress",
  "active",
]

export function PinIntakeButton({ clientId, clientName, onboardingStatus }: PinIntakeButtonProps) {
  const [loading, setLoading] = useState(false)
  const { openPanel, panel, expandPanel } = useIntakePanel()
  const { toast } = useToast()

  // Only show when the client has a completed intake
  if (!onboardingStatus || !STATUSES_WITH_INTAKE.includes(onboardingStatus)) {
    return null
  }

  // If this client's intake is already pinned, clicking toggles expand
  const isAlreadyPinned = panel?.clientId === clientId

  const handleClick = async () => {
    if (isAlreadyPinned) {
      expandPanel()
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/intake`)
      if (!res.ok) throw new Error("Failed to fetch intake")
      const result: { success: boolean; data: ClientIntake } = await res.json()
      if (!result.success || !result.data) throw new Error("No intake data")
      openPanel(clientId, clientName, result.data)
    } catch (err) {
      console.error("Failed to pin intake:", err)
      toast({
        title: "Could not load intake",
        description: "Failed to fetch intake data for this client.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="relative text-[#93b0b4] hover:text-[#5a7d82] transition-colors p-1"
      title={isAlreadyPinned ? "Show pinned intake" : "Pin intake for reference"}
    >
      {loading ? (
        <Loader2 className="h-[15px] w-[15px] animate-spin" />
      ) : (
        <ClipboardList className="h-[15px] w-[15px]" />
      )}
      {isAlreadyPinned && (
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500" />
      )}
    </button>
  )
}
