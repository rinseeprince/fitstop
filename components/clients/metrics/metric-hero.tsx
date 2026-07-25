"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HEADER_EYEBROW_CLASS,
  MONO,
  MONO_LABEL_CLASS,
  STAT_LABEL_DARK_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { MetricSwitcher } from "./metric-switcher";
import { containsDigit, formatShortDate, formatSigned } from "./metrics-format";
import type { MetricSummary } from "./metrics-view-types";

export type MetricHeroProps = {
  metric: MetricSummary;
  metrics: MetricSummary[];
  onSelectMetric: (id: string) => void;
};

// Dark chip base (training-summary-hero:67-79); digit-bearing chips go mono.
const TAG_CHIP_CLASS =
  "bg-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.4)] text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium";
// Stat-band sub-lines: number-bearing = mono branch, word-only = sans branch
// (dynamic-slot rule — the states are distinguishable, so they split).
const SUB_MONO_CLASS = cn(
  MONO_LABEL_CLASS,
  "normal-case tracking-normal text-[11px] text-[rgba(255,255,255,0.35)] mt-1"
);
const SUB_SANS_CLASS = "text-[11px] text-[rgba(255,255,255,0.35)] mt-1";
const UNIT_SUFFIX_CLASS =
  "text-[13px] font-medium text-[rgba(255,255,255,0.25)] ml-0.5";
const EMPTY_VALUE_CLASS = "text-[13px] text-[rgba(255,255,255,0.3)] mt-1";

// The Metrics page hero: dark slab with the page's only metric switcher
// (eyebrow+title+chevron trigger cluster), tag chips, and a 3-cell stat band
// (hand-rolled with the StatBand tokens — the shared component can't nest in
// the slab nor render sans subs).
export function MetricHero({ metric, metrics, onSelectMetric }: MetricHeroProps) {
  const { latest, first, totalChange, avgRate, entryCount, unit } = metric;

  const chips: string[] = [];
  if (unit) chips.push(unit);
  if (metric.frequencyLabel) chips.push(metric.frequencyLabel);
  if (entryCount > 0) {
    chips.push(`${entryCount} ${entryCount === 1 ? "entry" : "entries"}`);
  }

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
      {/* Header: switcher trigger + tag chips */}
      <div className="flex items-start justify-between gap-3 mb-3 pb-3 border-b border-[rgba(255,255,255,0.06)]">
        <MetricSwitcher
          metrics={metrics}
          activeId={metric.id}
          onSelect={onSelectMetric}
          trigger={trigger}
        />
        {chips.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip}
                className={cn(containsDigit(chip) && MONO, TAG_CHIP_CLASS)}
              >
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stat band */}
      <div className="grid grid-cols-3">
        {/* CURRENT */}
        <div className="flex flex-col pr-5 border-r border-[rgba(255,255,255,0.07)]">
          <p className={STAT_LABEL_DARK_CLASS}>Current</p>
          {latest ? (
            <>
              <p className={cn(STAT_VALUE_DARK_CLASS, "leading-tight mt-1 text-[24px]")}>
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
              <p className={EMPTY_VALUE_CLASS}>—</p>
              <p className={SUB_SANS_CLASS}>No entries yet</p>
            </>
          )}
        </div>

        {/* TOTAL CHANGE */}
        <div className="flex flex-col pl-5 pr-5 border-r border-[rgba(255,255,255,0.07)]">
          <p className={STAT_LABEL_DARK_CLASS}>Total change</p>
          {totalChange ? (
            <>
              <p className={cn(STAT_VALUE_DARK_CLASS, "leading-tight mt-1 text-[22px]")}>
                {formatSigned(totalChange.delta)}
                {unit && <span className={UNIT_SUFFIX_CLASS}>{unit}</span>}
              </p>
              <p className={SUB_MONO_CLASS}>
                since {formatShortDate(totalChange.sinceDate)}
              </p>
            </>
          ) : (
            <p className={EMPTY_VALUE_CLASS}>—</p>
          )}
        </div>

        {/* AVG RATE / ENTRIES fallback */}
        <div className="flex flex-col pl-5">
          {avgRate ? (
            <>
              <p className={STAT_LABEL_DARK_CLASS}>Avg rate</p>
              <p className={cn(STAT_VALUE_DARK_CLASS, "leading-tight mt-1 text-[22px]")}>
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
                  <p className={cn(STAT_VALUE_DARK_CLASS, "leading-tight mt-1 text-[22px]")}>
                    {entryCount}
                  </p>
                  <p className={SUB_MONO_CLASS}>
                    since {formatShortDate(first.date)}
                  </p>
                </>
              ) : (
                <p className={EMPTY_VALUE_CLASS}>—</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
