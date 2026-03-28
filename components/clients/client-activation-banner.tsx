"use client"

import useSWR from "swr"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { ClientActivationDialog } from "@/components/coach/client-activation-dialog"
import { CheckCircle2, XCircle, AlertTriangle, Rocket } from "lucide-react"
import type { ClientTab } from "@/lib/client-tabs"
import type { OnboardingStatus } from "@/types/client-intake"

import { swrFetcher } from "@/lib/swr-fetcher"

type Readiness = {
  hasTrainingPlan: boolean
  hasNutritionPlan: boolean
  hasHabits: boolean
  hasRoadmap: boolean
  hasActivePhase: boolean
  roadmapRecommended: boolean
}

interface ClientActivationBannerProps {
  client: {
    id: string
    name: string
    email: string
    onboardingStatus?: OnboardingStatus
  }
  onActivated?: () => void
  onTabChange?: (tab: ClientTab) => void
}

const REQUIRED_ITEMS: { key: keyof Readiness; label: string; tab: ClientTab }[] = [
  { key: "hasTrainingPlan", label: "Training plan", tab: "training" },
  { key: "hasNutritionPlan", label: "Nutrition plan", tab: "nutrition" },
  { key: "hasHabits", label: "Daily habits", tab: "daily-habits" },
]

const RECOMMENDED_ITEMS: { key: keyof Readiness; label: string }[] = [
  { key: "hasRoadmap", label: "Roadmap" },
  { key: "hasActivePhase", label: "Active phase" },
]

export function ClientActivationBanner({ client, onActivated, onTabChange }: ClientActivationBannerProps) {
  const { data, isLoading } = useSWR<{ success: boolean; data: Readiness }>(
    client.onboardingStatus === "setup_in_progress"
      ? `/api/clients/${client.id}/activation-readiness`
      : null,
    swrFetcher,
    { revalidateOnFocus: false }
  )

  if (isLoading || !data?.data || client.onboardingStatus !== "setup_in_progress") return null

  const readiness = data.data
  const readyCount = REQUIRED_ITEMS.filter((item) => readiness[item.key]).length
  const hasMissing = readyCount < REQUIRED_ITEMS.length

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.05 }}
      className="bg-card border border-green-200 dark:border-green-800 rounded-lg p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Rocket className="w-4 h-4 text-green-600" />
          <h3 className="text-base font-semibold tracking-tight">
            Ready to Activate ({readyCount} of {REQUIRED_ITEMS.length} plans ready)
          </h3>
        </div>

        <ClientActivationDialog
          client={client}
          onActivated={onActivated}
          trigger={
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white">
              <Rocket className="h-4 w-4 mr-2" />
              Activate Client
            </Button>
          }
        />
      </div>

      <div className="rounded-lg border p-4 space-y-2">
        {REQUIRED_ITEMS.map((item) => {
          const checked = readiness[item.key]
          return (
            <button
              key={item.key}
              onClick={() => !checked && onTabChange?.(item.tab)}
              className={`flex items-center gap-2 text-sm w-full text-left ${
                !checked ? "cursor-pointer hover:underline" : ""
              }`}
              disabled={checked}
            >
              {checked ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
              )}
              <span>{item.label}</span>
            </button>
          )
        })}

        {readiness.roadmapRecommended && (
          <>
            <p className="text-xs text-muted-foreground pt-2">Recommended</p>
            {RECOMMENDED_ITEMS.map((item) => {
              const checked = readiness[item.key]
              return (
                <div key={item.key} className="flex items-center gap-2 text-sm">
                  {checked ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                  )}
                  <span>{item.label}</span>
                </div>
              )
            })}
          </>
        )}
      </div>

      {!readiness.hasRoadmap && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => onTabChange?.("roadmap")}
        >
          Build Roadmap
        </Button>
      )}

      {hasMissing && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-400 mt-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            Some plans haven&apos;t been set up yet. Click a missing item to jump to that tab, or activate now with an incomplete program.
          </p>
        </div>
      )}
    </motion.div>
  )
}
