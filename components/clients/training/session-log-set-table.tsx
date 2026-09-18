"use client";

import { Check } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  MONO,
  MONO_CELL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { SetType } from "@/utils/exercise-set-specs";
import type { LoggedSetRow } from "@/utils/logged-set-rows";
import type { LoggedBox } from "@/utils/set-log-measures";
import { boxHeader, formatBoxActual, formatBoxTarget } from "@/utils/measure-readout";
import {
  boxGap,
  restGap,
  restTarget,
  rpeWellAbove,
  type TargetGap,
} from "@/utils/target-gap";
import { formatRestDuration, type ExerciseGroupPlace } from "@/utils/exercise-group-display";
import type { UnitSystem } from "@/utils/unit-conversions";

// The coach's target-over-actual table (owner, 2026-09-18): one column per
// measure, each cell the coach's target over what the client did — "100–105 kg"
// over "102.5", "5" over "4", "5 km" over "5.02 km" — so a strength exercise is
// Set, Load, Reps, RPE and a run is Set, Distance, Duration, Pace. A value
// outside its target reads amber, below as well as above; an RPE two or more
// above keeps its red; a % load is never marked, because a percentage can't be
// compared with the kilograms lifted; a tempo that differs reads amber
// (utils/target-gap.ts, the judgement the check-in AI's lines name too). A
// warm-up is shown and never scored, so its values are muted and never marked.
//
// When the columns don't fit, the table scrolls sideways inside its card while
// the Set column stays put.

/**
 * Every non-working set names its type in full. Working sets are untagged: they
 * are the default, and a tag on every row is noise.
 *
 * The word, not an initial. `W` / `D` / `A` read as a code a coach has to learn,
 * and this table is where an unfamiliar set type most needs explaining. The
 * client's grid keeps its letters on a phone's width, which is also RN's call.
 *
 * Colours are the design system's own (docs/newdesignsystem.md): warning for a
 * warm-up, the teal chip for drop/AMRAP, destructive-soft for failure. The
 * client tracker has a twin of this map; it is not shared because the two sit on
 * opposite sides of the coach/client audience split (CONVENTIONS §6) and the
 * client's copy is web-harness code on the RN-replacement path.
 */
const TYPE_TAG: Record<SetType, { word: string; title: string; className: string } | null> = {
  warmup: {
    word: "Warm-up",
    title: "Warm-up — recorded but never scored",
    className: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
  },
  drop: {
    word: "Drop",
    title: "Drop set",
    className: "bg-[rgba(13,148,136,0.08)] text-[#0a5c55]",
  },
  amrap: {
    word: "AMRAP",
    title: "As many reps as possible",
    className: "bg-[rgba(13,148,136,0.08)] text-[#0a5c55]",
  },
  failure: {
    word: "Failure",
    title: "Taken to failure",
    className: "bg-[rgba(192,96,96,0.08)] text-[#c06060]",
  },
  working: null,
};

function SetTypeTag({ setType }: { setType: SetType }) {
  const tag = TYPE_TAG[setType];
  if (!tag) return null;
  return (
    <span
      title={tag.title}
      className={cn(
        "whitespace-nowrap rounded-[4px] px-1.5 text-[10px] font-semibold leading-[16px]",
        tag.className,
      )}
    >
      {tag.word}
    </span>
  );
}

/** A value outside its target: the design system's warning amber. */
const OUTSIDE_TONE = "text-[#d97706]";
/** An RPE two or more above its target keeps the red it has always had. */
const WELL_ABOVE_TONE = "font-semibold text-[#c06060]";

const GAP_WORDS: Record<TargetGap, string> = {
  above: "Above target",
  below: "Below target",
  differs: "Differs from target",
};

// The Set column stays put while the measures scroll under it: sticky against
// the table's scrolling container, opaque so nothing shows through, and on a
// row's hover the opaque twin of the row's 3% teal wash — a pinned cell can't be
// see-through, so it can't take the translucent wash itself.
const PINNED_CELL = "sticky left-0 z-[1] bg-white";
const PINNED_ROW_HOVER = "group-hover/row:bg-[#f8fcfb]";

/** The tick's slot plus the gap after it: the Set heading starts where the numbers do. */
const TICK_SLOT = "w-3.5";
const SET_HEADING_INDENT = "pl-[22px]";

const Dash = () => <span className="text-[#c2d0cc]">—</span>;

/** One measure of one set: the coach's target over what the client did. */
function TargetOverActual({
  target,
  actual,
  tone,
  gap,
}: {
  target: string | null;
  actual: string | null;
  tone: string;
  gap: TargetGap | null;
}) {
  return (
    <TableCell className="last:pr-4">
      <span className={cn(MONO, "block text-[11px] leading-[14px]", TEXT_MUTED)}>
        {/* A held line (a non-breaking space), so every value in the row sits
            on one baseline whether its column has a target or not. */}
        {target ?? " "}
      </span>
      <span
        className={cn(MONO_CELL_CLASS, "block leading-[18px]", actual == null ? undefined : tone)}
        title={gap ? GAP_WORDS[gap] : undefined}
      >
        {actual ?? <Dash />}
        {gap && <span className="sr-only">, {GAP_WORDS[gap].toLowerCase()}</span>}
      </span>
    </TableCell>
  );
}

type SessionLogSetTableProps = {
  rows: LoggedSetRow[];
  /** The exercise's columns (`loggedColumns`): its boxes in order, and whether rest was recorded. */
  columns: { boxes: LoggedBox[]; rest: boolean };
  place: Readonly<ExerciseGroupPlace>;
  /** The exercise's own rest is a set's target: its Rest column is on and its rows aren't rounds. */
  ownRestApplies: boolean;
  viewer: UnitSystem;
};

export function SessionLogSetTable({
  rows,
  columns,
  place,
  ownRestApplies,
  viewer,
}: SessionLogSetTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={cn(PINNED_CELL, "w-[132px] pl-4")}>
            <span className={SET_HEADING_INDENT}>{place.roundsAreRows ? "Round" : "Set"}</span>
          </TableHead>
          {columns.boxes.map((box) => (
            <TableHead key={box} className="last:pr-4">
              {boxHeader(box, viewer)}
            </TableHead>
          ))}
          {columns.rest && <TableHead className="last:pr-4">Rest</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => {
          const done = row.actual !== null;
          // A warm-up is recorded but never scored, so it must not read as
          // performance: muted values, a muted tick, and never marked.
          const isWarmup = row.prescribed?.setType === "warmup";
          const toneFor = (gap: TargetGap | null, wellAbove = false) =>
            isWarmup ? TEXT_MUTED : wellAbove ? WELL_ABOVE_TONE : gap ? OUTSIDE_TONE : TEXT_PRIMARY;
          const rest = restTarget(row.prescribed, ownRestApplies);
          const restTaken = row.actual?.restSeconds ?? null;
          const restOff = isWarmup ? null : restGap(rest, restTaken);

          return (
            <TableRow key={index} data-testid="logged-set-row" className="group/row">
              <TableCell className={cn(PINNED_CELL, PINNED_ROW_HOVER, "w-[132px] pl-4")}>
                <span className="flex items-center gap-2">
                  <span className={cn("flex shrink-0 justify-center", TICK_SLOT)}>
                    {done && (
                      <Check
                        className={cn("h-3.5 w-3.5", isWarmup ? TEXT_MUTED : "text-[#0d9488]")}
                        strokeWidth={1.5}
                        aria-hidden
                      />
                    )}
                  </span>
                  <span className="sr-only">{done ? "Logged" : "Not done"}</span>
                  <span className="flex items-center gap-1" data-testid="logged-set-number">
                    <span className={cn(MONO_CELL_CLASS, TEXT_SECONDARY)}>
                      {/* A drop shares its top set's number, so repeating it
                          would read as a duplicate — the tag identifies it. */}
                      {row.prescribed?.dropIndex != null ? "" : row.displayNumber}
                    </span>
                    {row.prescribed && <SetTypeTag setType={row.prescribed.setType} />}
                  </span>
                </span>
              </TableCell>
              {columns.boxes.map((box) => {
                const gap = isWarmup ? null : boxGap(box, row.prescribed, row.actual, viewer);
                const wellAbove = box === "rpe" && rpeWellAbove(row.prescribed, row.actual);
                return (
                  <TargetOverActual
                    key={box}
                    target={formatBoxTarget(box, row.prescribed, viewer)}
                    actual={formatBoxActual(box, row.actual, viewer)}
                    tone={toneFor(gap, wellAbove)}
                    gap={gap}
                  />
                );
              })}
              {columns.rest && (
                <TargetOverActual
                  target={rest == null ? null : formatRestDuration(rest)}
                  actual={restTaken == null ? null : formatRestDuration(restTaken)}
                  tone={toneFor(restOff)}
                  gap={restOff}
                />
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
