"use client";

import { useState, useMemo, useCallback } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { calendarCollisionDetection } from "./calendar-collision";
import { useCalendarEvents, useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useClearBlockFacts } from "@/components/clients/metrics/hooks/use-client-blocks";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { useCalendarDnd } from "@/hooks/use-calendar-dnd";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { CalendarGrid } from "./calendar-grid";
import { CalendarToolbar } from "./calendar-toolbar";
import { CalendarEventCard } from "./calendar-event-card";
import { ClearWeekDialog, DeleteEventDialog } from "./delete-event-dialog";
import { PlacedSessionEditor } from "./placed-session-editor";
import type { PlacedSessionState } from "./use-placed-session-editor";
import { LibraryPanel } from "./library-panel";
import { ApplyToClientDialog } from "@/components/training-library/apply-to-client-dialog";
import { toast } from "sonner";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { getTodayDateString, getTodayDateStringInTimezone, getDateString } from "@/lib/date-helpers";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { WeekAction } from "./calendar-week-rail";
import type { TrainingPlan, TrainingEvent } from "@/types/training";

type TrainingCalendarViewProps = {
  clientId: string;
  plan: TrainingPlan | null;
  /** The plan read has no answer yet. What depends on the plan — the
   *  Delete-plan trigger, the week actions, a library session drop — stays on
   *  screen and does nothing until it answers. */
  planPending?: boolean;
  editMode: boolean;
  clientTimezone?: string;
  /** For the apply dialog's sentence under its date field. */
  clientName?: string;
  onUpdate: () => void;
  /** Renders the toolbar's View/Edit segmented control when provided. */
  onEditModeChange?: (editMode: boolean) => void;
  /** Renders the Schedule divider's Delete-future trigger when provided. */
  onDeleteFuture?: () => void;
};

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

export function TrainingCalendarView({
  clientId,
  plan,
  planPending = false,
  editMode,
  clientTimezone,
  onUpdate,
  onEditModeChange,
  onDeleteFuture,
}: TrainingCalendarViewProps) {
  const todayDate = getTodayDateString();
  // Gating (can I drag/delete this event?) is judged on the CLIENT's calendar so
  // it agrees with the 7.82 server guards; the visual today ring stays on the
  // coach's device (todayDate). 'UTC' is the never-synced sentinel → fall back to
  // device today, matching the apply-dialog min and getClientTodayString's coach-tz
  // fallback (NOT getTodayDateStringInTimezone('UTC'), which would be UTC today).
  const clientToday =
    clientTimezone && clientTimezone !== "UTC"
      ? getTodayDateStringInTimezone(clientTimezone)
      : todayDate;

  // Month nav state — defaults to the current month
  const [viewMonth, setViewMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });

  // State. Each overlay keeps its subject apart from `open`: a close flips
  // `open` only, so a closing card still renders what it showed — Radix
  // re-renders it from live state (CONVENTIONS §7 → "No frame disagrees").
  const {
    subject: selectedSession,
    open: sessionTrayOpen,
    show: showSessionTray,
    close: closeSessionTray,
  } = useDialogSubject<PlacedSessionState>();
  const [isWeekActionLoading, setIsWeekActionLoading] = useState(false);
  const {
    subject: pendingClearWeek,
    open: clearWeekOpen,
    show: showClearWeek,
    close: closeClearWeek,
  } = useDialogSubject<string>();
  const {
    subject: deleteTarget,
    open: deleteOpen,
    show: showDelete,
    close: closeDelete,
  } = useDialogSubject<TrainingEvent>();
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [applyFromDrop, setApplyFromDrop] = useState<{ planId: string; startDate: string } | null>(null);

  // Compute grid range for the viewed month
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

  // Fetch events across all plans for this range
  const { events, eventsByDate, isLoading, mutate } = useCalendarEvents(clientId, startDate, endDate);

  // Every write below refreshes the whole training AREA, not just this
  // calendar's month window: the plan editor reads the same rows through its
  // own read, and a bound `mutate` cannot reach it.
  const invalidateTrainingData = useInvalidateTrainingData();

  // A nutrition day is computed from the session on it (calorie targets track
  // the training layout) and the month view is SWR-cached, so every success
  // path below must also invalidate the nutrition calendar's cache.
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const clearBlockFacts = useClearBlockFacts();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();

  // Saved plans for apply-from-drop dialog
  const { plans: savedPlans } = useSavedPlans();

  // DnD with library drop handlers
  const dnd = useCalendarDnd({
    events,
    clientId,
    clientToday,
    mutate,
    onLibraryPlanDrop: (libraryPlanId, targetStartDate) => {
      setApplyFromDrop({ planId: libraryPlanId, startDate: targetStartDate });
    },
    onLibrarySessionDrop: (sessionId, targetDate) => {
      // NOTE: a dropped session attaches to the displayed plan (`plan`). Precise
      // retargeting to the plan whose range covers `targetDate` (for dates in a
      // future coexisting plan) is deferred; the event still lands on the date.
      void (async () => {
        // Which plan the session joins is not known yet: the drop does nothing.
        if (planPending) return;
        if (!plan) {
          toast.error("No active plan", {
            description: "Generate a plan before dropping sessions from the library.",
          });
          return;
        }
        try {
          const res = await fetch(`/api/clients/${clientId}/training/place-from-library`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "session",
              savedSessionId: sessionId,
              planId: plan.id,
              targetDate,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Failed to place session");
          }
          toast.success("Session placed");
          await invalidateTrainingData(clientId);
          void invalidateNutritionCalendar(clientId);
          void clearClientOverview(clientId);
          void clearAttentionFeed();
          // The Journey block cards are DERIVED from these rows, so they are
          // wrong the moment this lands (CONVENTIONS §7 — the area that reads
          // what you wrote, not the one you wrote).
          void clearBlockFacts(clientId);
        } catch (error) {
          toast.error("Placement failed", {
            description: error instanceof Error ? error.message : "Failed to place session",
          });
        }
      })();
    },
  });

  // Resolve the single plan a week row belongs to, or null if mixed/empty.
  const weekRowPlanId = useCallback(
    (days: string[]): string | null => {
      const ids = new Set<string>();
      for (const date of days) {
        for (const e of eventsByDate.get(date) ?? []) {
          if (e.trainingPlanId) ids.add(e.trainingPlanId);
        }
      }
      if (ids.size === 1) return [...ids][0];
      return null;
    },
    [eventsByDate]
  );

  // Clear-week executor — runs only after the ClearWeekDialog confirm (the
  // action was previously unconfirmed; a mis-click wiped the week).
  const executeClearWeek = useCallback(async (weekStartDate: string) => {
    const weekDays: string[] = [];
    const ws = new Date(weekStartDate + "T00:00:00");
    for (let d = 0; d < 7; d++) {
      weekDays.push(getDateString(ws));
      ws.setDate(ws.getDate() + 1);
    }
    setIsWeekActionLoading(true);
    try {
      // Only today-forward scheduled events are deletable — the server's
      // past guard refuses the rest, so don't even attempt them.
      const weekEvents: TrainingEvent[] = [];
      for (const date of weekDays) {
        if (date < clientToday) continue;
        const dayEvents = eventsByDate.get(date) ?? [];
        weekEvents.push(...dayEvents.filter((e) => e.status === "scheduled"));
      }
      let firstFailure: string | null = null;
      for (const event of weekEvents) {
        try {
          const res = await fetch(
            `/api/clients/${clientId}/training/${event.trainingPlanId}/events/${event.id}`,
            { method: "DELETE" }
          );
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            firstFailure ??= data.error ?? "Failed to remove a session";
          }
        } catch {
          firstFailure ??= "Network error";
        }
      }
      if (firstFailure !== null) {
        toast.error("Some sessions could not be removed", {
          description: firstFailure,
        });
      } else {
        toast.success("Week cleared");
      }
      await invalidateTrainingData(clientId);
      void invalidateNutritionCalendar(clientId);
          void clearClientOverview(clientId);
          void clearAttentionFeed();
    } finally {
      setIsWeekActionLoading(false);
      closeClearWeek();
    }
  }, [clientId, clientToday, eventsByDate, invalidateTrainingData, invalidateNutritionCalendar, clearClientOverview, clearAttentionFeed, closeClearWeek]);

  // Per-event delete executor — runs only after the DeleteEventDialog confirm.
  // A success closes with `isDeletingEvent` still set, so the fading card keeps
  // its pending frame; the next open clears it (onDelete below). A failure
  // clears it here, because the card stays open.
  const executeDeleteEvent = useCallback(async (event: TrainingEvent) => {
    setIsDeletingEvent(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${event.trainingPlanId}/events/${event.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        toast.error("Error", { description: data.error || "Failed to delete event" });
        setIsDeletingEvent(false);
        return;
      }
      await invalidateTrainingData(clientId);
      void invalidateNutritionCalendar(clientId);
          void clearClientOverview(clientId);
          void clearAttentionFeed();
      toast.success("Session removed");
      closeDelete();
    } catch {
      toast.error("Error", { description: "Failed to delete event" });
      setIsDeletingEvent(false);
    }
  }, [clientId, invalidateTrainingData, invalidateNutritionCalendar, clearClientOverview, clearAttentionFeed, closeDelete]);

  // Week action handler. `WeekAction` is down to its one surviving member, so
  // the action itself is not read — the parameter stays to keep the row → view
  // contract explicit rather than collapsing the callback to a bare date.
  const handleWeekAction = useCallback((
    weekStartDate: string,
    _action: WeekAction
  ) => {
    if (planPending) return;
    const weekDays: string[] = [];
    const ws = new Date(weekStartDate + "T00:00:00");
    for (let d = 0; d < 7; d++) {
      weekDays.push(getDateString(ws));
      ws.setDate(ws.getDate() + 1);
    }
    const rowPlanId = weekRowPlanId(weekDays);
    if (!rowPlanId) {
      toast.error("Mixed plans", {
        description: "Week-level actions require a single plan in this row.",
      });
      return;
    }

    const hasClearable = weekDays.some(
      (date) =>
        date >= clientToday &&
        (eventsByDate.get(date) ?? []).some((e) => e.status === "scheduled")
    );
    if (!hasClearable) {
      toast("Nothing to clear", { description: "This week has no upcoming sessions." });
      return;
    }
    showClearWeek(weekStartDate);
  }, [planPending, clientToday, eventsByDate, weekRowPlanId, showClearWeek]);

  const monthLabel = format(new Date(viewMonth.year, viewMonth.month, 1), "MMMM yyyy");

  // Sessions in the viewed month proper (grid-range events include the
  // adjacent months' spill days).
  const monthSessionCount = useMemo(() => {
    const ym = `${viewMonth.year}-${String(viewMonth.month + 1).padStart(2, "0")}`;
    return events.filter((e) => e.date.startsWith(ym)).length;
  }, [events, viewMonth]);

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
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={calendarCollisionDetection}
      onDragStart={dnd.handleDragStart}
      onDragCancel={dnd.handleDragCancel}
      onDragEnd={dnd.handleDragEnd}
    >
      <div className="flex flex-col gap-2">
        <CalendarToolbar
          monthLabel={monthLabel}
          onPrevMonth={goPrevMonth}
          onNextMonth={goNextMonth}
          onToday={goToday}
          isLoading={isLoading}
          editMode={editMode}
          onEditModeChange={onEditModeChange}
          libraryOpen={libraryOpen}
          onToggleLibrary={() => setLibraryOpen(!libraryOpen)}
          monthSessionCount={monthSessionCount}
          onDeleteFuture={onDeleteFuture}
          deleteFutureDisabled={planPending}
        />

        <CalendarGrid
          weeks={weeks}
          eventsByDate={eventsByDate}
          editMode={editMode}
          todayDate={todayDate}
          clientToday={clientToday}
          viewMonth={viewMonth.month}
          viewYear={viewMonth.year}
          hasPlan={!!plan || planPending}
          weekRowPlanId={weekRowPlanId}
          onWeekAction={handleWeekAction}
          onEventClick={(event) => {
            if (event.trainingSessionId && event.trainingPlanId) {
              // A fresh subject per open: the tray seeds its draft once per
              // subject, so re-opening the same day drops a discarded draft.
              showSessionTray({
                clientId,
                sessionId: event.trainingSessionId,
                eventId: event.id,
                planId: event.trainingPlanId,
                date: event.date,
              });
            }
          }}
          onDelete={(event) => {
            // The open clears the pending flag a successful delete left set.
            setIsDeletingEvent(false);
            showDelete(event);
          }}
        />

        {isWeekActionLoading && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-[#93b0b4]" />
          </div>
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {dnd.activeEvent ? (
          <CalendarEventCard
            event={dnd.activeEvent}
            editMode={false}
            clientToday={clientToday}
            isDragging
            onEventClick={() => {}}
          />
        ) : null}
      </DragOverlay>

      {/* Per-event delete confirm */}
      <DeleteEventDialog
        open={deleteOpen}
        event={deleteTarget}
        isDeleting={isDeletingEvent}
        onCancel={closeDelete}
        onConfirm={(event) => void executeDeleteEvent(event)}
      />

      {/* Clear-week confirm (previously unconfirmed) */}
      <ClearWeekDialog
        open={clearWeekOpen}
        weekStartDate={pendingClearWeek}
        isClearing={isWeekActionLoading}
        onCancel={closeClearWeek}
        onConfirm={(weekStartDate) => void executeClearWeek(weekStartDate)}
      />

      {/* Placed-session tray */}
      <PlacedSessionEditor
        open={sessionTrayOpen}
        state={selectedSession}
        onClose={closeSessionTray}
      />

      {/* Library panel */}
      <LibraryPanel open={libraryOpen} onOpenChange={setLibraryOpen} />

      {/* Apply from library drop dialog */}
      {applyFromDrop && (() => {
        const dropPlan = savedPlans.find((p) => p.id === applyFromDrop.planId);
        if (!dropPlan) return null;
        return (
          <ApplyToClientDialog
            open={!!applyFromDrop}
            onOpenChange={(open) => { if (!open) setApplyFromDrop(null); }}
            savedPlan={dropPlan}
            preselectedClientId={clientId}
            clientTimezone={clientTimezone}
            onSuccess={() => {
              setApplyFromDrop(null);
              void mutate();
              onUpdate();
            }}
          />
        );
      })()}
    </DndContext>
  );
}
