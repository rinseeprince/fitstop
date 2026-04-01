"use client"

import { Button } from "@/components/ui/button"
import { Loader2, Calculator } from "lucide-react"
import type { Client } from "@/types/check-in"

interface ClientStatusCardProps {
  client: Client
  isCalculatingBMR: boolean
  onCalculateBMR: () => void
}

function formatDelta(current: number | undefined, start: number | undefined): string | null {
  if (!current || !start) return null
  const delta = current - start
  const sign = delta > 0 ? "+" : ""
  return `${sign}${delta.toFixed(1)}`
}

export function ClientStatusCard({
  client,
  isCalculatingBMR,
  onCalculateBMR,
}: ClientStatusCardProps) {
  const weightUnit = client.weightUnit || "lbs"

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
      className="bg-[#0f2027] rounded-[6px] flex flex-col flex-1 animate-card-in"
      style={{ animationDelay: "0.08s" }}
    >
      {/* Header */}
      <div className="p-5 pb-4">
        <h3 className="text-[15px] font-bold text-white">Client Status</h3>
      </div>

      {/* Metrics body */}
      <div className="pb-5 flex-1">
        {/* Row 1: Weight */}
        <div className="grid grid-cols-3 gap-3 px-5 pb-3">
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
            showLeftBorder
          />
          <MetricCell
            label="Goal Weight"
            value={client.goalWeight?.toFixed(1)}
            unit={weightUnit}
            size="lg"
            badge={weightToGo ? `${weightToGo}${weightUnit} to go` : undefined}
            showLeftBorder
          />
        </div>

        {/* Divider */}
        <div className="border-t border-[rgba(255,255,255,0.06)] mx-5" />

        {/* Row 2: Body Fat */}
        <div className="grid grid-cols-3 gap-3 px-5 py-3">
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
            showLeftBorder
          />
          <MetricCell
            label="Goal BF"
            value={client.goalBodyFatPercentage?.toFixed(1)}
            unit="%"
            badge={bfToGo ? `${bfToGo}% to go` : undefined}
            showLeftBorder
          />
        </div>

        {/* Divider */}
        <div className="border-t border-[rgba(255,255,255,0.06)] mx-5" />

        {/* Row 3: Metabolic */}
        <div className="grid grid-cols-3 gap-3 px-5 pt-3 items-end">
          <MetricCell
            label="BMR"
            value={client.bmr ? Math.round(client.bmr).toString() : undefined}
            unit="cal/day"
          />
          <MetricCell
            label="TDEE"
            value={client.tdee ? Math.round(client.tdee).toString() : undefined}
            unit="cal/day"
            showLeftBorder
          />
          <div className="border-l border-[rgba(255,255,255,0.06)] pl-3">
            <Button
              size="sm"
              variant="outline"
              onClick={onCalculateBMR}
              disabled={isCalculatingBMR}
              className="bg-[rgba(13,148,136,0.15)] border border-[rgba(13,148,136,0.25)] text-[#0d9488] text-[11px] font-medium rounded-[6px] h-7 px-3 hover:bg-[rgba(13,148,136,0.25)]"
            >
              {isCalculatingBMR ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Calculator className="h-3 w-3 mr-1" strokeWidth={1.5} />
                  Calculate BMR
                </>
              )}
            </Button>
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
  showLeftBorder,
}: {
  label: string
  value?: string
  unit: string
  size?: "lg" | "md"
  sub?: string
  subColor?: string
  badge?: string
  showLeftBorder?: boolean
}) {
  const fontSize = size === "lg" ? "text-[22px]" : "text-[20px]"

  return (
    <div className={showLeftBorder ? "border-l border-[rgba(255,255,255,0.06)] pl-3" : ""}>
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
        <p className={`text-[9px] font-mono-display mt-0.5 ${subColor ?? "text-[rgba(255,255,255,0.25)]"}`}>
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
