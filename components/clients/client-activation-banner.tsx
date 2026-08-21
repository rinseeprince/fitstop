"use client"

import type { ReactNode } from "react"
import useSWR from "swr"
import { ArrowRight, ChevronRight, CircleCheckBig, Dumbbell, ListChecks, Rocket, Utensils } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ClientActivationDialog } from "@/components/coach/client-activation-dialog"
import { pluralize } from "@/components/clients/overview/overview-format"
import { CARD_HAIRLINE, OverviewCard } from "@/components/clients/overview/overview-primitives"
import {
  FOCUS_RING,
  MONO_META_CLASS,
  THUMB_CLASS,
  TRAINING_CARD_BORDER,
} from "@/components/clients/training/program-builder/builder-tokens"
import { REQUIRED_ITEMS, type Readiness } from "@/lib/activation-readiness-items"
import { swrFetcher } from "@/lib/swr-fetcher"
import { cn } from "@/lib/utils"
import type { ClientTab } from "@/lib/client-tabs"
import type { OnboardingStatus } from "@/types/client-intake"
import type { OverviewPlanSummary } from "@/types/coach-overview"

interface ClientActivationBannerProps {
  client: {
    id: string
    name: string
    email: string
    onboardingStatus?: OnboardingStatus
  }
  /**
   * The Overview's own plan summary, already fetched for its Current plan
   * cards. A row whose plan is in place reads its live line from here — the
   * readiness endpoint answers "is it there?", never "what is in it", and this
   * card is not worth a second query.
   */
  planSummary?: OverviewPlanSummary | null
  /** True while `planSummary` is still in flight — see PENDING. */
  planSummaryLoading?: boolean
  onActivated?: () => void
  onTabChange?: (tab: ClientTab) => void
}

const ROW_ICON: Record<keyof Readiness, ReactNode> = {
  hasTrainingPlan: <Dumbbell className="h-[15px] w-[15px]" strokeWidth={1.5} />,
  hasNutritionPlan: <Utensils className="h-[15px] w-[15px]" strokeWidth={1.5} />,
  hasHabits: <ListChecks className="h-[15px] w-[15px]" strokeWidth={1.5} />,
}

/**
 * Two forms per plan for the footer sentence: `subject` reads as the thing
 * being sent ("sends the training plan through"), `bare` as a list member
 * ("Nutrition and habits can follow").
 */
const PLAN_WORDS: Record<keyof Readiness, { subject: string; bare: string }> = {
  hasTrainingPlan: { subject: "the training plan", bare: "training" },
  hasNutritionPlan: { subject: "the nutrition plan", bare: "nutrition" },
  hasHabits: { subject: "daily habits", bare: "habits" },
}

/**
 * A row's second line, with the font decision attached: a number-bearing
 * datum is mono, the word-only states ("Ready", "Not set up") are sans.
 * `pending` is the readiness-arrived-first case — see PENDING below.
 */
type RowLine = { kind: "text"; text: string; isNumeric: boolean } | { kind: "pending" }

const READY: RowLine = { kind: "text", text: "Ready", isNumeric: false }
const NOT_STARTED: RowLine = { kind: "text", text: "Not set up", isNumeric: false }

/**
 * Readiness is the lighter of the two requests and lands first, so a row that
 * is in place would otherwise commit to "Ready" and then swap to its real line
 * a beat later. A placeholder says "still resolving" instead of stating
 * something it is about to replace.
 */
const PENDING: RowLine = { kind: "pending" }

/**
 * Weeks and frequency, the two facts the plan record actually carries. A total
 * session count is NOT one of them: weeks x frequency would be a number no
 * plan holds, and the Overview fetches nothing that counts placed sessions.
 */
function trainingLine(summary: OverviewPlanSummary | null | undefined): RowLine | null {
  // A program placed to start later lives in `upcomingTraining` — `training`
  // resolves strictly by date — and readiness counts both as set up.
  const plan = summary?.training ?? summary?.upcomingTraining ?? null
  if (!plan) return null

  // Both are optional on the plan record, so a plan can carry one, the other,
  // or neither.
  const parts: string[] = []
  if (plan.programDurationWeeks !== null) parts.push(pluralize(plan.programDurationWeeks, "week"))
  if (plan.frequencyPerWeek !== null) parts.push(`${plan.frequencyPerWeek}x/week`)
  return parts.length > 0 ? { kind: "text", text: parts.join(" · "), isNumeric: true } : null
}

/** Rest-day calories + protein — the prescription's two headline numbers. */
function nutritionLine(summary: OverviewPlanSummary | null | undefined): RowLine | null {
  const plan = summary?.nutrition ?? null
  if (!plan) return null

  // Both are guaranteed by the contract: the service falls back from the
  // nullable custom-macro overrides to the non-null baseline columns.
  return {
    kind: "text",
    text: `${plan.restDayCalories.toLocaleString("en-GB")} kcal · ${plan.macros.proteinG}g protein`,
    isNumeric: true,
  }
}

function rowLine(
  key: keyof Readiness,
  ready: boolean,
  summary: OverviewPlanSummary | null | undefined,
  summaryLoading: boolean
): RowLine {
  if (!ready) return NOT_STARTED
  switch (key) {
    case "hasTrainingPlan":
      return trainingLine(summary) ?? (summaryLoading ? PENDING : READY)
    case "hasNutritionPlan":
      return nutritionLine(summary) ?? (summaryLoading ? PENDING : READY)
    default:
      // Habits: the Overview fetches no habit detail, so the state is the line.
      // Nothing to wait for, so this one never pends.
      return READY
  }
}

/** "a, b and c" — British list, no Oxford comma. */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ""
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

/**
 * What pressing Activate actually does, given what is in place. This carries
 * the one idea the old amber warning strip was worth keeping: an incomplete
 * program is allowed to go live.
 */
function activationLine(readiness: Readiness): string {
  const ready = REQUIRED_ITEMS.filter((item) => readiness[item.key])
  const missing = REQUIRED_ITEMS.filter((item) => !readiness[item.key])

  if (missing.length === 0) return "Activating sends every plan through and emails the client."
  if (ready.length === 0) {
    return "Activating emails the client now. Every plan can follow at any time."
  }

  // One plan reads better named in full ("the training plan"); several read
  // better bare ("training and nutrition").
  const sent =
    ready.length === 1
      ? PLAN_WORDS[ready[0].key].subject
      : joinWords(ready.map((item) => PLAN_WORDS[item.key].bare))
  const later = joinWords(missing.map((item) => PLAN_WORDS[item.key].bare))

  return `Activating now sends ${sent} through. ${later[0].toUpperCase()}${later.slice(1)} can follow at any time.`
}

/** One plan, as a jump target to the tab that owns it. */
function PlanRow({
  label,
  icon,
  ready,
  line,
  onOpen,
}: {
  label: string
  icon: ReactNode
  ready: boolean
  line: RowLine
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${ready ? "Open" : "Set up"} ${label.toLowerCase()}`}
      className={cn(
        "group/row flex w-full items-center gap-2.5 rounded-[6px] bg-white px-3 py-2.5 text-left",
        "transition-all duration-150 hover:-translate-y-px",
        "hover:border-[rgba(13,148,136,0.25)] hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
        TRAINING_CARD_BORDER,
        FOCUS_RING
      )}
    >
      {/* Colour carries the state: teal for a plan that is in place, neutral
          for one not started. An unstarted plan is not an error, so nothing
          here borrows the warning or destructive palette. */}
      <span
        className={cn(THUMB_CLASS, "h-[30px] w-[30px]", !ready && "bg-[#f0f5f4] text-[#93b0b4]")}
        aria-hidden
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-[#0c1a1e]">{label}</span>
        {line.kind === "pending" ? (
          // Same 16px slot the text occupies, so nothing shifts when it lands.
          <span className="mt-0.5 flex h-4 items-center">
            <Skeleton className="h-2.5 w-24 rounded-[4px] bg-[#f0f5f4]" />
          </span>
        ) : (
          <span
            className={cn(
              "mt-0.5 block truncate text-[11px]",
              line.isNumeric ? MONO_META_CLASS : "text-[#93b0b4]"
            )}
          >
            {line.text}
          </span>
        )}
      </span>

      {ready ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[#0d9488]">
          <CircleCheckBig className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          Ready
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[#0d9488] transition-colors group-hover/row:text-[#0a5c55]">
          Set up
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
        </span>
      )}
    </button>
  )
}

/**
 * The setup state of a client who has not been activated yet: what is in
 * place, what is not, and the one action that starts them. Every plan is a
 * jump target to the tab that owns it, so the card is how a coach navigates
 * setup rather than a status board they read and then leave.
 */
export function ClientActivationBanner({
  client,
  planSummary,
  planSummaryLoading = false,
  onActivated,
  onTabChange,
}: ClientActivationBannerProps) {
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

  return (
    <OverviewCard className="px-5 py-4" animationDelay="0.02s">
      <div className="flex items-center gap-3">
        <span className={cn(THUMB_CLASS, "h-8 w-8")} aria-hidden>
          <Rocket className="h-4 w-4" strokeWidth={1.5} />
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[#0c1a1e]">
            Ready to activate
          </h3>
          <p className={cn(MONO_META_CLASS, "mt-0.5 text-[11px]")}>
            {readyCount} of {REQUIRED_ITEMS.length} plans ready
          </p>
        </div>

        <ClientActivationDialog
          client={client}
          readiness={readiness}
          onActivated={onActivated}
          trigger={
            <Button
              size="sm"
              className={cn(
                "h-8 shrink-0 gap-1.5 rounded-[6px] bg-[#0d9488] px-3 text-[13px] font-medium text-white hover:bg-[#0b7f75]",
                FOCUS_RING
              )}
            >
              <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden />
              Activate client
            </Button>
          }
        />
      </div>

      <div className="mt-3.5 flex flex-col gap-2">
        {REQUIRED_ITEMS.map((item) => {
          const ready = readiness[item.key]
          return (
            <PlanRow
              key={item.key}
              label={item.label}
              icon={ROW_ICON[item.key]}
              ready={ready}
              line={rowLine(item.key, ready, planSummary, planSummaryLoading)}
              onOpen={() => onTabChange?.(item.tab)}
            />
          )
        })}
      </div>

      <p className={cn("mt-3.5 border-t pt-3 text-[11px] text-[#93b0b4]", CARD_HAIRLINE)}>
        {activationLine(readiness)}
      </p>
    </OverviewCard>
  )
}
