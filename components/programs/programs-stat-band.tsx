"use client"

import { useSavedPlansSummary } from "@/hooks/use-saved-plans-summary"
import { useSavedPlanAssignments } from "@/hooks/use-saved-plan-assignments"
import { StatBand, type StatBandCell } from "./shared/stat-band"

// Programs-page KPI band. Aggregates come from a lean summary endpoint (so they
// stay correct while the list paginates); assignments come from their own
// endpoint. "Most used focus" was dropped (low-value) — three cells now.
export function ProgramsStatBand() {
  const { summary, isLoading: summaryLoading } = useSavedPlansSummary(true)
  const { assignments, isLoading: assignmentsLoading } = useSavedPlanAssignments()

  const cells: StatBandCell[] = [
    {
      label: "Total programs",
      pending: summaryLoading,
      value: summary ? String(summary.total) : "—",
      valueMuted: !summary,
      sub: summary
        ? `${summary.aiCount} ai · ${summary.customCount} custom`
        : undefined,
    },
    {
      label: "Active assignments",
      pending: assignmentsLoading,
      value: assignments ? String(assignments.totalAssignments) : "—",
      valueMuted: !assignments,
      sub: assignments
        ? `across ${assignments.distinctClients} client${assignments.distinctClients === 1 ? "" : "s"}`
        : undefined,
    },
    {
      label: "Avg length",
      pending: summaryLoading,
      value: summary?.avgWeeks != null ? summary.avgWeeks.toFixed(1) : "—",
      valueMuted: summary?.avgWeeks == null,
      unit: summary?.avgWeeks != null ? "wks" : undefined,
      sub:
        summary?.avgWeeks != null
          ? `range ${summary.minWeeks}–${summary.maxWeeks} weeks`
          : undefined,
    },
  ]

  return <StatBand cells={cells} />
}
