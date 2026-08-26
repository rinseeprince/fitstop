"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { calendarCollisionDetection } from "./calendar-collision";
import { useCalendarEvents, useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useCalendarDnd } from "@/hooks/use-calendar-dnd";
import { CalendarGrid } from "./calendar-grid";
import { CalendarToolbar } from "./calendar-toolbar";
import { CalendarEventCard } from "./calendar-event-card";
import { ClearWeekDialog, DeleteEventDialog } from "./delete-event-dialog";
import { PlacedSessionEditor } from "./placed-session-editor";
import { LibraryPanel } from "./library-panel";
import { ApplyToClientDialog } from "@/components/training-library/apply-to-client-dialog";
import { useToast } from "@/hooks/use-toast";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { getTodayDateString, getTodayDateStringInTimezone, getDateString } from "@/lib/date-helpers";
import { Loader2, X } from "lucide-react";
import { format } from "date-fns";
import type { WeekAction } from "./calendar-week-rail";
import type { TrainingPlan, TrainingEvent } from "@/types/training";

type TrainingCalendarViewProps = {
  clientId: string;
  plan: TrainingPlan | null;
  editMode: boolean;
  clientTimezone?: string;
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
  editMode,
  clientTimezone,
  onUpdate,
  onEditModeChange,
  onDeleteFuture,
}: TrainingCalendarViewProps) {
  const { toast } = useToast();
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

  // State
  const [selectedSession, setSelectedSession] = useState<{ sessionId: string; eventId: string; planId: string; date: string } | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<TrainingEvent | null>(null);
  const [isWeekActionLoading, setIsWeekActionLoading] = useState(false);
  const [pendingClearWeek, setPendingClearWeek] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrainingEvent | null>(null);
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
  // calendar's month window: the plan editor reads the same rows through the
  // amendment GET, and a bound `mutate` cannot reach it.
  const invalidateTrainingData = useInvalidateTrainingData();

  // Training mutations cascade-rewrite nutrition_events server-side
  // (calorie targets track the training layout), so every success path below
  // must also invalidate the nutrition calendar's cache.
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();

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
        if (!plan) {
          toast({
            title: "No active plan",
            description: "Generate a plan before dropping sessions from the library.",
            variant: "destructive",
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
          toast({ title: "Session placed" });
          await invalidateTrainingData(clientId);
          void invalidateNutritionCalendar(clientId);
        } catch (error) {
          toast({
            title: "Placement failed",
            description: error instanceof Error ? error.message : "Failed to place session",
            variant: "destructive",
          });
        }
      })();
    },
  });

  // Escape key to cancel duplicate mode
  useEffect(() => {
    if (!pendingDuplicate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingDuplicate(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pendingDuplicate]);

  // Cell click handler (for duplicate mode)
  const handleCellClick = useCallback(async (targetDate: string) => {
    if (!pendingDuplicate) return;
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${pendingDuplicate.trainingPlanId}/events/${pendingDuplicate.id}/duplicate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetDate }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to duplicate");
      }
      toast({ title: "Session duplicated" });
      await invalidateTrainingData(clientId);
      void invalidateNutritionCalendar(clientId);
    } catch (error) {
      toast({
        title: "Duplicate failed",
        description: error instanceof Error ? error.message : "Failed to duplicate event",
        variant: "destructive",
      });
    } finally {
      setPendingDuplicate(null);
    }
  }, [pendingDuplicate, clientId, invalidateTrainingData, invalidateNutritionCalendar, toast]);

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
        toast({
          title: "Some sessions could not be removed",
          description: firstFailure,
          variant: "destructive",
        });
      } else {
        toast({ title: "Week cleared" });
      }
      await invalidateTrainingData(clientId);
      void invalidateNutritionCalendar(clientId);
    } finally {
      setIsWeekActionLoading(false);
      setPendingClearWeek(null);
    }
  }, [clientId, clientToday, eventsByDate, invalidateTrainingData, invalidateNutritionCalendar, toast]);

  // Per-event delete executor — runs only after the DeleteEventDialog confirm.
  const executeDeleteEvent = useCallback(async (event: TrainingEvent) => {
    setIsDeletingEvent(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${event.trainingPlanId}/events/${event.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to delete event", variant: "destructive" });
        return;
      }
      await invalidateTrainingData(clientId);
      void invalidateNutritionCalendar(clientId);
      toast({ title: "Session removed" });
      setDeleteTarget(null);
    } catch {
      toast({ title: "Error", description: "Failed to delete event", variant: "destructive" });
    } finally {
      setIsDeletingEvent(false);
    }
  }, [clientId, invalidateTrainingData, invalidateNutritionCalendar, toast]);

  // Week action handler. `WeekAction` is down to its one surviving member, so
  // the action itself is not read — the parameter stays to keep the row → view
  // contract explicit rather than collapsing the callback to a bare date.
  const handleWeekAction = useCallback((
    weekStartDate: string,
    _action: WeekAction
  ) => {
    const weekDays: string[] = [];
    const ws = new Date(weekStartDate + "T00:00:00");
    for (let d = 0; d < 7; d++) {
      weekDays.push(getDateString(ws));
      ws.setDate(ws.getDate() + 1);
    }
    const rowPlanId = weekRowPlanId(weekDays);
    if (!rowPlanId) {
      toast({
        title: "Mixed plans",
        description: "Week-level actions require a single plan in this row.",
        variant: "destructive",
      });
      return;
    }

    const hasClearable = weekDays.some(
      (date) =>
        date >= clientToday &&
        (eventsByDate.get(date) ?? []).some((e) => e.status === "scheduled")
    );
    if (!hasClearable) {
      toast({ title: "Nothing to clear", description: "This week has no upcoming sessions." });
      return;
    }
    setPendingClearWeek(weekStartDate);
  }, [clientToday, eventsByDate, toast, weekRowPlanId]);

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
        {/* Duplicate banner */}
        {pendingDuplicate && (
          <div className="flex items-center gap-2 rounded-[6px] border border-[rgba(13,148,136,0.2)] bg-[rgba(13,148,136,0.05)] px-3 py-2">
            <span className="flex-1 text-[12px] text-[#0a5c55]">
              Click a day to place a copy of <strong>{pendingDuplicate.sessionName}</strong>
            </span>
            <button
              onClick={() => setPendingDuplicate(null)}
              aria-label="Cancel duplicate"
              className="rounded p-1 transition-colors hover:bg-[rgba(13,148,136,0.08)]"
            >
              <X className="h-3.5 w-3.5 text-[#0a5c55]" strokeWidth={1.5} />
            </button>
          </div>
        )}

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
        />

        <CalendarGrid
          weeks={weeks}
          eventsByDate={eventsByDate}
          editMode={editMode}
          todayDate={todayDate}
          clientToday={clientToday}
          duplicateMode={!!pendingDuplicate}
          viewMonth={viewMonth.month}
          viewYear={viewMonth.year}
          hasPlan={!!plan}
          weekRowPlanId={weekRowPlanId}
          onWeekAction={handleWeekAction}
          onCellClick={handleCellClick}
          onEventClick={(event) => {
            if (pendingDuplicate) return;
            if (event.trainingSessionId && event.trainingPlanId) {
              setSelectedSession({
                sessionId: event.trainingSessionId,
                eventId: event.id,
                planId: event.trainingPlanId,
                date: event.date,
              });
            }
          }}
          onDuplicate={(event) => setPendingDuplicate(event)}
          onDelete={(event) => setDeleteTarget(event)}
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
        event={deleteTarget}
        isDeleting={isDeletingEvent}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(event) => void executeDeleteEvent(event)}
      />

      {/* Clear-week confirm (previously unconfirmed) */}
      <ClearWeekDialog
        weekStartDate={pendingClearWeek}
        isClearing={isWeekActionLoading}
        onCancel={() => setPendingClearWeek(null)}
        onConfirm={(weekStartDate) => void executeClearWeek(weekStartDate)}
      />

      {/* Placed-session tray */}
      <PlacedSessionEditor
        state={selectedSession ? { clientId, ...selectedSession } : null}
        onClose={() => setSelectedSession(null)}
        onUpdate={onUpdate}
        mutateCalendar={mutate}
        onSelectSession={(sessionId, eventId) =>
          setSelectedSession((prev) =>
            prev ? { ...prev, sessionId, eventId } : null
          )
        }
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
