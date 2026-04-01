"use client"

import { useMemo } from "react"
import { WellnessBarChart } from "@/components/clients/daily-pulse/wellness-bar-chart"
import { OverviewEmptySection } from "./overview-empty-section"
import { useWellnessData } from "@/hooks/use-wellness-data"
import { Activity } from "lucide-react"
import type { WellnessMetric } from "@/utils/wellness-color-thresholds"

interface OverviewWellnessGridProps {
  clientId: string
}

const WELLNESS_CARDS: Array<{
  metric: WellnessMetric
  label: string
  color: string
}> = [
  { metric: "mood", label: "Mood (1-5)", color: "#c8923a" },
  { metric: "energy", label: "Energy (1-10)", color: "#0d9488" },
  { metric: "sleep", label: "Sleep Quality (1-10)", color: "#c8923a" },
  { metric: "stress", label: "Stress Level (1-10)", color: "#c8923a" },
]

export function OverviewWellnessGrid({ clientId }: OverviewWellnessGridProps) {
  const { logs, isLoading } = useWellnessData(clientId)

  const chartDataByMetric = useMemo(() => {
    const result: Record<WellnessMetric, Array<{ date: string; dateStr: string; value: number | null }>> = {
      mood: [],
      energy: [],
      sleep: [],
      stress: [],
    }

    const today = new Date()
    for (let i = 27; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split("T")[0]
      const log = logs.find((l) => l.date === dateStr)
      const formattedDate = date.toLocaleDateString("en-US", { month: "short", day: "numeric" })

      for (const metric of ["mood", "energy", "sleep", "stress"] as WellnessMetric[]) {
        result[metric].push({
          date: formattedDate,
          dateStr,
          value: log ? (log[metric] ?? null) : null,
        })
      }
    }

    return result
  }, [logs])

  // Most recent values for display
  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => b.date.localeCompare(a.date)),
    [logs]
  )
  const mostRecent = sortedLogs[0]

  if (isLoading) {
    return (
      <div>
        <h3 className="text-[15px] font-semibold text-[#0c1a1e] mb-3">Daily Wellness</h3>
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white rounded-[6px] h-[220px] animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <OverviewEmptySection
        title="Daily Wellness"
        primaryMessage="No daily wellness data yet"
        secondaryMessage="Daily wellness data will appear here when submitted"
        icon={Activity}
      />
    )
  }

  return (
    <div>
      <h3 className="text-[15px] font-semibold text-[#0c1a1e] mb-3">Daily Wellness</h3>
      <div className="grid grid-cols-2 gap-3">
        {WELLNESS_CARDS.map((card, index) => (
          <div
            key={card.metric}
            className="animate-card-in"
            style={{ animationDelay: `${0.16 + index * 0.04}s` }}
          >
            <WellnessBarChart
              metric={card.metric}
              data={chartDataByMetric[card.metric]}
              currentValue={mostRecent?.[card.metric] ?? undefined}
              label={card.label}
              barColorOverride={card.color}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
