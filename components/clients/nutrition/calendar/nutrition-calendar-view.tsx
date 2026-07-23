"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useNutritionCalendarEvents } from "@/hooks/use-nutrition-calendar-events";
import { useNutritionCalendarEditing } from "@/hooks/use-nutrition-calendar-editing";
import { NutritionCalendarWeekRow } from "./nutrition-calendar-week-row";
import { NutritionCalendarEditBar } from "./nutrition-calendar-edit-bar";
import { NutritionCalendarToolbar } from "./nutrition-calendar-toolbar";
import { NutritionRangeEditDialog } from "./nutrition-range-edit-dialog";
import {
  getTodayDateString,
  getTodayDateStringInTimezone,
  getDateString,
} from "@/lib/date-helpers";
import { cn } from "@/lib/utils";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { format } from "date-fns";
import type { Phase, PhaseStatus } from "@/types/roadmap";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Returns the Monday on or before the given date (local time). */
function mondayOnOrBefore(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay(); // 0 = Sun
  const offset = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + offset);
  return result;
}

/** Returns the Sunday on or after the given date (local time). */
function sundayOnOrAfter(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay();
  const offset = day === 0 ? 0 : 7 - day;
  result.setDate(result.getDate() + offset);
  return result;
}

function buildWeeks(gridStart: Date, gridEnd: Date): string[][] {
  const weeks: string[][] = [];
  const current = new Date(gridStart);
  while (current <= gridEnd) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(getDateString(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

type NutritionCalendarViewProps = {
  clientId: string;
  phases: Phase[];
  clientTimezone?: string;
  /** Activity-burn toggle, so calendar totals match the rest of the builder. */
  includeActivityBurn: boolean;
  /** How a training-day surplus distributes across macros. */
  surplusAsCarbs: boolean;
  /** Refetch the surrounding builder (stat band) after an edit. */
  onUpdate: () => void;
  /** Renders the toolbar's Delete-plan trigger when provided. */
  onDeletePlan?: () => void;
};

export function NutritionCalendarView({
  clientId,
  phases,
  clientTimezone,
  includeActivityBurn,
  surplusAsCarbs,
  onUpdate,
  onDeletePlan,
}: NutritionCalendarViewProps) {
  const todayDate = getTodayDateString();
  // Past/future display + edit gating is judged on the CLIENT's calendar so it
  // agrees with the server's getClientTodayString guards; the visual today ring
  // stays on the coach's device (todayDate). 'UTC' is the never-synced sentinel
  // -> fall back to device today (NOT getTodayDateStringInTimezone('UTC')).
  const clientToday =
    clientTimezone && clientTimezone !== "UTC"
      ? getTodayDateStringInTimezone(clientTimezone)
      : todayDate;

  const todayRowRef = useRef<HTMLDivElement>(null);

  const [viewMonth, setViewMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });

  const { weeks, startDate, endDate } = useMemo(() => {
    const firstOfMonth = new Date(viewMonth.year, viewMonth.month, 1);
    const lastOfMonth = new Date(viewMonth.year, viewMonth.month + 1, 0);
    const gs = mondayOnOrBefore(firstOfMonth);
    const ge = sundayOnOrAfter(lastOfMonth);
    return {
      weeks: buildWeeks(gs, ge),
      startDate: getDateString(gs),
      endDate: getDateString(ge),
    };
  }, [viewMonth]);

  const { eventsByDate, isLoading } = useNutritionCalendarEvents(
    clientId,
    startDate,
    endDate
  );

  const edit = useNutritionCalendarEditing({
    clientId,
    eventsByDate,
    weeks,
    clientToday,
    viewMonth,
    includeActivityBurn,
    surplusAsCarbs,
    onUpdate,
  });

  const phaseByDate = useMemo(() => {
    const map = new Map<string, PhaseStatus>();
    if (phases.length === 0) return map;
    const phasesSorted = [...phases].sort((a, b) =>
      (a.startDate ?? "").localeCompare(b.startDate ?? "")
    );
    for (const week of weeks) {
      for (const date of week) {
        for (const phase of phasesSorted) {
          const start = phase.startDate;
          const end = phase.endDate;
          if (start && end && date >= start && date <= end) {
            map.set(date, phase.status);
            break;
          }
        }
      }
    }
    return map;
  }, [phases, weeks]);

  useEffect(() => {
    const viewingCurrentMonth =
      new Date().getFullYear() === viewMonth.year &&
      new Date().getMonth() === viewMonth.month;
    if (viewingCurrentMonth && todayRowRef.current) {
      todayRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isLoading, viewMonth]);

  const monthLabel = format(new Date(viewMonth.year, viewMonth.month, 1), "MMMM yyyy");
  const goPrevMonth = () =>
    setViewMonth(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
    );
  const goNextMonth = () =>
    setViewMonth(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
    );
  const goToday = () => {
    const today = new Date();
    setViewMonth({ year: today.getFullYear(), month: today.getMonth() });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* The control line IS the divider: month nav left, hairline middle,
          pencil/check + delete-plan icons right (training-calendar pattern). */}
      <NutritionCalendarToolbar
        monthLabel={monthLabel}
        onPrevMonth={goPrevMonth}
        onNextMonth={goNextMonth}
        onToday={goToday}
        isLoading={isLoading}
        editMode={edit.editMode}
        onEditModeChange={(next) => (next ? edit.setEditMode(true) : edit.exitEdit())}
        onDeletePlan={onDeletePlan}
      />

      <div className="flex flex-col gap-2 rounded-[6px] border border-[rgba(13,148,136,0.06)] bg-white p-4">
        {/* Selection bar */}
        {edit.editMode && (
          <NutritionCalendarEditBar
            todayWeekAvailable={!!edit.todayWeek}
            selectedCount={edit.selected.size}
            isSaving={edit.isSaving}
            onSelectThisWeek={edit.selectThisWeek}
            onSelectThisMonth={edit.selectThisMonth}
            onEdit={() => edit.setDialogOpen(true)}
            onReset={edit.resetSelected}
            onClear={edit.clearSelection}
          />
        )}

        {/* Day headers */}
        <div className="flex gap-1">
          <div className="flex-1 grid grid-cols-7 gap-1">
            {DAY_LABELS.map((label) => (
              <div
                key={label}
                className={cn(LABEL_CLASS, "text-center py-1")}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Week rows */}
        <div className="flex flex-col gap-1 max-h-[600px] overflow-y-auto">
          {weeks.map((days) => {
            const containsToday = days.includes(todayDate);
            return (
              <div key={days[0]} ref={containsToday ? todayRowRef : undefined}>
                <NutritionCalendarWeekRow
                  days={days}
                  eventsByDate={eventsByDate}
                  todayDate={todayDate}
                  clientToday={clientToday}
                  viewMonth={viewMonth.month}
                  viewYear={viewMonth.year}
                  phaseByDate={phaseByDate}
                  includeActivityBurn={includeActivityBurn}
                  surplusAsCarbs={surplusAsCarbs}
                  editMode={edit.editMode}
                  selected={edit.selected}
                  onToggle={edit.toggleDay}
                />
              </div>
            );
          })}
        </div>
      </div>

      <NutritionRangeEditDialog
        open={edit.dialogOpen}
        onOpenChange={edit.setDialogOpen}
        dayCount={edit.selected.size}
        dietType={edit.dietType}
        defaultCalories={edit.defaultCalories}
        defaultProtein={edit.defaultProtein}
        defaultCarbs={edit.defaultCarbs}
        defaultFat={edit.defaultFat}
        defaultNote={edit.defaultNote}
        isSaving={edit.isSaving}
        onApply={edit.applyEdit}
      />
    </div>
  );
}
