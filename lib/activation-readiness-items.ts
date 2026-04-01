import type { ClientTab } from "@/lib/client-tabs"

export type Readiness = {
  hasTrainingPlan: boolean
  hasNutritionPlan: boolean
  hasHabits: boolean
  hasRoadmap: boolean
  hasActivePhase: boolean
  roadmapRecommended: boolean
}

export const REQUIRED_ITEMS: { key: keyof Readiness; label: string; tab: ClientTab }[] = [
  { key: "hasTrainingPlan", label: "Training plan", tab: "training" },
  { key: "hasNutritionPlan", label: "Nutrition plan", tab: "nutrition" },
  { key: "hasHabits", label: "Daily habits", tab: "daily-habits" },
]

export const RECOMMENDED_ITEMS: { key: keyof Readiness; label: string }[] = [
  { key: "hasRoadmap", label: "Roadmap" },
  { key: "hasActivePhase", label: "Active phase" },
]
