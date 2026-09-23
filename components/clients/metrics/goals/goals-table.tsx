"use client";

import { Fragment, useState } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { RowActions } from "@/components/programs/shared/row-actions";
import {
  FOCUS_RING,
  MONO,
  MONO_CELL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { containsDigit, formatSigned } from "../metrics-format";
import { formatHistoryDate } from "@/lib/date-helpers";
import { goalTypeBesideName } from "@/lib/goals/goal-types";
import type { GoalChipTone } from "@/lib/goals/goal-chip";
import type { GoalResultLine } from "@/lib/goals/goal-result";
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import type { GoalHistoryRow } from "@/types/client-goals";
import { GoalLines } from "./goal-lines";

/**
 * The Journey's goals table: a row per goal, planned first — its name, its
 * dates, its deadline, its targets, the weight it ended at (today's goal: the
 * newest) and its result — each opening onto what
 * happened during it. Which rows are open is local: a row is a disclosure,
 * not a place, and a click opens or closes it in one update.
 */

// The goal card's two tones, on white (docs/newdesignsystem.md → Badges & chips).
const CHIP = "inline-block rounded-[4px] px-1.5 py-px text-[11px] font-medium";
const TONE: Record<GoalChipTone | "neutral", string> = {
  positive: "bg-[rgba(13,148,136,0.08)] text-[#0d9488]",
  warning: "bg-[rgba(245,158,11,0.07)] text-[#d97706]",
  neutral: "bg-[#f0f5f4] text-[#5a7d82]",
};

const Dash = () => <span className="text-[#c2d0cc]">—</span>;

// One height for a target and its result, so a goal's two targets line up
// with their two results across the row.
const LINE = "flex h-5 items-center";

function Chip({ text, tone }: { text: string; tone: GoalChipTone | "neutral" }) {
  return <span className={cn(CHIP, TONE[tone], containsDigit(text) && MONO)}>{text}</span>;
}

/** Its start and last day; a goal no goal follows yet runs on from its start. */
function Dates({ row }: { row: GoalHistoryRow }) {
  if (row.endsOn) {
    return (
      <span className={cn(MONO_CELL_CLASS, TEXT_SECONDARY)}>
        {formatHistoryDate(row.startsOn)} – {formatHistoryDate(row.endsOn)}
      </span>
    );
  }
  return (
    <span className={cn("text-[12.5px]", TEXT_MUTED)}>
      {row.status === "planned" ? "From" : "Since"}
      <span className={cn(MONO_CELL_CLASS, TEXT_SECONDARY, "ml-[1ch]")}>{formatHistoryDate(row.startsOn)}</span>
    </span>
  );
}

function Targets({ row, viewer }: { row: GoalHistoryRow; viewer: UnitSystem }) {
  const targets: string[] = [];
  if (row.targetWeight !== null) {
    const shown = formatWeight(row.targetWeight, viewer);
    targets.push(`${shown.value.toFixed(1)} ${shown.unit}`);
  }
  if (row.targetBodyFatPercentage !== null) targets.push(`${row.targetBodyFatPercentage.toFixed(1)}%`);
  if (targets.length === 0) return <Dash />;
  return (
    <div className="flex flex-col gap-1">
      {targets.map((target) => (
        <span key={target} className={cn(LINE, MONO_CELL_CLASS, TEXT_PRIMARY)}>
          {target}
        </span>
      ))}
    </div>
  );
}

function ResultLine({ line, weightUnit }: { line: GoalResultLine; weightUnit: string }) {
  switch (line.kind) {
    case "verdict":
      return <Chip text={line.text} tone={line.tone} />;
    case "planned":
      return <Chip text="Planned" tone="neutral" />;
    case "change":
      return (
        <span className={cn("text-[12.5px]", TEXT_MUTED)}>
          Weight
          <span className={cn(MONO_CELL_CLASS, TEXT_PRIMARY, "ml-[1ch]")}>
            {formatSigned(line.amount)} {weightUnit}
          </span>
        </span>
      );
    case "noReading":
      return <span className={cn("text-[12.5px]", TEXT_MUTED)}>No reading</span>;
  }
}

function Result({
  lines,
  failed,
  weightUnit,
}: {
  lines: GoalResultLine[] | null;
  failed: boolean;
  weightUnit: string;
}) {
  if (lines === null) {
    // Worked out from the readings: unresolved is never shown as a result.
    return failed ? (
      <span className={cn("text-[12.5px]", TEXT_MUTED)}>Couldn&apos;t load the readings</span>
    ) : (
      <Skeleton className="h-4 w-24" />
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {lines.map((line, i) => (
        <div key={i} className={LINE}>
          <ResultLine line={line} weightUnit={weightUnit} />
        </div>
      ))}
    </div>
  );
}

/** A row's figures from the readings: its result and the weight it ended at, or today's. */
export type GoalRowFigures = { lines: GoalResultLine[]; weight: number | null };

function Weight({ figures, failed, unit }: { figures: GoalRowFigures | null; failed: boolean; unit: string }) {
  if (figures === null) return failed ? <Dash /> : <Skeleton className="h-4 w-16" />;
  if (figures.weight === null) return <Dash />;
  return (
    <span className={cn(MONO_CELL_CLASS, TEXT_PRIMARY)}>
      {figures.weight.toFixed(1)} {unit}
    </span>
  );
}

const COLUMNS = 7;

function GoalsTableHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead>Goal</TableHead>
        <TableHead>Dates</TableHead>
        <TableHead>Deadline</TableHead>
        <TableHead>Target</TableHead>
        <TableHead>Weight</TableHead>
        <TableHead>Result</TableHead>
        <TableHead>
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

export function GoalsTable({
  rows,
  resultOf,
  resultsFailed,
  viewer,
  onDelete,
}: {
  rows: GoalHistoryRow[];
  /** A row's figures; null while the readings they are worked out from load. */
  resultOf: (row: GoalHistoryRow) => GoalRowFigures | null;
  resultsFailed: boolean;
  viewer: UnitSystem;
  onDelete: (row: GoalHistoryRow) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const weightUnit = formatWeight(0, viewer).unit;

  return (
    <Table>
      <GoalsTableHeader />
      <TableBody>
        {rows.map((row) => {
          const isOpen = open.has(row.id);
          const figures = resultOf(row);
          const type = goalTypeBesideName(row.type, row.name);
          return (
            <Fragment key={row.id}>
              <TableRow className="group/row cursor-pointer" onClick={() => toggle(row.id)}>
                <TableCell>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(row.id);
                    }}
                    className={cn("flex items-start gap-1.5 rounded-[4px] text-left", FOCUS_RING)}
                  >
                    <ChevronRight
                      className={cn(
                        "mt-[3px] h-3.5 w-3.5 shrink-0 text-[#93b0b4] transition-transform duration-200",
                        isOpen && "rotate-90"
                      )}
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-[#0c1a1e]">{row.name}</span>
                        {row.status === "current" && <Chip text="Current" tone="positive" />}
                      </span>
                      {type && <span className="mt-0.5 block text-xs text-[#93b0b4]">{type}</span>}
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <Dates row={row} />
                </TableCell>
                <TableCell>
                  {row.deadline ? (
                    <span className={cn(MONO_CELL_CLASS, TEXT_SECONDARY)}>{formatHistoryDate(row.deadline)}</span>
                  ) : (
                    <Dash />
                  )}
                </TableCell>
                <TableCell>
                  <Targets row={row} viewer={viewer} />
                </TableCell>
                <TableCell>
                  <Weight figures={figures} failed={resultsFailed} unit={weightUnit} />
                </TableCell>
                <TableCell>
                  <Result lines={figures?.lines ?? null} failed={resultsFailed} weightUnit={weightUnit} />
                </TableCell>
                <TableCell>
                  <RowActions
                    actions={[{ label: `Delete ${row.name}`, icon: Trash2, onClick: () => onDelete(row), danger: true }]}
                  />
                </TableCell>
              </TableRow>
              {isOpen && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMNS} className="whitespace-normal">
                    {/* Under the goal's name, past its chevron. */}
                    <div className="pb-1 pl-5">
                      <GoalLines lines={row.lines} type={row.type} viewer={viewer} />
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The table's shape while the goals load — its headings and a few rows, nothing claimed. */
export function GoalsTableSkeleton() {
  return (
    <Table aria-hidden>
      <GoalsTableHeader />
      <TableBody>
        {Array.from({ length: 3 }).map((_, i) => (
          <TableRow key={i} className="hover:bg-transparent">
            <TableCell>
              <Skeleton className="h-4 w-32" />
            </TableCell>
            {Array.from({ length: COLUMNS - 2 }).map((_, cell) => (
              <TableCell key={cell}>
                <Skeleton className="h-4 w-20" />
              </TableCell>
            ))}
            <TableCell />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
