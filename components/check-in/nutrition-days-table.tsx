"use client";

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
import type { NutritionDay, NutritionDayStatus } from "@/types/schedule";
import { dayLabel } from "./day-label";

// The week the check-in froze, one line per day, in the design system's
// target-over-actual readout (docs/newdesignsystem.md → "Target over actual"),
// the grammar the coach already reads in a logged workout: one column per
// figure, each cell the day's target over what the client ate, the unit named
// once in its heading. A day no target covered keeps a blank target line so
// every eaten figure sits on one baseline; nothing eaten is a faint dash. No
// figure is marked: the day's word is the verdict, and there is one.

// The day's word and its colour, from the standing the check-in froze at Send
// and never re-judged from the row's numbers. One meaning per colour, the
// adherence rail's rule (components/clients/overview/adherence-card.tsx): teal
// on target, amber partial, rose missed, the faint tint for a targeted day with
// no food log; nothing to judge wears no colour. "No food logged" rather than
// "Not logged" because the header chip counts days with ANY log and this table
// counts food, and the two sit on one screen.
const DAY_STANDING: Record<NutritionDayStatus, { label: string; pill: string }> = {
  hit: { label: "On target", pill: "bg-[rgba(13,148,136,0.08)] text-[#0d9488]" },
  partial: { label: "Partial", pill: "bg-[rgba(245,158,11,0.07)] text-[#d97706]" },
  missed: { label: "Missed", pill: "bg-[rgba(192,96,96,0.08)] text-[#c06060]" },
  not_logged: { label: "No food logged", pill: "bg-[rgba(13,148,136,0.04)] text-[#93b0b4]" },
  no_target: { label: "No target", pill: "text-[#93b0b4]" },
};

const COLUMNS = [
  { heading: "Kcal", target: "targetCalories", eaten: "actualCalories" },
  { heading: "Protein (g)", target: "targetProteinG", eaten: "actualProteinG" },
  { heading: "Carbs (g)", target: "targetCarbsG", eaten: "actualCarbsG" },
  { heading: "Fats (g)", target: "targetFatG", eaten: "actualFatG" },
] as const;

// The Day column stays put while the figures scroll under it on a narrow card:
// sticky against the table's own scrolling container, opaque, and on a row's
// hover the opaque twin of the row's 3% teal wash (the logged-workout table's
// pinned Set column).
const PINNED_CELL = "sticky left-0 z-[1] bg-white";
const PINNED_ROW_HOVER = "group-hover/row:bg-[#f8fcfb]";

/** "Sun 20": the page's header names the week, so the day of the month is enough. */
const dayOfMonth = (date: string) => `${dayLabel(date)} ${Number(date.slice(8, 10))}`;

function TargetOverEaten({ target, eaten }: { target: number | null; eaten: number | null }) {
  return (
    <TableCell>
      <span className={cn(MONO, "block text-[11px] leading-[14px]", TEXT_MUTED)}>
        {/* A held line (a non-breaking space) where no target covered the day. */}
        {target == null ? " " : target.toLocaleString()}
      </span>
      <span className={cn(MONO_CELL_CLASS, "block leading-[18px]", TEXT_PRIMARY)}>
        {eaten == null ? <span className="text-[#c2d0cc]">—</span> : eaten.toLocaleString()}
      </span>
    </TableCell>
  );
}

/** The week day by day, as the check-in froze it, in the copy's order. */
export function NutritionDaysTable({ days }: { days: NutritionDay[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={cn(PINNED_CELL, "pl-0")}>Day</TableHead>
          {COLUMNS.map((column) => (
            <TableHead key={column.heading}>{column.heading}</TableHead>
          ))}
          <TableHead className="pr-0">
            <span className="sr-only">How the day went</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.map((day) => {
          const standing = DAY_STANDING[day.status];
          return (
            <TableRow key={day.date} data-testid="nutrition-day-row" className="group/row">
              <TableCell className={cn(PINNED_CELL, PINNED_ROW_HOVER, "pl-0", MONO_CELL_CLASS, TEXT_SECONDARY)}>
                {dayOfMonth(day.date)}
              </TableCell>
              {COLUMNS.map((column) => (
                <TargetOverEaten key={column.heading} target={day[column.target]} eaten={day[column.eaten]} />
              ))}
              <TableCell className="pr-0 text-right">
                <span
                  className={cn(
                    "inline-flex items-center rounded-[4px] px-2 py-0.5 text-[11px] font-medium",
                    standing.pill
                  )}
                >
                  {standing.label}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
