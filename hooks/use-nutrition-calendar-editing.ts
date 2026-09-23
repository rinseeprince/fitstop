"use client";

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import {
  eligibleDatesIn,
  monthDatesWhere,
  weekContaining,
} from "@/utils/nutrition-calendar-selection";
import {
  resolveSelectedEvents,
  averageDisplayedCalories,
  type RangeEditPayload,
  type ResolvedSelectedDay,
} from "@/utils/nutrition-range-edit-model";
import type { NutritionEvent } from "@/types/check-in";

type UseNutritionCalendarEditingArgs = {
  clientId: string;
  eventsByDate: Map<string, NutritionEvent>;
  weeks: string[][];
  clientToday: string;
  viewMonth: { year: number; month: number };
  onUpdate: () => void;
};

/**
 * Edit-mode state + the range-edit / reset mutations for the nutrition calendar
 * (Session 4 ◆2). Selection is a Set of dates toggled by clicking — single,
 * scattered, or contiguous are all built the same way. Mutations post a `dates[]`
 * payload (plain same-origin fetch; CSRF is origin-based) so a scattered
 * selection edits exactly the chosen days and leaves the gaps untouched. The
 * edit is the editor's macro balancer: one target, the same four numbers for
 * every selected day.
 */
export function useNutritionCalendarEditing({
  clientId,
  eventsByDate,
  weeks,
  clientToday,
  viewMonth,
  onUpdate,
}: UseNutritionCalendarEditingArgs) {
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The editor's subject is the days it opened on, resolved at the open: the
  // dialog shows them and an Apply writes them, so a refetch while it is open
  // cannot make the two disagree. A close leaves them — a successful apply
  // clears the selection in the commit that closes, and Radix re-renders the
  // closing card from live props (CONVENTIONS §7 → "No frame disagrees").
  const editor = useDialogSubject<ResolvedSelectedDay[]>();
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
  // days, then open the editor on them (menu semantics are "act on this week",
  // not add-to) — one update.
  const { show: showEditor, close: closeEditor } = editor;
  const selectDatesAndEdit = useCallback(
    (dates: string[]) => {
      if (dates.length === 0) return;
      setSelected(new Set(dates));
      showEditor(resolveSelectedEvents(dates, eventsByDate));
    },
    [showEditor, eventsByDate]
  );

  // The selection resolved against loaded events — what the bar average, the
  // Revert affordance, and the editor's opening all read from. Dates outside the
  // loaded window stay selected but contribute nothing.
  const resolvedSelected = useMemo(
    () => resolveSelectedEvents(selected, eventsByDate),
    [selected, eventsByDate]
  );
  // The selection bar's "Edit targets": the editor opens on the selection as
  // resolved now.
  const openEditor = useCallback(() => showEditor(resolvedSelected), [showEditor, resolvedSelected]);
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
      // Write ONLY the dates the editor resolved and shows — its subject. A
      // selection can outlive its month window (nothing prunes it on nav), and
      // writing an unresolvable date would apply values — and single-day note
      // semantics — the coach never saw.
      const dates = (editor.subject ?? []).map((d) => d.date);
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
        toast.success(`Updated ${n} day${n === 1 ? "" : "s"}`, {
          description: describeEdit(payload),
        });
        closeEditor();
        setSelected(new Set());
        await invalidateNutritionCalendar(clientId);
        void clearClientOverview(clientId);
        void clearAttentionFeed();
        onUpdate();
      } catch (e) {
        toast.error("Edit failed", {
          description: e instanceof Error ? e.message : "Failed to edit days",
        });
      } finally {
        setIsSaving(false);
      }
    },
    [editor.subject, closeEditor, clientId, invalidateNutritionCalendar, clearClientOverview, clearAttentionFeed, onUpdate]
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
        toast.success(`Reset ${n} day${n === 1 ? "" : "s"}`);
        // Deselect only the reset dates so a hand-picked selection elsewhere
        // survives (week-rail reset / Revert to auto leave the rest standing).
        const affected = new Set(dates);
        setSelected((prev) => new Set([...prev].filter((d) => !affected.has(d))));
        await invalidateNutritionCalendar(clientId);
        void clearClientOverview(clientId);
        void clearAttentionFeed();
        onUpdate();
      } catch (e) {
        toast.error("Reset failed", {
          description: e instanceof Error ? e.message : "Failed to reset days",
        });
      } finally {
        setIsSaving(false);
      }
    },
    [clientId, invalidateNutritionCalendar, clearClientOverview, clearAttentionFeed, onUpdate]
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
    editorOpen: editor.open,
    editorDays: editor.subject ?? [],
    openEditor,
    closeEditor,
    isSaving,
    applyEdit,
    resetDates,
    revertModified,
  };
}

/** One short sans fragment for the success toast, naming what was applied. */
function describeEdit(payload: RangeEditPayload): string {
  return `Set to ${payload.calories.toLocaleString()} kcal`;
}
