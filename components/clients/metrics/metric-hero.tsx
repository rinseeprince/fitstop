"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HEADER_EYEBROW_CLASS,
  MONO_LABEL_CLASS,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { MetricSwitcher } from "./metric-switcher";
import { formatShortDate, formatSigned, SOURCE_LABELS } from "./metrics-format";
import type { MetricSummary } from "./metrics-view-types";
import { TextSkeleton } from "@/components/text-skeleton";

type MetricHeroProps = {
  /** null = the metrics read is still in flight: the band renders pending
   *  inside the real elements, identical size by construction. */
  metric: MetricSummary | null;
  metrics: MetricSummary[];
  onSelectMetric: (id: string) => void;
};

// Stat-band sub-lines: number-bearing = mono branch, word-only = sans branch
// (dynamic-slot rule — the states are distinguishable, so they split).
const SUB_MONO_CLASS = cn(
  MONO_LABEL_CLASS,
  "normal-case tracking-normal text-[11px] text-[rgba(255,255,255,0.35)] mt-1"
);
const SUB_SANS_CLASS = "text-[11px] text-[rgba(255,255,255,0.35)] mt-1";
const UNIT_SUFFIX_CLASS =
  "text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5";
// A cell's number line. Every cell's is one height — the 36px Current's 24px
// number has always taken at the page's 1.5 line height — so the lines under
// the numbers sit level across the band; an empty cell draws its faint dash
// INSIDE the same line, never a shorter one. The height goes AFTER the size:
// `cn` (tailwind-merge) drops a line height that a later text size follows.
const NUMBER_LINE_HEIGHT = "leading-[36px]";
const CURRENT_VALUE_CLASS = cn(STAT_VALUE_DARK_CLASS, "mt-1 text-[24px]", NUMBER_LINE_HEIGHT);
const VALUE_CLASS = cn(STAT_VALUE_DARK_CLASS, "mt-1 text-[22px]", NUMBER_LINE_HEIGHT);
const EMPTY_DASH_CLASS = "text-[13px] font-normal text-[rgba(255,255,255,0.3)]";

function EmptyValue({ lineClass }: { lineClass: string }) {
  return (
    <p className={lineClass}>
      <span className={EMPTY_DASH_CLASS}>—</span>
    </p>
  );
}

// The Metrics page hero: dark slab with the page's only metric switcher
// (eyebrow+title+chevron trigger cluster) and a 3-cell stat band
// (hand-rolled with the StatBand tokens — the shared component can't nest in
// the slab nor render sans subs).
function PendingCell({
  label,
  lineClass,
  valueWidth,
  subWidth,
  className,
}: {
  label: string;
  lineClass: string;
  valueWidth: string;
  subWidth: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <p className={STAT_LABEL_DARK_CLASS}>{label}</p>
      <p className={lineClass}>
        <TextSkeleton className={valueWidth} />
      </p>
      <p className={SUB_SANS_CLASS}>
        <TextSkeleton className={subWidth} />
      </p>
    </div>
  );
}

/** The hero before the metrics read lands: the same band, same elements, with
 *  pending text inside them — never a silhouette, never a shorter tree. */
function MetricHeroPending() {
  return (
    <div className="bg-[#0f2027] rounded-[6px] px-5 py-[18px]">
      <div className="flex items-start justify-between gap-3 mb-3 pb-3 border-b border-[rgba(255,255,255,0.06)]">
        <div className="-mx-2 -my-1 flex min-w-0 items-center gap-3 rounded-[6px] px-2 py-1 text-left">
          <div className="min-w-0">
            <p className={HEADER_EYEBROW_CLASS}>Metric</p>
            <p className="text-[15px] font-medium text-white mt-0.5 truncate">
              <TextSkeleton className="w-24" />
            </p>
          </div>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-[rgba(255,255,255,0.3)]"
            strokeWidth={1.5}
          />
        </div>
      </div>
      <div className="grid grid-cols-3">
        <PendingCell
          label="Current"
          lineClass={CURRENT_VALUE_CLASS}
          valueWidth="w-16"
          subWidth="w-20"
          className="pr-5 border-r border-[rgba(255,255,255,0.07)]"
        />
        <PendingCell
          label="Total change"
          lineClass={VALUE_CLASS}
          valueWidth="w-14"
          subWidth="w-20"
          className="pl-5 pr-5 border-r border-[rgba(255,255,255,0.07)]"
        />
        <PendingCell
          label="Avg rate"
          lineClass={VALUE_CLASS}
          valueWidth="w-14"
          subWidth="w-16"
          className="pl-5"
        />
      </div>
    </div>
  );
}

export function MetricHero({ metric, metrics, onSelectMetric }: MetricHeroProps) {
  if (!metric) return <MetricHeroPending />;
  const { latest, first, totalChange, startsOn, avgRate, entryCount, unit } = metric;

  const trigger = (
    <button
      type="button"
      className="-mx-2 -my-1 flex min-w-0 items-center gap-3 rounded-[6px] px-2 py-1 text-left transition-colors hover:bg-[#132930] data-[state=open]:bg-[#132930]"
    >
      <div className="min-w-0">
        <p className={HEADER_EYEBROW_CLASS}>Metric</p>
        <p className="text-[15px] font-medium text-white mt-0.5 truncate">
          {metric.name}
        </p>
      </div>
      <ChevronDown
        className="h-4 w-4 shrink-0 text-[rgba(255,255,255,0.3)]"
        strokeWidth={1.5}
      />
    </button>
  );

  return (
    <div className="bg-[#0f2027] rounded-[6px] px-5 py-[18px]">
      {/* Header: the switcher trigger */}
      <div className="flex items-start justify-between gap-3 mb-3 pb-3 border-b border-[rgba(255,255,255,0.06)]">
        <MetricSwitcher
          metrics={metrics}
          activeId={metric.id}
          onSelect={onSelectMetric}
          trigger={trigger}
        />
      </div>

      {/* Stat band */}
      <div className="grid grid-cols-3">
        {/* CURRENT */}
        <div className="flex flex-col pr-5 border-r border-[rgba(255,255,255,0.07)]">
          <p className={STAT_LABEL_DARK_CLASS}>Current</p>
          {latest ? (
            <>
              <p className={CURRENT_VALUE_CLASS}>
                {latest.value}
                {unit && <span className={UNIT_SUFFIX_CLASS}>{unit}</span>}
              </p>
              {latest.daysAgo === 0 ? (
                <p className={SUB_SANS_CLASS}>logged today</p>
              ) : latest.daysAgo === 1 ? (
                <p className={SUB_SANS_CLASS}>logged yesterday</p>
              ) : (
                <p className={SUB_MONO_CLASS}>
                  logged {formatShortDate(latest.date)}
                </p>
              )}
            </>
          ) : (
            <>
              <EmptyValue lineClass={CURRENT_VALUE_CLASS} />
              <p className={SUB_SANS_CLASS}>No entries yet</p>
            </>
          )}
        </div>

        {/* TOTAL CHANGE — since the START DATE for a physique metric, against
            the baseline (the reading as of it, named with its own date and
            source), `Starts …` while the start date is still ahead; for a
            wellness score, the last 7 days' average against the client's
            first week of entries (D32), once the two weeks no longer share a
            day and each holds enough entries. */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.07)]">
          <p className={STAT_LABEL_DARK_CLASS}>Total change</p>
          {totalChange?.kind === "notEnoughEntries" || totalChange?.kind === "tooSoon" ? (
            <>
              <EmptyValue lineClass={VALUE_CLASS} />
              <p className={SUB_SANS_CLASS}>
                {totalChange.kind === "tooSoon" ? "Too soon to compare" : "Not enough entries"}
              </p>
            </>
          ) : totalChange ? (
            <>
              <p className={VALUE_CLASS}>
                {formatSigned(totalChange.delta)}
                {unit && <span className={UNIT_SUFFIX_CLASS}>{unit}</span>}
              </p>
              <p className={SUB_MONO_CLASS}>
                {totalChange.kind === "sinceStart"
                  ? `from ${totalChange.baseline.value}${unit ? ` ${unit}` : ""} · ${SOURCE_LABELS[totalChange.baseline.source]} ${formatShortDate(totalChange.baseline.date)}`
                  : `since the week of ${formatShortDate(totalChange.firstWeekOf)}`}
              </p>
            </>
          ) : startsOn ? (
            <>
              <EmptyValue lineClass={VALUE_CLASS} />
              <p className={SUB_MONO_CLASS}>Starts {formatShortDate(startsOn)}</p>
            </>
          ) : (
            <EmptyValue lineClass={VALUE_CLASS} />
          )}
        </div>

        {/* AVG RATE / ENTRIES fallback */}
        <div className="flex flex-col pl-5">
          {avgRate ? (
            <>
              <p className={STAT_LABEL_DARK_CLASS}>Avg rate</p>
              <p className={VALUE_CLASS}>
                {formatSigned(avgRate.perWeek)}
                <span className={UNIT_SUFFIX_CLASS}>{unit}/wk</span>
              </p>
              <p className={SUB_MONO_CLASS}>
                over {avgRate.weeks} {avgRate.weeks === 1 ? "week" : "weeks"}
              </p>
            </>
          ) : (
            <>
              <p className={STAT_LABEL_DARK_CLASS}>Entries</p>
              {entryCount > 0 && first ? (
                <>
                  <p className={VALUE_CLASS}>
                    {entryCount}
                  </p>
                  <p className={SUB_MONO_CLASS}>
                    since {formatShortDate(first.date)}
                  </p>
                </>
              ) : (
                <EmptyValue lineClass={VALUE_CLASS} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
