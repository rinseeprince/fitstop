"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { getWellnessTone, type WellnessMetric } from "@/utils/wellness-color-thresholds";
import {
  MONO,
  MONO_META_CLASS,
  TRAINING_CARD_BORDER,
} from "@/components/clients/training/program-builder/builder-tokens";
import { WellnessSparkline } from "./wellness-sparkline";
import { pluralize } from "./overview-format";
import type { AlertType, AttentionAlert } from "@/types/attention-feed";
import type { DailyLog } from "@/types/daily-log";

/**
 * The wellness cards' window, matching the adherence rails above them so both
 * consistency surfaces describe the same fortnight.
 *
 * It was 7 while the rails were 14, which meant two sections stacked together
 * answered "how has this client been" over two different periods and only the
 * rail metas said so.
 */
export const WELLNESS_WINDOW_DAYS = 14;

type WellnessCardsProps = {
  /** Daily logs covering (at least) the trailing window, any order. */
  logs: DailyLog[];
  /** The trailing window's dates, oldest → newest. */
  dates: string[];
  attentionAlerts: AttentionAlert[];
  isLoading: boolean;
  onOpenWellness: () => void;
};

type MetricSpec = {
  metric: WellnessMetric;
  name: string;
  field: "mood" | "energy" | "sleep" | "stress" | "soreness";
  domain: [number, number];
  /** The trigger that flags this metric, and the word it flags with. */
  alert: { type: AlertType; word: string } | null;
};

// Sleep is deliberately absent from the alert column: no trigger evaluates it
// (lib/wellness-triggers.ts), so its card can never flag. Do not invent one.
const METRICS: MetricSpec[] = [
  { metric: "mood", name: "Mood", field: "mood", domain: [1, 5], alert: { type: "mood_drop", word: "Low" } },
  { metric: "energy", name: "Energy", field: "energy", domain: [1, 10], alert: { type: "energy_drop", word: "Low" } },
  { metric: "sleep", name: "Sleep quality", field: "sleep", domain: [1, 10], alert: null },
  { metric: "stress", name: "Stress", field: "stress", domain: [1, 10], alert: { type: "high_stress", word: "High" } },
  { metric: "soreness", name: "Soreness", field: "soreness", domain: [1, 10], alert: { type: "high_soreness", word: "High" } },
];

function scaleSuffix(domain: [number, number]): string {
  return `/${domain[1]}`;
}

function MetricCard({
  spec,
  points,
  flagDays,
  onOpenWellness,
}: {
  spec: MetricSpec;
  points: (number | null)[];
  flagDays: number | null;
  onOpenWellness: () => void;
}) {
  const values = points.filter((value): value is number => value !== null);
  const latest = [...points].reverse().find((value): value is number => value !== null) ?? null;
  const tone = getWellnessTone(spec.metric, latest);
  const isFlagged = flagDays !== null;

  return (
    <button
      type="button"
      onClick={onOpenWellness}
      className={cn(
        "flex flex-col rounded-[6px] bg-white p-3.5 text-left transition-all hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
        isFlagged ? "border border-[rgba(245,158,11,0.35)]" : TRAINING_CARD_BORDER
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-semibold text-[#0c1a1e]">{spec.name}</span>
        {isFlagged && spec.alert && (
          <span className="shrink-0 rounded-[4px] bg-[rgba(245,158,11,0.07)] px-1.5 py-0.5 text-[9px] font-medium text-[#d97706]">
            {spec.alert.word} ·{" "}
            <span className={MONO}>{pluralize(flagDays, "day")}</span>
          </span>
        )}
      </div>

      <p className="mt-1.5">
        {latest === null ? (
          <span className="text-[22px] font-semibold text-[#93b0b4]">—</span>
        ) : (
          <>
            <span className={cn(MONO, "text-[22px] font-semibold text-[#0c1a1e]")}>{latest}</span>
            <span className="ml-0.5 text-[11px] text-[#93b0b4]">{scaleSuffix(spec.domain)}</span>
          </>
        )}
      </p>

      <div className="mt-1.5">
        <WellnessSparkline points={points} domain={spec.domain} tone={tone} />
      </div>

      {values.length > 0 ? (
        <p className={cn(MONO_META_CLASS, "mt-1.5 text-[10px]")}>
          min {Math.min(...values)} · avg{" "}
          {(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)} · max{" "}
          {Math.max(...values)}
        </p>
      ) : (
        <p className="mt-1.5 text-[10px] text-[#93b0b4]">Not logged in this window</p>
      )}
    </button>
  );
}

export function WellnessCards({
  logs,
  dates,
  attentionAlerts,
  isLoading,
  onOpenWellness,
}: WellnessCardsProps) {
  const byDate = useMemo(() => new Map(logs.map((log) => [log.date, log])), [logs]);

  // Affected-day counts per trigger, so each card can say how long it has run.
  const flagDaysByType = useMemo(() => {
    const map = new Map<AlertType, number>();
    for (const alert of attentionAlerts) {
      map.set(alert.type, Math.max(map.get(alert.type) ?? 0, alert.affectedDays.length || 1));
    }
    return map;
  }, [attentionAlerts]);

  const cards = METRICS.map((spec) => ({
    spec,
    points: dates.map((date) => byDate.get(date)?.[spec.field] ?? null),
    flagDays: spec.alert ? (flagDaysByType.get(spec.alert.type) ?? null) : null,
  }));

  const flaggedCount = cards.filter((card) => card.flagDays !== null).length;
  const meta = `Last ${WELLNESS_WINDOW_DAYS} days`;

  return (
    <div>
      <SectionLabel
        label="Daily wellness"
        meta={meta}
        actions={
          flaggedCount > 0 ? (
            <span
              className={cn(
                MONO,
                "shrink-0 rounded-[6px] bg-[rgba(245,158,11,0.07)] px-1.5 py-0.5 text-[10px] font-semibold text-[#d97706]"
              )}
            >
              {flaggedCount}
            </span>
          ) : undefined
        }
      />

      {/* The section's rung of the Overview's entrance ladder. It sits on a
          wrapper that is always mounted rather than on the cards, because the
          skeleton and the loaded grid are different nodes: on the cards, the
          entrance would replay whenever the read settled. The five cards keep
          their own bordered, hover-lifting button treatment — they are
          interactive, unlike the passive OverviewCards above them. */}
      <div className="animate-card-in" style={{ animationDelay: "0.18s" }}>
        {isLoading && logs.length === 0 ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {METRICS.map((spec) => (
              <Skeleton key={spec.metric} className="h-[132px] rounded-[6px]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {cards.map((card) => (
              <MetricCard
                key={card.spec.metric}
                spec={card.spec}
                points={card.points}
                flagDays={card.flagDays}
                onOpenWellness={onOpenWellness}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
