"use client"

import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, Loader2, Calculator, Map, Flag } from "lucide-react"
import { swrFetcher } from "@/lib/swr-fetcher"
import type { Client } from "@/types/check-in"
import type { RoadmapWithPhases } from "@/services/roadmap-service"

interface ClientStatusCardProps {
  client: Client
  isCalculatingBMR: boolean
  onCalculateBMR: () => void
}

function isOnTrack(client: Client): boolean | null {
  const { startingWeight, currentWeight, goalWeight } = client
  if (!startingWeight || !currentWeight || !goalWeight) return null
  // On track if current weight is closer to goal than starting weight
  const startDelta = Math.abs(startingWeight - goalWeight)
  const currentDelta = Math.abs(currentWeight - goalWeight)
  return currentDelta < startDelta
}

function formatDelta(current: number | undefined, start: number | undefined): string | null {
  if (!current || !start) return null
  const delta = current - start
  const sign = delta > 0 ? "+" : ""
  return `${sign}${delta.toFixed(1)}`
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

export function ClientStatusCard({
  client,
  isCalculatingBMR,
  onCalculateBMR,
}: ClientStatusCardProps) {
  const weightUnit = client.weightUnit || "lbs"
  const onTrack = isOnTrack(client)

  const { data: roadmapData } = useSWR<{ success: boolean; data: RoadmapWithPhases }>(
    `/api/clients/${client.id}/roadmap`,
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 1 }
  )

  const roadmap = roadmapData?.data ?? null
  const activePhase = roadmap?.phases?.find((p) => p.status === "active") ?? null

  const weightDelta = formatDelta(client.currentWeight, client.startingWeight)
  const bfDelta = formatDelta(client.currentBodyFatPercentage, client.startingBodyFatPercentage)

  const weightToGo =
    client.currentWeight && client.goalWeight
      ? Math.abs(client.currentWeight - client.goalWeight).toFixed(1)
      : null

  const bfToGo =
    client.currentBodyFatPercentage && client.goalBodyFatPercentage
      ? Math.abs(client.currentBodyFatPercentage - client.goalBodyFatPercentage).toFixed(1)
      : null

  return (
    <div
      className="bg-white rounded-[6px] flex flex-col animate-card-in"
      style={{ animationDelay: "0.08s" }}
    >
      {/* Header */}
      <div className="p-5 pb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-[#0c1a1e]">Client Status</h3>
        {onTrack !== null && (
          <div
            className={`flex items-center gap-1.5 text-[11px] font-semibold ${
              onTrack ? "text-[#0d9488]" : "text-[#d97706]"
            }`}
          >
            {onTrack ? (
              <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.5} />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
            {onTrack ? "On track" : "Needs attention"}
          </div>
        )}
      </div>

      {/* Dark metrics card */}
      <div className="mx-5 mb-4 bg-[#0f2027] rounded-[6px] p-4">
        {/* Row 1: Weight */}
        <div className="grid grid-cols-3 gap-3 pb-3">
          <MetricCell
            label="Start Weight"
            value={client.startingWeight?.toFixed(1)}
            unit={weightUnit}
            size="lg"
          />
          <MetricCell
            label="Current Weight"
            value={client.currentWeight?.toFixed(1)}
            unit={weightUnit}
            size="lg"
            sub={weightDelta ? `${weightDelta}${weightUnit}` : undefined}
            subColor={
              weightDelta
                ? weightDelta.startsWith("-")
                  ? "text-[#0d9488]"
                  : "text-[#d97706]"
                : undefined
            }
          />
          <MetricCell
            label="Goal Weight"
            value={client.goalWeight?.toFixed(1)}
            unit={weightUnit}
            size="lg"
            badge={weightToGo ? `${weightToGo}${weightUnit} to go` : undefined}
          />
        </div>

        {/* Divider */}
        <div className="border-t border-[rgba(255,255,255,0.06)]" />

        {/* Row 2: Body Fat */}
        <div className="grid grid-cols-3 gap-3 py-3">
          <MetricCell
            label="Start BF"
            value={client.startingBodyFatPercentage?.toFixed(1)}
            unit="%"
          />
          <MetricCell
            label="Current BF"
            value={client.currentBodyFatPercentage?.toFixed(1)}
            unit="%"
            sub={bfDelta ? `${bfDelta}%` : undefined}
            subColor={
              bfDelta
                ? bfDelta.startsWith("-")
                  ? "text-[#0d9488]"
                  : "text-[#d97706]"
                : undefined
            }
          />
          <MetricCell
            label="Goal BF"
            value={client.goalBodyFatPercentage?.toFixed(1)}
            unit="%"
            badge={bfToGo ? `${bfToGo}% to go` : undefined}
          />
        </div>

        {/* Divider */}
        <div className="border-t border-[rgba(255,255,255,0.06)]" />

        {/* Row 3: Metabolic */}
        <div className="grid grid-cols-3 gap-3 pt-3 items-end">
          <MetricCell
            label="BMR"
            value={client.bmr ? Math.round(client.bmr).toString() : undefined}
            unit="cal/day"
          />
          <MetricCell
            label="TDEE Sedentary"
            value={client.tdee ? Math.round(client.tdee).toString() : undefined}
            unit="cal/day"
          />
          <div className="flex items-end justify-end">
            {(!client.bmr || !client.tdee) &&
              client.currentWeight &&
              client.height &&
              client.gender && (
                <Button
                  size="sm"
                  onClick={onCalculateBMR}
                  disabled={isCalculatingBMR}
                  className="bg-[#0d9488] hover:bg-[#0f766e] text-white text-[11px] rounded-[6px] h-7 px-3"
                >
                  {isCalculatingBMR ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <Calculator className="h-3 w-3 mr-1" strokeWidth={1.5} />
                      Calculate
                    </>
                  )}
                </Button>
              )}
          </div>
        </div>
      </div>

      {/* Roadmap & Phase blocks */}
      <div className="px-5 pb-5 space-y-2">
        {/* Roadmap */}
        <div className="flex items-center gap-2.5 p-3 rounded-[6px] bg-[rgba(13,148,136,0.05)]">
          <Map className="h-4 w-4 text-[#0d9488] shrink-0" strokeWidth={1.5} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">
              Roadmap
            </p>
            {roadmap ? (
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[13px] font-semibold text-[#0c1a1e] truncate">
                  {roadmap.name}
                </p>
                <Badge className="text-[9px] px-1.5 py-0 h-4 bg-[rgba(13,148,136,0.08)] text-[#0d9488] border-none shrink-0">
                  Active
                </Badge>
              </div>
            ) : (
              <p className="text-[13px] text-[#93b0b4] mt-0.5">No roadmap</p>
            )}
          </div>
        </div>

        {/* Phase */}
        <div className="flex items-center gap-2.5 p-3 rounded-[6px] bg-[rgba(13,148,136,0.05)]">
          <Flag className="h-4 w-4 text-[#0d9488] shrink-0" strokeWidth={1.5} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium">
              Phase
            </p>
            {activePhase ? (
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[13px] font-semibold text-[#0c1a1e] truncate">
                  {activePhase.name}
                </p>
                {getWeeksProgress(activePhase) && (
                  <span className="text-[11px] font-mono-display text-[#5a7d82] shrink-0">
                    {getWeeksProgress(activePhase)}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-[13px] text-[#93b0b4] mt-0.5">No active phase</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCell({
  label,
  value,
  unit,
  size = "md",
  sub,
  subColor,
  badge,
}: {
  label: string
  value?: string
  unit: string
  size?: "lg" | "md"
  sub?: string
  subColor?: string
  badge?: string
}) {
  const fontSize = size === "lg" ? "text-[22px]" : "text-[20px]"

  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.30)] font-medium">
        {label}
      </p>
      <div className="mt-1">
        {value ? (
          <>
            <span className={`${fontSize} font-bold font-mono-display text-white leading-tight`}>
              {value}
            </span>
            <span className="text-[10px] text-[rgba(255,255,255,0.30)] ml-1">{unit}</span>
          </>
        ) : (
          <span className="text-[13px] text-[rgba(255,255,255,0.30)]">Not recorded</span>
        )}
      </div>
      {sub && (
        <p className={`text-[11px] font-mono-display mt-0.5 ${subColor ?? "text-[rgba(255,255,255,0.30)]"}`}>
          {sub}
        </p>
      )}
      {badge && (
        <span className="inline-block mt-1 text-[9px] font-medium px-1.5 py-0.5 rounded-[4px] bg-[rgba(245,158,11,0.07)] text-[#d97706]">
          {badge}
        </span>
      )}
    </div>
  )
}
