"use client"

import { useSavedPlans } from "@/hooks/use-saved-plans"
import { useSavedPlanAssignments } from "@/hooks/use-saved-plan-assignments"
import { StatBand, type StatBandCell } from "./shared/stat-band"
import { abbreviateFocus, getMode, getWeekCount } from "./shared/derive-plan-stats"

// Programs-page KPI band. Everything except assignments is derived
// client-side from the (full-tree) saved-plans list payload.
export function ProgramsStatBand() {
  const { plans, isLoading } = useSavedPlans({ includeDrafts: true })
  const { assignments } = useSavedPlanAssignments()

  const aiCount = plans.filter((p) => p.source === "ai").length
  const customCount = plans.length - aiCount

  const weekCounts = plans.map(getWeekCount)
  const avgWeeks =
    weekCounts.length > 0
      ? (weekCounts.reduce((a, b) => a + b, 0) / weekCounts.length).toFixed(1)
      : null
  const minWeeks = weekCounts.length > 0 ? Math.min(...weekCounts) : 0
  const maxWeeks = weekCounts.length > 0 ? Math.max(...weekCounts) : 0

  const focusMode = getMode(plans, (p) => p.splitType?.replace(/_/g, " ") ?? null)

  const cells: StatBandCell[] = [
    {
      label: "Total programs",
      value: isLoading ? "—" : String(plans.length),
      valueMuted: isLoading,
      sub: isLoading ? undefined : `${aiCount} ai · ${customCount} custom`,
    },
    {
      label: "Active assignments",
      value: assignments ? String(assignments.totalAssignments) : "—",
      valueMuted: !assignments,
      sub: assignments
        ? `across ${assignments.distinctClients} client${assignments.distinctClients === 1 ? "" : "s"}`
        : undefined,
    },
    {
      label: "Avg length",
      value: avgWeeks ?? "—",
      valueMuted: avgWeeks === null,
      unit: avgWeeks !== null ? "wks" : undefined,
      sub: avgWeeks !== null ? `range ${minWeeks}–${maxWeeks} weeks` : undefined,
    },
    {
      label: "Most used focus",
      value: focusMode ? abbreviateFocus(focusMode.value) : "—",
      valueMuted: !focusMode,
      sub: focusMode ? `${focusMode.count} of ${plans.length} programs` : undefined,
    },
  ]

  return <StatBand cells={cells} />
}
