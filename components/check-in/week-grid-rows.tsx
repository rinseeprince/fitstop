"use client";

import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  MONO,
  MONO_CELL_CLASS,
  MONO_LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trainingAdherenceStatus } from "@/lib/training-adherence";
import type { CheckInTrainingEventDetail } from "@/types/check-in";
import type { NutritionDay } from "@/types/schedule";
import { DAY_STANDING, MACRO_MARK, SESSIONS_SHOWN, TARGET_TICK, WORKOUT_STATUS, macroMark } from "./week-grid-words";

export const Dash = () => <span className="text-[#c2d0cc]">—</span>;

/** One workout: its status icon, its name, and its word where it went short. */
function SessionLine({ workout }: { workout: CheckInTrainingEventDetail }) {
  const status = WORKOUT_STATUS[trainingAdherenceStatus(workout)];
  const Icon = status.icon;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", status.tone)} strokeWidth={1.5} aria-hidden />
      <span className="truncate text-[13px] text-[#0c1a1e]">{workout.performedSessionName ?? workout.sessionName}</span>
      {status.wordShown ? (
        <span className={cn("shrink-0 text-[11px] font-medium", status.tone)}>{status.label}</span>
      ) : (
        <span className="sr-only">{status.label}</span>
      )}
    </span>
  );
}

/** A day's workouts: the first two, and the rest behind "+N more" in the calendar's 320px list. */
export function TrainingCell({ date, workouts }: { date: string; workouts: CheckInTrainingEventDetail[] }) {
  if (workouts.length === 0) return <Dash />;
  const hidden = workouts.length - SESSIONS_SHOWN;
  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      {workouts.slice(0, SESSIONS_SHOWN).map((workout) => (
        <SessionLine key={workout.eventId} workout={workout} />
      ))}
      {hidden > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                MONO_LABEL_CLASS,
                "self-start rounded px-0.5 normal-case tracking-normal text-[#93b0b4] transition-colors hover:text-[#0d9488]",
                FOCUS_RING
              )}
            >
              +{hidden} more
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-[320px] rounded-[6px] border-[rgba(13,148,136,0.08)] p-0">
            <div className="px-3.5 pb-2 pt-3">
              <p className={cn(MONO, "text-sm font-semibold text-[#0c1a1e]")}>
                {format(new Date(`${date}T12:00:00`), "EEEE, MMM d")}
              </p>
              <p className={MONO_LABEL_CLASS}>{workouts.length} sessions</p>
            </div>
            <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto px-3.5 pb-3">
              {workouts.map((workout) => (
                <SessionLine key={workout.eventId} workout={workout} />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** "eaten / target", the target muted; the target alone after a dash with no food, the eaten alone with no target. */
export function EatenOverTarget({ eaten, target, strong }: { eaten: string | null; target: string | null; strong?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <span className={cn(MONO_CELL_CLASS, strong && "font-semibold", TEXT_PRIMARY)}>{eaten ?? <Dash />}</span>
      {target != null && <span className={cn(MONO_CELL_CLASS, TEXT_MUTED)}> / {target}</span>}
    </span>
  );
}

/**
 * A day's calories: eaten over its own target, and a bar on the week's one
 * scale with a tick at the day's target — a training day's surplus moves its
 * tick. No bar with no food; a grey bar and no tick with no target.
 */
export function CaloriesCell({ day, scale }: { day: NutritionDay; scale: number }) {
  const width = (value: number) => `${Math.min(value / scale, 1) * 100}%`;
  const standing = DAY_STANDING[day.status];
  return (
    <span className="flex items-center gap-4">
      <span className="w-[112px] shrink-0">
        <EatenOverTarget
          eaten={day.actualCalories == null ? null : day.actualCalories.toLocaleString()}
          target={day.targetCalories == null ? null : day.targetCalories.toLocaleString()}
          strong
        />
      </span>
      <span className="relative h-1.5 min-w-[96px] flex-1 rounded-full bg-[rgba(13,148,136,0.08)]" aria-hidden>
        {day.actualCalories != null && (
          <span className={cn("absolute inset-y-0 left-0 rounded-full", standing.bar)} style={{ width: width(day.actualCalories) }} />
        )}
        {day.targetCalories != null && (
          <span
            className={cn("absolute top-1/2 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full", TARGET_TICK)}
            style={{ left: width(day.targetCalories) }}
          />
        )}
      </span>
    </span>
  );
}

/** A macro's grams over its own target, the eaten figure tinted 10% or more off it. */
export function MacroCell({ eaten, target, strong }: { eaten: number | null; target: number | null; strong?: boolean }) {
  const mark = macroMark(eaten, target);
  return (
    <span className="whitespace-nowrap">
      {eaten == null ? (
        <Dash />
      ) : (
        <span
          title={mark ? MACRO_MARK[mark].words : undefined}
          className={cn(
            MONO_CELL_CLASS,
            "rounded-[4px]",
            mark ? cn("px-1.5 py-0.5", MACRO_MARK[mark].tint) : TEXT_PRIMARY,
            strong && "font-semibold"
          )}
        >
          {eaten}
          {mark && <span className="sr-only">, {MACRO_MARK[mark].words}</span>}
        </span>
      )}
      {target != null && <span className={cn(MONO_CELL_CLASS, TEXT_MUTED)}> / {target}</span>}
    </span>
  );
}

/** The day's word as the check-in froze it, behind its dot. */
export function StandingCell({ day }: { day: NutritionDay }) {
  const standing = DAY_STANDING[day.status];
  return (
    <span className="flex items-center gap-2">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", standing.dot)} aria-hidden />
      <span className={cn("text-[13px] font-medium", standing.text)}>{standing.label}</span>
    </span>
  );
}

