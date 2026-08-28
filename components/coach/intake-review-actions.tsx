"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import { Check, ArrowRight, RefreshCw, Pin } from "lucide-react"
import { useSWRConfig } from "swr"
import { useIntakePanel } from "@/contexts/intake-panel-context"
import { useClient } from "@/hooks/use-check-in-data"
import { hasStartWeight } from "@/lib/client-profile-completeness"
import { postIntakeAction } from "@/lib/intake-actions"
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
  // The DURABLE answer to "have the metrics landed", off the client record.
  // `synced` below is this session's press and only drives the button's own
  // label — it forgets on reload, so it could never gate anything.
  const { client } = useClient(clientId)
  const metricsSynced = hasStartWeight(client)

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
      const result = await postIntakeAction(clientId, "sync-metrics")
      const fields: string[] = result.data?.syncedFields ?? []
      setSynced(true)
      toast({
        title: "Metrics synced",
        description: fields.length > 0
          ? `Synced: ${fields.join(", ")}`
          : "No new fields to sync",
      })
      // Pin intake minimized and navigate to client page
      if (intake && clientName) {
        openMinimized(clientId, clientName, intake)
      }
      router.push(`/clients/${clientId}`)
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
      await postIntakeAction(clientId, "review")
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
        {synced || metricsSynced ? "Metrics Synced" : "Sync Metrics to Profile"}
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

      {/* Sync first — see the panel footer for why the order is enforced. */}
      {!isReviewed && (
        <Button
          size="sm"
          onClick={handleMarkReviewed}
          disabled={marking || !metricsSynced}
          title={
            metricsSynced
              ? undefined
              : "Sync their metrics first — it sets the starting weight everything is measured from."
          }
        >
          <Check className="w-4 h-4" />
          {marking ? "Marking..." : "Mark as Reviewed"}
        </Button>
      )}
    </div>
  )
}
