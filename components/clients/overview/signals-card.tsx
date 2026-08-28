"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { HABIT_DROPOFF_THRESHOLD_PERCENT } from "@/lib/constants";
import {
  MONO,
  MONO_META_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { OpenTabLink, OverviewCard } from "./overview-primitives";
import { pluralize } from "./overview-format";
import {
  HabitsDetail,
  NutritionDetail,
  TrainingDetail,
  WELLNESS_METRICS,
  WellnessDetail,
  flagDaysByType,
} from "./signal-details";
import { signalsWindowLabel } from "@/lib/overview/window";
import type { ClientTab } from "@/lib/client-tabs";
import type { AttentionAlert } from "@/types/attention-feed";
import type { AdherenceSummary, DotState } from "@/types/coach-overview";
import type { DailyLog } from "@/types/daily-log";

/**
 * How consistent this client has been over the last fortnight. One card, four
 * rows, each opening onto the detail its percentage cannot carry.
 *
 * The window is FIXED (`SIGNALS_WINDOW_DAYS`) and not offered as a choice —
 * this is a glance, and the selectable 30/60 it replaced buried the days a
 * coach can still act on inside a quarter of history. Long ranges live on the
 * Journey tab.
 *
 * It replaces two cards — the three-rail adherence card and the five wellness
 * cards — that asked the coach to compare four consistency signals across two
 * different layouts on two different windows.
 */
type SignalsCardProps = {
  adherence: AdherenceSummary | null;
  isAdherenceLoading: boolean;
  wellnessLogs: DailyLog[];
  isWellnessLoading: boolean;
  /** The window's dates, oldest → newest — the wellness panel's day axis. */
  dates: string[];
  attentionAlerts: AttentionAlert[];
  onTabChange: (tab: ClientTab) => void;
};

const LEGEND: { state: Exclude<DotState, "none">; label: string }[] = [
  { state: "complete", label: "Complete" },
  { state: "partial", label: "Partial" },
  { state: "missed", label: "Missed" },
  { state: "no_log", label: "No log" },
];

const LEGEND_DOT: Record<Exclude<DotState, "none">, string> = {
  complete: "bg-[#0d9488]",
  partial: "bg-[rgba(13,148,136,0.40)]",
  missed: "bg-[#d97706]",
  no_log: "bg-[rgba(13,148,136,0.12)]",
};

function Legend() {
  return (
    <div className="flex items-center gap-3">
      {LEGEND.map((item) => (
        <span key={item.state} className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", LEGEND_DOT[item.state])} aria-hidden />
          {/* Passive rail words stay normal-case muted sans (divider grammar). */}
          <span className="text-[10px] text-[#93b0b4]">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * One signal.
 *
 * Wellness passes `pct: undefined` and gets EMPTY % and bar slots rather than a
 * reflowed row: there is no composite wellness score anywhere in this codebase,
 * only per-metric tones, and inventing one would be new business logic. Keeping
 * its name and sub columns where the other three have them is what lets the
 * four still read as one set.
 */
function SignalRow({
  name,
  pct,
  sub,
  subIsNumeric,
  chip,
  detail,
  linkLabel,
  onOpen,
}: {
  name: string;
  pct?: number | null;
  sub: string;
  subIsNumeric: boolean;
  chip?: ReactNode;
  detail: ReactNode;
  linkLabel: string;
  onOpen: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isBelowThreshold = pct != null && pct < HABIT_DROPOFF_THRESHOLD_PERCENT;

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-[rgba(13,148,136,0.03)]"
      >
        <span className="flex w-[150px] shrink-0 items-center gap-2">
          <span className="text-[13px] font-semibold text-[#0c1a1e]">{name}</span>
          {chip}
        </span>

        <span className="w-[54px] shrink-0 text-right">
          {pct === undefined ? null : pct === null ? (
            <span className="text-[18px] font-semibold text-[#93b0b4]">—</span>
          ) : (
            <span
              className={cn(
                MONO,
                "text-[18px] font-semibold",
                isBelowThreshold ? "text-[#d97706]" : "text-[#0c1a1e]"
              )}
            >
              {pct}
              <span className="ml-0.5 text-[11px] font-medium text-[#93b0b4]">%</span>
            </span>
          )}
        </span>

        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#f0f5f4]">
          {pct != null && (
            <span
              className={cn(
                "block h-full rounded-full",
                isBelowThreshold ? "bg-[#d97706]" : "bg-[#0d9488]"
              )}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          )}
        </span>

        <span
          className={cn(
            "hidden w-[220px] shrink-0 truncate text-right text-[11px] lg:block",
            subIsNumeric ? MONO_META_CLASS : "text-[#93b0b4]"
          )}
        >
          {sub}
        </span>

        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[#93b0b4] transition-transform duration-200",
            isOpen && "rotate-180"
          )}
          strokeWidth={1.5}
          aria-hidden
        />
      </button>

      {isOpen && (
        <div className="px-5 pb-4">
          {detail}
          <div className="mt-3">
            <OpenTabLink label={linkLabel} onClick={onOpen} />
          </div>
        </div>
      )}
    </div>
  );
}

function Shell({
  children,
  withLegend = true,
}: {
  children: ReactNode;
  withLegend?: boolean;
}) {
  return (
    <div>
      {/* Both the legend and the window meta ride in `actions`: SectionLabel
          renders `meta` BEFORE `actions` and offers no way to reorder, and the
          window belongs at the far right where every other rail puts it. */}
      <SectionLabel
        label="Signals"
        actions={
          <div className="flex shrink-0 items-center gap-4">
            {withLegend && <Legend />}
            <span className={cn(MONO_META_CLASS, "whitespace-nowrap text-[11px]")}>
              {signalsWindowLabel()}
            </span>
          </div>
        }
      />
      {children}
    </div>
  );
}

export function SignalsCard({
  adherence,
  isAdherenceLoading,
  wellnessLogs,
  isWellnessLoading,
  dates,
  attentionAlerts,
  onTabChange,
}: SignalsCardProps) {
  if (isAdherenceLoading && !adherence) {
    return (
      <Shell withLegend={false}>
        <Skeleton className="h-[228px] w-full rounded-[6px]" />
      </Shell>
    );
  }

  if (!adherence) {
    // The error state the adherence card already had. Easy to lose in a
    // rewrite, and losing it turns a failed fetch into a client who does
    // nothing.
    return (
      <Shell withLegend={false}>
        <OverviewCard>
          <p className="px-5 py-10 text-center text-[13px] text-[#93b0b4]">
            Adherence could not be loaded.
          </p>
        </OverviewCard>
      </Shell>
    );
  }

  const { training, nutrition, habits } = adherence;

  // Which wellness metrics are currently flagged. Counted from the alerts, not
  // from the logs: a flag is a trigger's verdict over its own window, and the
  // metrics that CAN flag are four of the five (sleep has no trigger).
  const flags = flagDaysByType(attentionAlerts);
  const flaggedCount = WELLNESS_METRICS.filter(
    (spec) => spec.alert && flags.has(spec.alert.type)
  ).length;

  return (
    <Shell>
      <OverviewCard>
        <div className="divide-y divide-[rgba(13,148,136,0.06)]">
          <SignalRow
            name="Training"
            pct={training.pct}
            sub={
              training.planned === 0
                ? "No sessions planned in this window"
                : `${training.completed} of ${pluralize(training.planned, "session")} completed`
            }
            subIsNumeric={training.planned > 0}
            detail={<TrainingDetail dates={adherence.dates} rail={training.rail} />}
            linkLabel="Open Training"
            onOpen={() => onTabChange("training")}
          />

          <SignalRow
            name="Nutrition"
            pct={nutrition.pct}
            // The denominator is the WHOLE window, not the days logged — a
            // client who logged 10 of 30 days perfectly reads 33%. Shipped
            // semantics, left alone; the sub-line is what stops the bar being
            // read as "how well they ate".
            sub={
              nutrition.loggedDays === 0
                ? "No days logged in this window"
                : `${nutrition.onTarget} on target · ${pluralize(nutrition.loggedDays, "day")} logged`
            }
            subIsNumeric={nutrition.loggedDays > 0}
            detail={<NutritionDetail nutrition={nutrition} />}
            linkLabel="Open Nutrition"
            onOpen={() => onTabChange("nutrition")}
          />

          <SignalRow
            name="Habits"
            pct={habits.avgPct}
            sub={
              habits.avgPct === null
                ? "No habits active in this window"
                : habits.daysBelow50 === 0
                  ? `Every day at or above ${HABIT_DROPOFF_THRESHOLD_PERCENT}%`
                  : `${pluralize(habits.daysBelow50, "day")} below ${HABIT_DROPOFF_THRESHOLD_PERCENT}%`
            }
            subIsNumeric={habits.avgPct !== null}
            detail={<HabitsDetail perHabit={habits.perHabit} />}
            linkLabel="Open Habits"
            onOpen={() => onTabChange("daily-habits")}
          />

          <SignalRow
            name="Wellness"
            // No percentage and no bar, deliberately: there is no composite
            // wellness score in this codebase, only per-metric tones, and a
            // number invented here would be new business logic wearing the
            // same shape as three real ones.
            chip={
              flaggedCount > 0 ? (
                <span
                  className={cn(
                    MONO,
                    "shrink-0 rounded-[4px] bg-[rgba(245,158,11,0.07)] px-1.5 py-px text-[10px] font-semibold text-[#d97706]"
                  )}
                >
                  {flaggedCount}
                </span>
              ) : undefined
            }
            sub={
              isWellnessLoading && wellnessLogs.length === 0
                ? "Loading"
                : flaggedCount > 0
                  ? `${pluralize(flaggedCount, "metric")} flagged`
                  : "Nothing flagged"
            }
            subIsNumeric={flaggedCount > 0 && !isWellnessLoading}
            detail={
              <WellnessDetail
                logs={wellnessLogs}
                dates={dates}
                attentionAlerts={attentionAlerts}
              />
            }
            linkLabel="Open Wellness"
            onOpen={() => onTabChange("wellness")}
          />
        </div>
      </OverviewCard>
    </Shell>
  );
}
