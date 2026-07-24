"use client";

import { useState, useMemo, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import {
  eligibleDatesIn,
  monthDatesWhere,
  weekContaining,
} from "@/utils/nutrition-calendar-selection";
import {
  resolveSelectedEvents,
  averageDisplayedCalories,
  type RangeEditPayload,
} from "@/utils/nutrition-range-edit-model";
import type { NutritionEvent } from "@/types/check-in";

type UseNutritionCalendarEditingArgs = {
  clientId: string;
  eventsByDate: Map<string, NutritionEvent>;
  weeks: string[][];
  clientToday: string;
  viewMonth: { year: number; month: number };
  /** Activity-burn toggle — resolution mirrors the day cells' displayed numbers. */
  includeActivityBurn: boolean;
  surplusAsCarbs: boolean;
  onUpdate: () => void;
};

/**
 * Edit-mode state + the range-edit / reset mutations for the nutrition calendar
 * (Session 4 ◆2). Selection is a Set of dates toggled by clicking — single,
 * scattered, or contiguous are all built the same way. Mutations post a `dates[]`
 * payload (plain same-origin fetch; CSRF is origin-based) so a scattered
 * selection edits exactly the chosen days and leaves the gaps untouched.
 */
export function useNutritionCalendarEditing({
  clientId,
  eventsByDate,
  weeks,
  clientToday,
  viewMonth,
  includeActivityBurn,
  surplusAsCarbs,
  onUpdate,
}: UseNutritionCalendarEditingArgs) {
  const { toast } = useToast();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const toggleDay = useCallback((date: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  /** Selection-bar quick groups REPLACE the selection outright. */
  const replaceSelection = useCallback((dates: string[]) => {
    if (dates.length === 0) return;
    setSelected(new Set(dates));
  }, []);

  const todayWeek = useMemo(() => weekContaining(weeks, clientToday), [weeks, clientToday]);

  // Quick-group date sets for the selection bar. `week` is null when today's
  // week isn't in the current view (the chip hides).
  const groups = useMemo(
    () => ({
      week: todayWeek ? eligibleDatesIn(todayWeek, eventsByDate, clientToday) : null,
      train: monthDatesWhere(weeks, viewMonth.month, viewMonth.year, eventsByDate, clientToday, (e) => e.isTrainingDay),
      rest: monthDatesWhere(weeks, viewMonth.month, viewMonth.year, eventsByDate, clientToday, (e) => !e.isTrainingDay),
    }),
    [todayWeek, weeks, viewMonth, eventsByDate, clientToday]
  );

  const exitEdit = useCallback(() => {
    setEditMode(false);
    setSelected(new Set());
  }, []);

  // Week-rail "Edit this week": replace the selection with the week's eligible
  // days, then open the sheet (menu semantics are "act on this week", not add-to).
  const selectDatesAndEdit = useCallback((dates: string[]) => {
    if (dates.length === 0) return;
    setSelected(new Set(dates));
    setSheetOpen(true);
  }, []);

  // The selection resolved against loaded events — what the bar average, the
  // Revert affordance, and the sheet's seeding all read from. Dates outside the
  // loaded window stay selected but contribute nothing.
  const resolvedSelected = useMemo(
    () => resolveSelectedEvents(selected, eventsByDate, includeActivityBurn, surplusAsCarbs),
    [selected, eventsByDate, includeActivityBurn, surplusAsCarbs]
  );
  const averageCalories = useMemo(
    () => averageDisplayedCalories(resolvedSelected),
    [resolvedSelected]
  );
  const modifiedSelected = useMemo(
    () => resolvedSelected.filter((d) => d.event.isModified).map((d) => d.date),
    [resolvedSelected]
  );

  const applyEdit = useCallback(
    async (payload: RangeEditPayload) => {
      // Write ONLY the dates the sheet could resolve and show. A selection can
      // outlive its month window (nothing prunes it on nav), and writing an
      // unresolvable date would apply values — and single-day note semantics —
      // the coach never saw.
      const dates = resolvedSelected.map((d) => d.date);
      if (dates.length === 0) return;
      setIsSaving(true);
      try {
        const res = await fetch(`/api/clients/${clientId}/nutrition/events/range`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dates, ...payload }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to edit days");
        const n = data.updated ?? dates.length;
        toast({
          title: `Updated ${n} day${n === 1 ? "" : "s"}`,
          description: describeEdit(payload),
        });
        setSheetOpen(false);
        setSelected(new Set());
        await invalidateNutritionCalendar(clientId);
        onUpdate();
      } catch (e) {
        toast({
          title: "Edit failed",
          description: e instanceof Error ? e.message : "Failed to edit days",
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    },
    [resolvedSelected, clientId, invalidateNutritionCalendar, onUpdate, toast]
  );

  const resetDates = useCallback(
    async (dates: string[]) => {
      if (dates.length === 0) return;
      setIsSaving(true);
      try {
        const res = await fetch(`/api/clients/${clientId}/nutrition/events/reset`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dates }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to reset days");
        const n = data.reset ?? dates.length;
        toast({ title: `Reset ${n} day${n === 1 ? "" : "s"}` });
        // Deselect only the reset dates so a hand-picked selection elsewhere
        // survives (week-rail reset / Revert to auto leave the rest standing).
        const affected = new Set(dates);
        setSelected((prev) => new Set([...prev].filter((d) => !affected.has(d))));
        await invalidateNutritionCalendar(clientId);
        onUpdate();
      } catch (e) {
        toast({
          title: "Reset failed",
          description: e instanceof Error ? e.message : "Failed to reset days",
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    },
    [clientId, invalidateNutritionCalendar, onUpdate, toast]
  );

  /** Selection bar "Revert to auto": reset only the frozen days in the selection. */
  const revertModified = useCallback(
    () => resetDates(modifiedSelected),
    [resetDates, modifiedSelected]
  );

  return {
    editMode,
    setEditMode,
    exitEdit,
    selected,
    toggleDay,
    clearSelection,
    replaceSelection,
    groups,
    selectDatesAndEdit,
    resolvedSelected,
    averageCalories,
    modifiedSelected,
    sheetOpen,
    setSheetOpen,
    isSaving,
    applyEdit,
    resetDates,
    revertModified,
  };
}

/** One short sans fragment for the success toast, naming what was applied. */
function describeEdit(payload: RangeEditPayload): string | undefined {
  if (payload.mode === "absolute") {
    return `Set to ${payload.calories.toLocaleString()} kcal`;
  }
  if (payload.percent != null) {
    return `Adjusted by ${payload.percent > 0 ? "+" : ""}${payload.percent}%`;
  }
  if (payload.calorieDelta != null) {
    return `Adjusted by ${payload.calorieDelta > 0 ? "+" : ""}${payload.calorieDelta} kcal`;
  }
  return undefined;
}
