"use client"

import { useStandaloneSessions } from "@/hooks/use-standalone-sessions"
import { StatBand, type StatBandCell } from "./shared/stat-band"
import { getMode } from "./shared/derive-plan-stats"

// Sessions-page KPI band — all client-derived from the standalone-sessions
// list (which returns full exercises). The mockup's "In programs" cell is
// not derivable (programs clone sessions by value, no reference model), so
// the fourth cell reports focus coverage instead.
export function SessionsStatBand() {
  const { sessions, isLoading } = useStandaloneSessions()

  const totalExercises = sessions.reduce((a, s) => a + s.exercises.length, 0)
  const avgExercises =
    sessions.length > 0 ? (totalExercises / sessions.length).toFixed(1) : null

  const durations = sessions
    .map((s) => s.estimatedDurationMinutes)
    .filter((d): d is number => d != null)
  const avgDuration =
    durations.length > 0
      ? String(Math.round(durations.reduce((a, b) => a + b, 0) / durations.length))
      : null

  const focusValues = new Set(
    sessions.map((s) => s.focus?.trim().toLowerCase()).filter(Boolean)
  )
  const focusMode = getMode(sessions, (s) => s.focus?.trim().toLowerCase() ?? null)

  const cells: StatBandCell[] = [
    {
      label: "Total sessions",
      value: isLoading ? "—" : String(sessions.length),
      valueMuted: isLoading,
      sub: isLoading ? undefined : `${totalExercises} exercises total`,
    },
    {
      label: "Avg exercises",
      value: avgExercises ?? "—",
      valueMuted: avgExercises === null,
      sub: avgExercises !== null ? "per session" : undefined,
    },
    {
      label: "Avg duration",
      value: avgDuration ?? "—",
      valueMuted: avgDuration === null,
      unit: avgDuration !== null ? "min" : undefined,
      sub:
        durations.length > 0
          ? `range ${Math.min(...durations)}–${Math.max(...durations)}`
          : "not set",
    },
    {
      label: "Focus types",
      value: isLoading ? "—" : String(focusValues.size),
      valueMuted: isLoading,
      sub: focusMode ? `most common: ${focusMode.value}` : undefined,
    },
  ]

  return <StatBand cells={cells} />
}
