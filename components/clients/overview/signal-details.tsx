"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { getWellnessTone, type WellnessMetric } from "@/utils/wellness-color-thresholds";
import {
  LABEL_CLASS,
  MONO,
  MONO_META_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { WellnessSparkline } from "./wellness-sparkline";
import { formatDayInitial, pluralize } from "./overview-format";
import type { AlertType, AttentionAlert } from "@/types/attention-feed";
import type { AdherenceSummary, DotState, HabitBreakdown } from "@/types/coach-overview";
import type { DailyLog } from "@/types/daily-log";

// The four expanded panels behind the Signals rows. Each answers the one
// question its row's percentage cannot: WHICH days, WHICH habit, HOW FAR off
// the target — never a second summary of the same number.

/** Above this window the day strip wraps into weeks rather than shrinking. */
const WEEK_GRID_ABOVE_DAYS = 21;

const DOT_CLASS: Record<Exclude<DotState, "none">, string> = {
  complete: "bg-[#0d9488]",
  partial: "bg-[rgba(13,148,136,0.40)]",
  missed: "bg-[#d97706]",
  no_log: "bg-[rgba(13,148,136,0.12)]",
};

function PanelLabel({ children }: { children: string }) {
  return <p className={cn(LABEL_CLASS, "mb-2")}>{children}</p>;
}

/** A recessed cell — the panel's echo of the white card's StatStrip. */
function DetailCell({
  label,
  value,
  unit,
  sub,
  subIsNumeric = true,
  children,
}: {
  label: string;
  value: string | null;
  unit?: string;
  sub?: string;
  subIsNumeric?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-[6px] bg-[#f0f5f4] px-3 py-2.5">
      <p className={LABEL_CLASS}>{label}</p>
      <p className="mt-1">
        {value === null ? (
          <span className="text-[15px] font-semibold text-[#93b0b4]">—</span>
        ) : (
          <>
            <span className={cn(MONO, "text-[15px] font-semibold text-[#0c1a1e]")}>{value}</span>
            {unit && <span className="ml-1 text-[10px] text-[#93b0b4]">{unit}</span>}
          </>
        )}
      </p>
      {children}
      {sub && (
        <p
          className={cn(
            "mt-1 truncate text-[11px]",
            subIsNumeric ? MONO_META_CLASS : "text-[#93b0b4]"
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

/**
 * Session-by-session, aligned by day of week.
 *
 * Above three weeks it becomes a weeks x weekdays grid rather than one long
 * strip: at 60 days a single row is 60 slivers under eight repeats of the
 * weekday labels, and the one thing the labels buy — seeing that a client
 * always misses Fridays — is exactly what the column alignment preserves. One
 * label row serves every week.
 *
 * The `none` state is a DASH, not a dot: no session was planned that day.
 * Rendering it as a missed dot turns every rest day into a failure.
 */
export function TrainingDetail({
  dates,
  rail,
}: {
  dates: string[];
  rail: DotState[];
}) {
  const asGrid = dates.length > WEEK_GRID_ABOVE_DAYS;

  // Pad the head so column 0 is always the same weekday, whatever day the
  // window happens to start on — the alignment is the whole point.
  const leadingBlanks = asGrid
    ? new Date(`${dates[0]}T00:00:00`).getDay()
    : 0;
  const cells: ({ date: string; state: DotState } | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...dates.map((date, i) => ({ date, state: rail[i] ?? "no_log" })),
  ];

  const columns = asGrid ? 7 : dates.length;
  const labelDates = asGrid ? cells.slice(0, 7) : cells;

  return (
    <div>
      <PanelLabel>Session by session</PanelLabel>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {cells.map((cell, i) =>
          cell === null ? (
            <span key={`pad-${i}`} aria-hidden />
          ) : (
            <span key={cell.date} className="flex h-4 items-center justify-center">
              {cell.state === "none" ? (
                <span className="block h-px w-2 bg-[rgba(13,148,136,0.20)]" aria-hidden />
              ) : (
                <span
                  className={cn("h-2 w-2 rounded-full", DOT_CLASS[cell.state])}
                  aria-hidden
                />
              )}
            </span>
          )
        )}
      </div>
      {/* One weekday row for the whole grid, under the first week. */}
      <div
        className="mt-1 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {labelDates.map((cell, i) => (
          <span
            key={cell ? `label-${cell.date}` : `label-pad-${i}`}
            className="text-center text-[9px] leading-none text-[#c2d0cc]"
          >
            {cell ? formatDayInitial(cell.date) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * What the client ate against what they were asked for.
 *
 * The day count is `calories.days`, NOT `loggedDays`, and it is stated rather
 * than assumed: `nutrition_logs` snapshots the target per row, so a day logged
 * before a plan existed carries a null target and is excluded from BOTH means.
 * An average intake over nine days set beside an average target over six would
 * be a comparison of two different fortnights.
 */
export function NutritionDetail({
  nutrition,
}: {
  nutrition: AdherenceSummary["nutrition"];
}) {
  const { calories, protein, onTarget, loggedDays } = nutrition;

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <DetailCell
        label="Days logged"
        value={String(loggedDays)}
        sub={`${onTarget} on target`}
      />
      <DetailCell
        label="Avg calories"
        value={calories ? String(calories.actual) : null}
        unit="cal"
        sub={
          calories
            ? `target ${calories.target} · over ${pluralize(calories.days, "day")}`
            : "No day carried both an intake and a target"
        }
        subIsNumeric={calories !== null}
      />
      <DetailCell
        label="Avg protein"
        value={protein ? String(protein.actual) : null}
        unit="g"
        sub={
          protein
            ? `target ${protein.target}g · over ${pluralize(protein.days, "day")}`
            : "No day carried both an intake and a target"
        }
        subIsNumeric={protein !== null}
      />
      <DetailCell
        label="On target"
        value={String(onTarget)}
        unit={onTarget === 1 ? "day" : "days"}
        sub={`of ${pluralize(loggedDays, "day")} logged`}
      />
    </div>
  );
}

/** A habit's completion trend: one mark per eligible day, oldest → newest. */
function HabitTrend({ rail }: { rail: (boolean | null)[] }) {
  const eligible = rail.filter((day): day is boolean => day !== null);
  if (eligible.length === 0) return null;

  return (
    <div className="mt-1.5 flex gap-px" aria-hidden>
      {eligible.map((done, i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 min-w-px flex-1 rounded-[1px]",
            done ? "bg-[#0d9488]" : "bg-[rgba(13,148,136,0.12)]"
          )}
        />
      ))}
    </div>
  );
}

/**
 * Every ACTIVE habit, including the ones with nothing logged.
 *
 * `perHabit` comes off the adherence read rather than `/habits/logs` precisely
 * so a habit at 0% still appears: log rows exist only where the client acted,
 * so a logs-derived grid drops the habit that most needs looking at.
 */
export function HabitsDetail({ perHabit }: { perHabit: HabitBreakdown[] }) {
  if (perHabit.length === 0) {
    return (
      <p className="text-[12px] text-[#93b0b4]">No habits are active for this client.</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
      {perHabit.map((habit) => (
        <DetailCell
          key={habit.id}
          label={habit.name}
          value={habit.pct === null ? null : String(habit.pct)}
          unit={habit.pct === null ? undefined : "%"}
          sub={
            habit.pct === null
              ? "Added after this window"
              : `${habit.completedDays} of ${pluralize(habit.eligibleDays, "day")}`
          }
          subIsNumeric={habit.pct !== null}
        >
          <HabitTrend rail={habit.rail} />
        </DetailCell>
      ))}
    </div>
  );
}

type WellnessMetricSpec = {
  metric: WellnessMetric;
  name: string;
  field: "mood" | "energy" | "sleep" | "stress" | "soreness";
  domain: [number, number];
  /** The trigger that flags this metric, and the word it flags with. */
  alert: { type: AlertType; word: string } | null;
};

// Sleep is deliberately absent from the alert column: no trigger evaluates it
// (lib/wellness-triggers.ts), so its card can never flag. Do not invent one.
export const WELLNESS_METRICS: WellnessMetricSpec[] = [
  { metric: "mood", name: "Mood", field: "mood", domain: [1, 5], alert: { type: "mood_drop", word: "Low" } },
  { metric: "energy", name: "Energy", field: "energy", domain: [1, 10], alert: { type: "energy_drop", word: "Low" } },
  { metric: "sleep", name: "Sleep quality", field: "sleep", domain: [1, 10], alert: null },
  { metric: "stress", name: "Stress", field: "stress", domain: [1, 10], alert: { type: "high_stress", word: "High" } },
  { metric: "soreness", name: "Soreness", field: "soreness", domain: [1, 10], alert: { type: "high_soreness", word: "High" } },
];

/** Affected-day counts per trigger, so a flagged metric can say how long. */
export function flagDaysByType(alerts: AttentionAlert[]): Map<AlertType, number> {
  const map = new Map<AlertType, number>();
  for (const alert of alerts) {
    map.set(alert.type, Math.max(map.get(alert.type) ?? 0, alert.affectedDays.length || 1));
  }
  return map;
}

function WellnessMetricCard({
  spec,
  points,
  flagDays,
}: {
  spec: WellnessMetricSpec;
  points: (number | null)[];
  flagDays: number | null;
}) {
  const values = points.filter((value): value is number => value !== null);
  const latest = [...points].reverse().find((value): value is number => value !== null) ?? null;
  const tone = getWellnessTone(spec.metric, latest);

  return (
    <div className="rounded-[6px] bg-[#f0f5f4] px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className={LABEL_CLASS}>{spec.name}</span>
        {flagDays !== null && spec.alert && (
          // The chip is the ALERT, not a statistic about this panel: the
          // trigger counts affected days over its own fixed window while the
          // figures below follow the selected one. "Flagged" says which it is,
          // so the two windows cannot read as one disagreeing number.
          <span className="shrink-0 rounded-[4px] bg-[rgba(245,158,11,0.07)] px-1.5 py-px text-[9px] font-medium text-[#d97706]">
            Flagged: {spec.alert.word.toLowerCase()} for{" "}
            <span className={MONO}>{pluralize(flagDays, "day")}</span>
          </span>
        )}
      </div>

      <p className="mt-1">
        {latest === null ? (
          <span className="text-[15px] font-semibold text-[#93b0b4]">—</span>
        ) : (
          <>
            <span className={cn(MONO, "text-[15px] font-semibold text-[#0c1a1e]")}>{latest}</span>
            <span className="ml-0.5 text-[10px] text-[#93b0b4]">/{spec.domain[1]}</span>
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
    </div>
  );
}

export function WellnessDetail({
  logs,
  dates,
  attentionAlerts,
}: {
  logs: DailyLog[];
  dates: string[];
  attentionAlerts: AttentionAlert[];
}) {
  const byDate = useMemo(() => new Map(logs.map((log) => [log.date, log])), [logs]);
  const flags = useMemo(() => flagDaysByType(attentionAlerts), [attentionAlerts]);

  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-5">
      {WELLNESS_METRICS.map((spec) => (
        <WellnessMetricCard
          key={spec.metric}
          spec={spec}
          points={dates.map((date) => byDate.get(date)?.[spec.field] ?? null)}
          flagDays={spec.alert ? (flags.get(spec.alert.type) ?? null) : null}
        />
      ))}
    </div>
  );
}
