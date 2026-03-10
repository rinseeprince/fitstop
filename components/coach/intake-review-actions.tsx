"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import { Check, ArrowRight, RefreshCw } from "lucide-react"
import { useSWRConfig } from "swr"
import type { IntakeStatus } from "@/types/client-intake"

type IntakeReviewActionsProps = {
  clientId: string
  intakeStatus: IntakeStatus
}

export function IntakeReviewActions({ clientId, intakeStatus }: IntakeReviewActionsProps) {
  const [syncing, setSyncing] = useState(false)
  const [marking, setMarking] = useState(false)
  const [synced, setSynced] = useState(false)
  const { toast } = useToast()
  const router = useRouter()
  const { mutate } = useSWRConfig()

  const isReviewed = intakeStatus === "reviewed"

  const handleSyncMetrics = async () => {
    setSyncing(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-metrics" }),
      })
      if (!res.ok) throw new Error("Failed to sync metrics")
      const result = await res.json()
      const fields: string[] = result.data?.syncedFields ?? []
      setSynced(true)
      toast({
        title: "Metrics synced",
        description: fields.length > 0
          ? `Synced: ${fields.join(", ")}`
          : "No new fields to sync",
      })
    } catch (err) {
      console.error("Failed to sync metrics:", err)
      toast({ title: "Sync failed", description: "Could not sync metrics to client profile.", variant: "destructive" })
    } finally {
      setSyncing(false)
    }
  }

  const handleMarkReviewed = async () => {
    setMarking(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review" }),
      })
      if (!res.ok) throw new Error("Failed to mark as reviewed")
      toast({ title: "Intake reviewed", description: "This intake has been marked as reviewed." })
      mutate(`/api/clients/${clientId}/intake`)
      mutate("/api/coach/pending-intakes")
    } catch (err) {
      console.error("Failed to mark intake as reviewed:", err)
      toast({ title: "Failed", description: "Could not mark intake as reviewed.", variant: "destructive" })
    } finally {
      setMarking(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={handleSyncMetrics}
        disabled={syncing}
      >
        {syncing ? (
          <RefreshCw className="w-4 h-4 animate-spin" />
        ) : synced ? (
          <Check className="w-4 h-4" />
        ) : (
          <RefreshCw className="w-4 h-4" />
        )}
        {synced ? "Metrics Synced" : "Sync Metrics to Profile"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(`/clients/${clientId}?tab=nutrition`)}
      >
        Go to Nutrition Builder
        <ArrowRight className="w-3 h-3" />
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(`/clients/${clientId}?tab=training`)}
      >
        Go to Training Builder
        <ArrowRight className="w-3 h-3" />
      </Button>

      {!isReviewed && (
        <Button
          size="sm"
          onClick={handleMarkReviewed}
          disabled={marking}
        >
          <Check className="w-4 h-4" />
          {marking ? "Marking..." : "Mark as Reviewed"}
        </Button>
      )}
    </div>
  )
}
