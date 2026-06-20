"use client";

import { useState, useMemo, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  eligibleDatesIn,
  thisMonthDates,
  weekContaining,
} from "@/utils/nutrition-calendar-selection";
import { mapNutritionEventToDisplayTarget } from "@/utils/nutrition-event-helpers";
import type { RangeEditPayload } from "@/components/clients/nutrition/calendar/nutrition-range-edit-dialog";
import type { NutritionEvent, DietType } from "@/types/check-in";

type UseNutritionCalendarEditingArgs = {
  clientId: string;
  eventsByDate: Map<string, NutritionEvent>;
  weeks: string[][];
  clientToday: string;
  viewMonth: { year: number; month: number };
  /** Activity-burn toggle — seeds the modal with the day's displayed numbers. */
  includeActivityBurn: boolean;
  surplusAsCarbs: boolean;
  mutate: () => Promise<unknown>;
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
  mutate,
  onUpdate,
}: UseNutritionCalendarEditingArgs) {
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const toggleDay = useCallback((date: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }, []);

  const addDates = useCallback((dates: string[]) => {
    if (dates.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of dates) next.add(d);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const todayWeek = useMemo(() => weekContaining(weeks, clientToday), [weeks, clientToday]);

  const selectThisWeek = useCallback(() => {
    if (todayWeek) addDates(eligibleDatesIn(todayWeek, eventsByDate, clientToday));
  }, [todayWeek, eventsByDate, clientToday, addDates]);

  const selectThisMonth = useCallback(() => {
    addDates(thisMonthDates(weeks, viewMonth.month, viewMonth.year, eventsByDate, clientToday));
  }, [weeks, viewMonth, eventsByDate, clientToday, addDates]);

  const exitEdit = useCallback(() => {
    setEditMode(false);
    setSelected(new Set());
  }, []);

  // The first selected day's CURRENT displayed values seed the modal (so the coach
  // edits from real, already-consistent numbers). Uses the same display helper as
  // the calendar so seed == what the cell shows.
  const firstSelectedEvent = useMemo(() => {
    const first = [...selected].sort()[0];
    return first ? eventsByDate.get(first) : null;
  }, [selected, eventsByDate]);
  const seedTarget = firstSelectedEvent
    ? mapNutritionEventToDisplayTarget(firstSelectedEvent, includeActivityBurn, surplusAsCarbs)
    : null;
  const dietType = (firstSelectedEvent?.dietType as DietType) || "balanced";
  const defaultCalories = seedTarget?.calories ?? 0;
  const defaultProtein = seedTarget?.proteinG ?? 0;
  const defaultCarbs = seedTarget?.carbsG ?? 0;
  const defaultFat = seedTarget?.fatG ?? 0;
  // The note lives on the event, not the display target — seed it from there.
  const defaultNote = firstSelectedEvent?.note ?? null;

  const applyEdit = useCallback(
    async (payload: RangeEditPayload) => {
      const dates = [...selected];
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
        toast({ title: `Updated ${n} day${n === 1 ? "" : "s"}` });
        setDialogOpen(false);
        setSelected(new Set());
        await mutate();
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
    [selected, clientId, mutate, onUpdate, toast]
  );

  const resetSelected = useCallback(async () => {
    const dates = [...selected];
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
      setSelected(new Set());
      await mutate();
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
  }, [selected, clientId, mutate, onUpdate, toast]);

  return {
    editMode,
    setEditMode,
    exitEdit,
    selected,
    toggleDay,
    clearSelection,
    todayWeek,
    selectThisWeek,
    selectThisMonth,
    dialogOpen,
    setDialogOpen,
    isSaving,
    dietType,
    defaultCalories,
    defaultProtein,
    defaultCarbs,
    defaultFat,
    defaultNote,
    applyEdit,
    resetSelected,
  };
}
