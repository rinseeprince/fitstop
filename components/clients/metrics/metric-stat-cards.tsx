"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  MONO,
  MONO_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { formatShortDate, formatSigned, TONE_TEXT } from "./metrics-format";
import type { MetricSummary } from "./metrics-view-types";
import type { TrendDirection } from "@/types/check-in";

// Three white progression cards (30-day change / week comparison / goal-or-best).
// Anatomy copied from exercise-kpi-strip.tsx; the sub-line tone colouring is a
// deliberate divergence (direction-aware via TONE_TEXT, not hardcoded teal).

type MetricStatCardsProps = {
  metric: MetricSummary;
};

const TREND_ICON: Record<TrendDirection, typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
};

const TREND_WORD: Record<TrendDirection, string> = {
  up: "Trending up",
  down: "Trending down",
  stable: "Holding steady",
};

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] px-[14px] py-[16px]">
      {children}
    </div>
  );
}

function CardValue({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className={cn(MONO, "mt-1 tabular-nums")}>
      <span className="text-[22px] font-semibold text-[#0c1a1e]">{value}</span>
      {unit && <span className="text-[12px] text-[#93b0b4] ml-1">{unit}</span>}
    </p>
  );
}

function DashValue() {
  return (
    <p className={cn(MONO, "mt-1 tabular-nums")}>
      <span className="text-[22px] font-semibold text-[#93b0b4]">—</span>
    </p>
  );
}

export function MetricStatCards({ metric }: MetricStatCardsProps) {
  const { change30d, week, goal, goalToGo, best, unit } = metric;

  const TrendIcon = change30d ? TREND_ICON[change30d.trend] : null;

  // Goal distance sub-line: "%" units bind to the number ("1.2% to go"),
  // word units read as words ("1.2 kg to go"). Score units ("/10") never
  // carry goals, so no third case.
  const goalSub =
    goalToGo != null
      ? unit === "%"
        ? `${goalToGo}% to go`
        : `${goalToGo} ${unit} to go`
      : null;

  return (
    <div className="grid grid-cols-3 gap-[10px]">
      {/* Card 1 — 30-day change (or since-first fallback) */}
      <CardShell>
        {change30d?.kind === "sinceFirst" && change30d.sinceDate ? (
          <p className={MONO_LABEL_CLASS}>
            Since {formatShortDate(change30d.sinceDate)}
          </p>
        ) : (
          <p className={LABEL_CLASS}>30-day change</p>
        )}
        {change30d ? (
          <>
            <CardValue value={formatSigned(change30d.delta)} unit={unit} />
            <p className="flex items-center gap-1 mt-1">
              {TrendIcon && (
                <TrendIcon
                  strokeWidth={1.5}
                  className={cn("h-3 w-3", TONE_TEXT[change30d.tone])}
                />
              )}
              <span
                className={cn(
                  "text-[11px] font-medium",
                  TONE_TEXT[change30d.tone]
                )}
              >
                {TREND_WORD[change30d.trend]}
              </span>
            </p>
          </>
        ) : (
          <DashValue />
        )}
      </CardShell>

      {/* Card 2 — last 7 days vs previous (or latest fallback) */}
      <CardShell>
        {week?.kind === "weekAvg" ? (
          <>
            <p className={LABEL_CLASS}>Last 7 days</p>
            <CardValue value={week.currentAvg.toFixed(1)} unit={unit} />
            <p className={cn(MONO, "text-[11px] text-[#93b0b4] mt-1")}>
              vs {week.prevAvg.toFixed(1)} previous 7 days
            </p>
          </>
        ) : week?.kind === "latest" ? (
          <>
            <p className={LABEL_CLASS}>Latest</p>
            <CardValue value={String(week.value)} unit={unit} />
            <p className={cn(MONO, "text-[11px] text-[#93b0b4] mt-1")}>
              on {formatShortDate(week.date)}
            </p>
          </>
        ) : (
          <>
            <p className={LABEL_CLASS}>Last 7 days</p>
            <DashValue />
          </>
        )}
      </CardShell>

      {/* Card 3 — goal (or best fallback) */}
      <CardShell>
        {goal != null ? (
          <>
            <p className={LABEL_CLASS}>Goal</p>
            <CardValue value={String(goal)} unit={unit} />
            {goalSub && (
              <p className={cn(MONO, "text-[11px] text-[#93b0b4] mt-1")}>
                {goalSub}
              </p>
            )}
          </>
        ) : best != null ? (
          <>
            <p className={LABEL_CLASS}>Best</p>
            <CardValue value={String(best.value)} unit={unit} />
            <p className={cn(MONO, "text-[11px] text-[#93b0b4] mt-1")}>
              on {formatShortDate(best.date)}
            </p>
          </>
        ) : (
          <>
            <p className={LABEL_CLASS}>Goal</p>
            <DashValue />
          </>
        )}
      </CardShell>
    </div>
  );
}
