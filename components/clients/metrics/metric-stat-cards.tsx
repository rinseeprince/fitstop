"use client";

import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  MONO,
} from "@/components/clients/training/program-builder/builder-tokens";
import { TextSkeleton } from "@/components/text-skeleton";
import { WINDOW_DAYS, type WindowComparison } from "@/utils/metric-derived-stats";
import { containsDigit, formatShortDate, formatSigned, TONE_TEXT } from "./metrics-format";
import type { CardThree, CardThreeKind, GoalCard, MetricSummary } from "./metrics-view-types";
import type { TrendDirection } from "@/types/check-in";

// Three white cards under the hero, each with one label and one window for
// every client: the last 7 days' and the last 30 days' averages of the entries
// dated in a window ending the client's today, each against the window before
// it — on a wellness score, an average needs three entries — and card 3, fixed
// per metric (D31). Anatomy copied from exercise-kpi-strip.tsx; the change is
// toned by the metric's good direction (TONE_TEXT), not hardcoded teal.

type MetricStatCardsProps = {
  metric: MetricSummary;
};

const TREND_ICON: Record<TrendDirection, typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
};

// Sub-lines: number-bearing = mono, word-only = sans (the dynamic-slot rule).
const SUB_MONO_CLASS = cn(MONO, "mt-1 text-[11px] text-[#93b0b4]");
const SUB_SANS_CLASS = "mt-1 text-[11px] text-[#93b0b4]";
// TextSkeleton's own fill is the dark bands'; these cards are white.
const PENDING_FILL = "bg-[rgba(13,148,136,0.08)]";

function CardShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] px-[14px] py-[16px]">
      {children}
    </div>
  );
}

function CardValue({ value, unit }: { value: ReactNode; unit?: string }) {
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

/** An average card's heading: what the big number is, over which days. */
const averageLabel = (days: number) => `Last ${days} days avg`;

/** The change, arrow first, against the same span before. A flex line, as
 *  exercise-kpi-strip's: an icon inside inline text sets the text's baseline. */
function ChangeLine({
  change,
  days,
}: {
  change: NonNullable<WindowComparison["change"]>;
  days: number;
}) {
  const TrendIcon = TREND_ICON[change.trend];
  return (
    <p className={cn(SUB_MONO_CLASS, "flex flex-wrap items-center gap-x-1")}>
      <TrendIcon strokeWidth={1.5} className={cn("h-3 w-3 shrink-0", TONE_TEXT[change.tone])} />
      <span className={cn("font-medium", TONE_TEXT[change.tone])}>{formatSigned(change.amount)}</span>
      <span>vs the previous {days} days</span>
    </p>
  );
}

/** Cards 1 and 2, and card 3 on a girth: a window's average against the window before it. */
function WindowCard({ comparison, unit }: { comparison: WindowComparison; unit: string }) {
  const { days, current, change } = comparison;
  return (
    <CardShell>
      <p className={LABEL_CLASS}>{averageLabel(days)}</p>
      {current == null ? (
        <>
          <DashValue />
          <p className={SUB_SANS_CLASS}>Not enough entries</p>
        </>
      ) : (
        <>
          <CardValue value={current.toFixed(1)} unit={unit} />
          {change ? (
            <ChangeLine change={change} days={days} />
          ) : (
            <p className={SUB_SANS_CLASS}>Not enough entries in the previous {days} days</p>
          )}
        </>
      )}
    </CardShell>
  );
}

/** Card 3's label, one per kind — the same before its figure lands and after. */
const CARD_THREE_LABEL: Record<CardThreeKind, string> = {
  goal: "Goal",
  lowest: `Lowest in ${WINDOW_DAYS.month} days`,
  highest: `Highest in ${WINDOW_DAYS.month} days`,
  last90: averageLabel(WINDOW_DAYS.girth),
};

/** Weight and body fat: the target in force on the client's today, and how far the newest reading is from it. */
function GoalCardView({ goal, unit }: { goal: GoalCard; unit: string }) {
  return (
    <CardShell>
      <p className={LABEL_CLASS}>{CARD_THREE_LABEL.goal}</p>
      {goal.status === "pending" ? (
        <>
          <CardValue value={<TextSkeleton className={cn("w-14", PENDING_FILL)} />} />
          <p className={SUB_MONO_CLASS}>
            <TextSkeleton className={cn("w-20", PENDING_FILL)} />
          </p>
        </>
      ) : goal.status === "set" ? (
        <>
          <CardValue value={goal.target.toFixed(1)} unit={unit} />
          {goal.progress && (
            // "Goal reached" is words; "1.2 kg to go" carries its number.
            <p className={containsDigit(goal.progress.text) ? SUB_MONO_CLASS : SUB_SANS_CLASS}>
              {goal.progress.text}
            </p>
          )}
        </>
      ) : (
        <>
          <DashValue />
          <p className={SUB_SANS_CLASS}>
            {goal.status === "failed" ? "Couldn't load the goal" : "No target"}
          </p>
        </>
      )}
    </CardShell>
  );
}

/** A wellness score: its worst of the last 30 days, and the day it was logged. */
function WorstCard({
  card,
  unit,
}: {
  card: Extract<CardThree, { kind: "lowest" | "highest" }>;
  unit: string;
}) {
  return (
    <CardShell>
      <p className={LABEL_CLASS}>{CARD_THREE_LABEL[card.kind]}</p>
      {card.worst ? (
        <>
          <CardValue value={String(card.worst.value)} unit={unit} />
          <p className={SUB_MONO_CLASS}>on {formatShortDate(card.worst.date)}</p>
        </>
      ) : (
        <>
          <DashValue />
          <p className={SUB_SANS_CLASS}>No entries in the last {WINDOW_DAYS.month} days</p>
        </>
      )}
    </CardShell>
  );
}

function CardThreeView({ card, unit }: { card: CardThree; unit: string }) {
  if (card.kind === "goal") return <GoalCardView goal={card.goal} unit={unit} />;
  if (card.kind === "last90") return <WindowCard comparison={card.comparison} unit={unit} />;
  return <WorstCard card={card} unit={unit} />;
}

export function MetricStatCards({ metric }: MetricStatCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-[10px]">
      <WindowCard comparison={metric.lastWeek} unit={metric.unit} />
      <WindowCard comparison={metric.lastMonth} unit={metric.unit} />
      <CardThreeView card={metric.cardThree} unit={metric.unit} />
    </div>
  );
}

/**
 * The cards before the series lands: the same cards, labels and elements,
 * pending text inside them, so a card keeps its size when its figures arrive.
 * Card 3's label is known from the metric alone.
 */
export function MetricStatCardsPending({ cardThree }: { cardThree: CardThreeKind }) {
  const labels = [
    averageLabel(WINDOW_DAYS.week),
    averageLabel(WINDOW_DAYS.month),
    CARD_THREE_LABEL[cardThree],
  ];
  return (
    <div className="grid grid-cols-3 gap-[10px]">
      {labels.map((label) => (
        <CardShell key={label}>
          <p className={LABEL_CLASS}>{label}</p>
          <CardValue value={<TextSkeleton className={cn("w-14", PENDING_FILL)} />} />
          <p className={SUB_MONO_CLASS}>
            <TextSkeleton className={cn("w-32", PENDING_FILL)} />
          </p>
        </CardShell>
      ))}
    </div>
  );
}
