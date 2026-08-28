"use client";

import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { HABIT_DROPOFF_THRESHOLD_PERCENT } from "@/lib/constants";
import { MONO, MONO_META_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { OpenTabLink, OverviewCard } from "./overview-primitives";
import { formatDayInitial, pluralize } from "./overview-format";
import type { ClientTab } from "@/lib/client-tabs";
import type { AdherenceSummary, DotState } from "@/types/coach-overview";

type AdherenceCardProps = {
  adherence: AdherenceSummary | null;
  isLoading: boolean;
  windowDays: number;
  onTabChange: (tab: ClientTab) => void;
};

// Teal for done, a lighter teal for partial, warning amber for missed, the
// faintest tint for a day the client never touched.
const DOT_CLASS: Record<Exclude<DotState, "none">, string> = {
  complete: "bg-[#0d9488]",
  partial: "bg-[rgba(13,148,136,0.40)]",
  missed: "bg-[#d97706]",
  no_log: "bg-[rgba(13,148,136,0.12)]",
};

const LEGEND: { state: Exclude<DotState, "none">; label: string }[] = [
  { state: "complete", label: "Complete" },
  { state: "partial", label: "Partial" },
  { state: "missed", label: "Missed" },
  { state: "no_log", label: "No log" },
];

function Legend() {
  return (
    <div className="flex items-center gap-3">
      {LEGEND.map((item) => (
        <span key={item.state} className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", DOT_CLASS[item.state])} aria-hidden />
          {/* Passive rail words stay normal-case muted sans (divider grammar). */}
          <span className="text-[10px] text-[#93b0b4]">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * One rail. Every row renders the same `repeat(n, 1fr)` grid in the same
 * flex slot, so the dot columns line up vertically across all three rows.
 */
function DotRail({ dates, rail }: { dates: string[]; rail: DotState[] }) {
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }}
    >
      {dates.map((date, i) => {
        const state = rail[i] ?? "no_log";
        return (
          <div key={date} className="flex flex-col items-center gap-1">
            {state === "none" ? (
              // No session was planned that day — a dash, not a missed dot.
              <span className="h-2 w-2 shrink-0" aria-hidden>
                <span className="mt-[3.5px] block h-px w-2 bg-[rgba(13,148,136,0.20)]" />
              </span>
            ) : (
              <span
                className={cn("h-2 w-2 shrink-0 rounded-full", DOT_CLASS[state])}
                aria-hidden
              />
            )}
            <span className="text-[9px] leading-none text-[#93b0b4]">
              {formatDayInitial(date)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Row({
  name,
  subline,
  sublineIsNumeric,
  pct,
  dates,
  rail,
  linkLabel,
  onOpen,
}: {
  name: string;
  subline: string;
  sublineIsNumeric: boolean;
  pct: number | null;
  dates: string[];
  rail: DotState[];
  linkLabel: string;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-5 px-5 py-4">
      <div className="w-[168px] shrink-0">
        <p className="text-[13px] font-semibold text-[#0c1a1e]">{name}</p>
        <p
          className={cn(
            "mt-0.5 text-[11px]",
            sublineIsNumeric ? MONO_META_CLASS : "text-[#93b0b4]"
          )}
        >
          {subline}
        </p>
      </div>

      <div className="w-[62px] shrink-0 text-right">
        {pct === null ? (
          <span className="text-[22px] font-semibold text-[#93b0b4]">—</span>
        ) : (
          <span className={cn(MONO, "text-[22px] font-semibold text-[#0c1a1e]")}>
            {pct}
            <span className="ml-0.5 text-[12px] font-medium text-[#93b0b4]">%</span>
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <DotRail dates={dates} rail={rail} />
      </div>

      <div className="w-[96px] shrink-0 text-right">
        <OpenTabLink label={linkLabel} onClick={onOpen} />
      </div>
    </div>
  );
}

export function AdherenceCard({
  adherence,
  isLoading,
  windowDays,
  onTabChange,
}: AdherenceCardProps) {
  const meta = `Last ${windowDays} days`;

  if (isLoading && !adherence) {
    return (
      <div>
        <SectionLabel label="Adherence" meta={meta} />
        <Skeleton className="h-[236px] w-full rounded-[6px]" />
      </div>
    );
  }

  if (!adherence) {
    return (
      <div>
        <SectionLabel label="Adherence" meta={meta} />
        <OverviewCard>
          <p className="px-5 py-10 text-center text-[13px] text-[#93b0b4]">
            Adherence could not be loaded.
          </p>
        </OverviewCard>
      </div>
    );
  }

  const { dates, training, nutrition, habits } = adherence;

  return (
    <div>
      <SectionLabel
        label="Adherence"
        actions={
          <div className="flex items-center gap-4">
            <Legend />
            <span className={cn(MONO_META_CLASS, "whitespace-nowrap text-[11px]")}>{meta}</span>
          </div>
        }
      />

      <OverviewCard>
        <div className="divide-y divide-[rgba(13,148,136,0.06)]">
          <Row
            name="Training"
            subline={
              training.planned === 0
                ? "No sessions planned in this window"
                : `${training.completed} of ${pluralize(training.planned, "session")} completed`
            }
            sublineIsNumeric={training.planned > 0}
            pct={training.pct}
            dates={dates}
            rail={training.rail}
            linkLabel="Open Training"
            onOpen={() => onTabChange("training")}
          />
          <Row
            name="Nutrition"
            subline={
              nutrition.loggedDays === 0
                ? "No days logged in this window"
                : `${nutrition.onTarget} on target · ${pluralize(nutrition.loggedDays, "day")} logged`
            }
            sublineIsNumeric={nutrition.loggedDays > 0}
            pct={nutrition.pct}
            dates={dates}
            rail={nutrition.rail}
            linkLabel="Open Nutrition"
            onOpen={() => onTabChange("nutrition")}
          />
          <Row
            name="Habits"
            subline={
              habits.avgPct === null
                ? "No habits active in this window"
                : habits.daysBelow50 === 0
                  ? `Every day at or above ${HABIT_DROPOFF_THRESHOLD_PERCENT}%`
                  : `${pluralize(habits.daysBelow50, "day")} below ${HABIT_DROPOFF_THRESHOLD_PERCENT}%`
            }
            sublineIsNumeric={habits.avgPct !== null}
            pct={habits.avgPct}
            dates={dates}
            rail={habits.rail}
            linkLabel="Open Habits"
            onOpen={() => onTabChange("daily-habits")}
          />
        </div>
      </OverviewCard>
    </div>
  );
}
