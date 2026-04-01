"use client"

import { useEffect, useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { useIntakePanel } from "@/contexts/intake-panel-context"
import { useAuth } from "@/contexts/auth-context"
import { IntakeContentSections } from "./intake-content-sections"
import { Button } from "@/components/ui/button"
import { X, Minimize2, Maximize2, ClipboardList, ExternalLink, Check, CheckCircle2, XCircle } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import useSWR, { useSWRConfig } from "swr"
import { swrFetcher } from "@/lib/swr-fetcher"
import { REQUIRED_ITEMS, RECOMMENDED_ITEMS, type Readiness } from "@/lib/activation-readiness-items"

const NARROW_BREAKPOINT = 1024

// Flat list in setup order: Roadmap, Active phase, Training, Nutrition, Habits
const PROGRESS_ITEMS = [...RECOMMENDED_ITEMS, ...REQUIRED_ITEMS]

export function FloatingIntakePanel() {
  const { isTrainer } = useAuth()
  const { panel, isExpanded, minimizePanel, expandPanel, closePanel, updateIntake } = useIntakePanel()
  const [marking, setMarking] = useState(false)
  const { toast } = useToast()
  const { mutate } = useSWRConfig()
  const router = useRouter()

  // Always fetch activation readiness when panel is open
  const { data: readinessData, mutate: refetchReadiness } = useSWR<{ success: boolean; data: Readiness }>(
    panel ? `/api/clients/${panel.clientId}/activation-readiness` : null,
    swrFetcher,
    { revalidateOnFocus: false }
  )
  const readiness = readinessData?.data ?? null

  // Refetch readiness data when panel is expanded
  useEffect(() => {
    if (isExpanded && panel) {
      void refetchReadiness()
    }
  }, [isExpanded, panel, refetchReadiness])

  const handleMarkReviewed = async () => {
    if (!panel) return
    setMarking(true)
    try {
      const res = await fetch(`/api/clients/${panel.clientId}/intake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review" }),
      })
      if (!res.ok) throw new Error("Failed to mark as reviewed")
      toast({ title: "Intake reviewed", description: "This intake has been marked as reviewed." })
      updateIntake({ ...panel.intake, status: "reviewed" })
      void mutate(`/api/clients/${panel.clientId}/intake`)
      void mutate(`/api/clients/${panel.clientId}`)
      void mutate("/api/coach/pending-intakes")
      minimizePanel()
      // Full navigation ensures the client page reads the fresh tab param and refetches data
      window.location.href = `/clients/${panel.clientId}?tab=overview`
    } catch (err) {
      console.error("Failed to mark intake as reviewed:", err)
      toast({ title: "Failed", description: "Could not mark intake as reviewed.", variant: "destructive" })
    } finally {
      setMarking(false)
    }
  }

  // Guard expand to prevent flash on narrow viewports
  const handleExpand = useCallback(() => {
    if (window.innerWidth >= NARROW_BREAKPOINT) {
      expandPanel()
    }
  }, [expandPanel])

  // Auto-minimize if user resizes browser below breakpoint while panel is expanded
  useEffect(() => {
    if (!panel || !isExpanded) return

    const handleResize = () => {
      if (window.innerWidth < NARROW_BREAKPOINT) {
        minimizePanel()
      }
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [panel, isExpanded, minimizePanel])

  // Only render for coaches, never for clients
  if (!isTrainer || !panel) return null

  // Minimized tab at bottom-right
  if (!isExpanded) {
    return (
      <button
        onClick={handleExpand}
        className={cn(
          "fixed bottom-4 right-4 z-40",
          "flex items-center gap-2 px-4 py-2.5",
          "bg-[#0f2027] text-white",
          "rounded-[6px]",
          "shadow-[0_4px_6px_rgba(0,0,0,0.07)]",
          "hover:shadow-[0_10px_15px_rgba(0,0,0,0.1)]",
          "transition-all duration-150 ease-in-out",
          "text-[13px] font-medium"
        )}
      >
        <ClipboardList className="h-4 w-4" strokeWidth={1.5} />
        <span className="max-w-[180px] truncate">{panel.clientName} - Intake</span>
        <Maximize2 className="h-3.5 w-3.5 opacity-60" strokeWidth={1.5} />
      </button>
    )
  }

  // Expanded panel - fixed right side, no overlay so page is still interactive
  return (
    <div
      className={cn(
        "fixed top-4 right-4 bottom-4 z-40",
        "w-[480px] flex flex-col",
        "bg-white rounded-[6px]",
        "shadow-[0_10px_15px_rgba(0,0,0,0.1)]",
        "border border-[rgba(13,148,136,0.08)]"
      )}
    >
      {/* Header - dark style matching training/nutrition drawers */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0f2027] rounded-t-[6px] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-[32px] h-[32px] rounded-[6px] bg-[rgba(13,148,136,0.15)] flex items-center justify-center flex-shrink-0">
            <ClipboardList className="h-4 w-4 text-[#0d9488]" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white truncate">
              {panel.clientName}
            </p>
            <p className="text-[11px] text-[rgba(255,255,255,0.5)]">Intake Form</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Link href={`/clients/${panel.clientId}/intake-review`}>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.06)]" title="Open full review">
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.06)]"
            onClick={minimizePanel}
            title="Minimize"
          >
            <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.06)]"
            onClick={closePanel}
            title="Close"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      {/* Setup Progress - fixed strip, always visible */}
      {readiness && (
        <div className="px-4 py-2 border-b border-[rgba(13,148,136,0.08)] shrink-0">
          <p className="text-[11px] font-medium text-[#93b0b4] uppercase tracking-wider mb-1.5">Setup Progress</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {PROGRESS_ITEMS.map((item) => {
              const checked = readiness[item.key]
              return (
                <div key={item.key} className="flex items-center gap-1.5 text-[12px]">
                  {checked ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                  )}
                  <span className={checked ? "text-[#0c1a1e]" : "text-[#5a7d82]"}>{item.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Scrollable content - uses page bg so white section cards have contrast */}
      <div className="flex-1 overflow-y-auto p-4 bg-[#f4f7f6]">
        <IntakeContentSections intake={panel.intake} compact />
      </div>

      {/* Footer - Mark as Reviewed button */}
      {panel.intake.status !== "reviewed" && (
        <div className="border-t border-[rgba(13,148,136,0.08)] px-4 py-3 shrink-0">
          <Button
            size="sm"
            onClick={handleMarkReviewed}
            disabled={marking}
            className="w-full"
          >
            <Check className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
            {marking ? "Marking..." : "Mark as Reviewed"}
          </Button>
        </div>
      )}
    </div>
  )
}
