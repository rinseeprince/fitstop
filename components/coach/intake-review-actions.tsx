"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import { Check, ArrowRight, RefreshCw, Map, Pin } from "lucide-react"
import { useSWRConfig } from "swr"
import { useIntakePanel } from "@/contexts/intake-panel-context"
import type { IntakeStatus, ClientIntake } from "@/types/client-intake"

type IntakeReviewActionsProps = {
  clientId: string
  intakeStatus: IntakeStatus
  /** When provided, enables "pin and navigate" behavior on builder buttons */
  intake?: ClientIntake
  clientName?: string
}

export function IntakeReviewActions({ clientId, intakeStatus, intake, clientName }: IntakeReviewActionsProps) {
  const [syncing, setSyncing] = useState(false)
  const [marking, setMarking] = useState(false)
  const [synced, setSynced] = useState(false)
  const { toast } = useToast()
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const { openPanel, openMinimized, updateIntake, panel } = useIntakePanel()

  const isReviewed = intakeStatus === "reviewed"

  const handlePinAndNavigate = (path: string) => {
    if (intake && clientName) {
      openMinimized(clientId, clientName, intake)
    }
    router.push(path)
  }

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
      // Keep the pinned panel in sync if this client's intake is pinned
      if (intake && panel?.clientId === clientId) {
        updateIntake({ ...intake, status: "reviewed" })
      }
      mutate(`/api/clients/${clientId}/intake`)
      mutate("/api/coach/pending-intakes")
    } catch (err) {
      console.error("Failed to mark intake as reviewed:", err)
      toast({ title: "Failed", description: "Could not mark intake as reviewed.", variant: "destructive" })
    } finally {
      setMarking(false)
    }
  }

  const isPinnable = intake && clientName
  const isPinned = panel?.clientId === clientId

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
        onClick={() => isPinnable
          ? handlePinAndNavigate(`/clients/${clientId}?tab=nutrition`)
          : router.push(`/clients/${clientId}?tab=nutrition`)
        }
      >
        Go to Nutrition Builder
        <ArrowRight className="w-3 h-3" />
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => isPinnable
          ? handlePinAndNavigate(`/clients/${clientId}?tab=training`)
          : router.push(`/clients/${clientId}?tab=training`)
        }
      >
        Go to Training Builder
        <ArrowRight className="w-3 h-3" />
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => isPinnable
          ? handlePinAndNavigate(`/clients/${clientId}?tab=roadmap`)
          : router.push(`/clients/${clientId}?tab=roadmap`)
        }
      >
        <Map className="w-4 h-4" />
        Build Roadmap
        <ArrowRight className="w-3 h-3" />
      </Button>

      {isPinnable && !isPinned && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => openPanel(clientId, clientName, intake)}
        >
          <Pin className="w-4 h-4" />
          Pin Intake
        </Button>
      )}

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
