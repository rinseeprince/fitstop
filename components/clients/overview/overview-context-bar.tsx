"use client"

import useSWR from "swr"
import { Map, Flag } from "lucide-react"
import { swrFetcher } from "@/lib/swr-fetcher"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { MONO } from "@/components/clients/training/program-builder/builder-tokens"
import { weightToKg, weightFromKg } from "@/utils/nutrition-helpers"
import type { RoadmapWithPhases } from "@/services/roadmap-service"
import type { Client } from "@/types/check-in"
import type { Phase } from "@/types/roadmap"

interface OverviewContextBarProps {
  clientId: string
  client: Client
}

function getWeeksProgress(phase: { startDate?: string; endDate?: string }): string | null {
  if (!phase.startDate || !phase.endDate) return null
  const start = new Date(phase.startDate)
  const end = new Date(phase.endDate)
  const now = new Date()
  const totalWeeks = Math.max(1, Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)))
  const elapsedWeeks = Math.max(1, Math.min(totalWeeks, Math.round((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))))
  return `${elapsedWeeks}/${totalWeeks} weeks`
}

function getPhaseDateRange(phase: Phase): string | null {
  const parts = [
    phase.startDate ? format(new Date(phase.startDate), "MMM d") : null,
    phase.endDate ? format(new Date(phase.endDate), "MMM d") : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" \u2013 ") : null
}

function getGoalWeightDisplay(phase: Phase, client: Client): string | null {
  if (phase.phaseGoalWeight == null || !client.currentWeight) return null
  const unit = client.weightUnit || "lbs"
  const currentKg = weightToKg(client.currentWeight, unit)
  const displayUnit = unit === "lbs" ? "lbs" : "kg"
  const currentVal = unit === "lbs"
    ? weightFromKg(currentKg, "lbs").toFixed(1)
    : currentKg.toFixed(1)
  const goalVal = unit === "lbs"
    ? weightFromKg(phase.phaseGoalWeight, "lbs").toFixed(1)
    : phase.phaseGoalWeight.toFixed(1)
  return `${currentVal} \u2192 ${goalVal} ${displayUnit}`
}

function getPhaseGoalProgress(phase: Phase, client: Client): string | null {
  if (phase.phaseGoalWeight == null || !client.currentWeight) return null
  const unit = client.weightUnit || "lbs"
  const currentKg = weightToKg(client.currentWeight, unit)
  const diffKg = Math.abs(currentKg - phase.phaseGoalWeight)
  const displayUnit = unit === "lbs" ? "lbs" : "kg"
  const value = unit === "lbs"
    ? weightFromKg(diffKg, "lbs").toFixed(1)
    : diffKg.toFixed(1)
  return `${value} ${displayUnit} to go`
}

export function OverviewContextBar({ clientId, client }: OverviewContextBarProps) {
  const { data: roadmapData } = useSWR<{ success: boolean; data: RoadmapWithPhases }>(
    `/api/clients/${clientId}/roadmap`,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 1 }
  )

  const roadmap = roadmapData?.data ?? null
  const activePhase = roadmap?.phases?.find((p) => p.status === "active") ?? null

  const phaseDateRange = activePhase ? getPhaseDateRange(activePhase) : null
  const goalWeightDisplay = activePhase ? getGoalWeightDisplay(activePhase, client) : null
  const phaseGoalProgress = activePhase ? getPhaseGoalProgress(activePhase, client) : null

  return (
    <div className="flex items-center gap-3 min-w-0 mb-5">
      {roadmap ? (
          <>
            <Map className="h-4 w-4 text-[#0d9488] shrink-0" strokeWidth={1.5} />
            <span className="text-[13px] font-semibold text-[#0c1a1e] truncate">
              {roadmap.name}
            </span>

            <div className="w-px h-6 bg-[rgba(13,148,136,0.08)] shrink-0" />

            <Flag className="h-4 w-4 text-[#0d9488] shrink-0" strokeWidth={1.5} />
            {activePhase ? (
              <>
                <span className="text-[13px] font-semibold text-[#0c1a1e] truncate">
                  {activePhase.name}
                </span>
                {phaseDateRange && (
                  <span className={cn(MONO, "text-[12px] text-[#93b0b4] shrink-0")}>
                    {phaseDateRange}
                  </span>
                )}
                {goalWeightDisplay && (
                  <span className={cn(MONO, "text-[12px] text-[#5a7d82] shrink-0")}>
                    {goalWeightDisplay}
                  </span>
                )}
                {phaseGoalProgress && (
                  <span className={cn(MONO, "text-[10.5px] font-semibold text-[#d97706] bg-[rgba(245,158,11,0.07)] px-1.5 py-0.5 rounded-[3px] shrink-0")}>
                    {phaseGoalProgress}
                  </span>
                )}
                {getWeeksProgress(activePhase) && (
                  <span className={cn(MONO, "text-[11px] text-[#5a7d82] shrink-0")}>
                    {getWeeksProgress(activePhase)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[13px] text-[#93b0b4]">No active phase</span>
            )}

            {/* Active indicator - pushed right, matches training/nutrition pages */}
            <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-[#0d9488] shrink-0">
              <span className="w-[5px] h-[5px] rounded-full bg-[#0d9488]" />
              Active
            </span>
          </>
      ) : (
        <span className="text-[13px] text-[#93b0b4]">No roadmap assigned</span>
      )}
    </div>
  )
}
