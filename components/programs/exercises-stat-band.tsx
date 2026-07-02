"use client"

import { useExerciseCatalog } from "@/hooks/use-exercise-catalog"
import { useExerciseUsage } from "@/hooks/use-exercise-usage"
import { StatBand, type StatBandCell } from "./shared/stat-band"
import { getMode } from "./shared/derive-plan-stats"

// Exercises-page KPI band. The mockup's "With video" cell is not derivable
// (the catalog has no video column — videos live per-prescription), so the
// third/fourth cells report usage + equipment coverage instead.
export function ExercisesStatBand() {
  const { exercises, isLoading } = useExerciseCatalog()
  const { usage } = useExerciseUsage()

  const customCount = exercises.filter((e) => e.coachId != null).length

  const muscleGroups = new Set(
    exercises.map((e) => e.muscleGroup?.trim().toLowerCase()).filter(Boolean)
  )
  const muscleMode = getMode(
    exercises,
    (e) => e.muscleGroup?.trim().toLowerCase() ?? null
  )

  const equipmentTypes = new Set(
    exercises.map((e) => e.equipment?.trim().toLowerCase()).filter(Boolean)
  )
  const equipmentMode = getMode(
    exercises,
    (e) => e.equipment?.trim().toLowerCase() ?? null
  )

  const cells: StatBandCell[] = [
    {
      label: "Total exercises",
      value: isLoading ? "—" : String(exercises.length),
      valueMuted: isLoading,
      sub: isLoading ? undefined : `${customCount} custom`,
    },
    {
      label: "Muscle groups",
      value: isLoading ? "—" : String(muscleGroups.size),
      valueMuted: isLoading,
      sub: muscleMode ? `most common: ${muscleMode.value}` : undefined,
    },
    {
      label: "In use",
      value: usage ? String(usage.perExercise.length) : "—",
      valueMuted: !usage,
      sub: usage
        ? `across ${usage.sessionsWithLinks} session${usage.sessionsWithLinks === 1 ? "" : "s"}`
        : undefined,
    },
    {
      label: "Equipment types",
      value: isLoading ? "—" : String(equipmentTypes.size),
      valueMuted: isLoading,
      sub: equipmentMode ? `most common: ${equipmentMode.value}` : undefined,
    },
  ]

  return <StatBand cells={cells} />
}
