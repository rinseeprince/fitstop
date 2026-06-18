"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import { useCalendarEvents } from "@/hooks/use-calendar-events";
import { useCalendarDnd } from "@/hooks/use-calendar-dnd";
import { CalendarWeekRow } from "./calendar-week-row";
import { CalendarEventCard } from "./calendar-event-card";
import { MoveScopeDialog } from "./move-scope-dialog";
import { SessionDetailDrawer } from "./session-detail-drawer";
import { LibraryPanel } from "./library-panel";
import { ApplyToClientDialog } from "@/components/training-library/apply-to-client-dialog";
import { useToast } from "@/hooks/use-toast";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { getTodayDateString, getTodayDateStringInTimezone, getDateString } from "@/lib/date-helpers";
import { BookOpen, Loader2, X, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import type { TrainingPlan, TrainingEvent, TrainingSession } from "@/types/training";
import type { Phase, PhaseStatus } from "@/types/roadmap";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type TrainingCalendarViewProps = {
  clientId: string;
  plan: TrainingPlan | null;
  phases: Phase[];
  editMode: boolean;
  clientTimezone?: string;
  onUpdate: () => void;
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
  phases,
  editMode,
  clientTimezone,
  onUpdate,
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRowRef = useRef<HTMLDivElement>(null);

  // Month nav state — defaults to the current month
  const [viewMonth, setViewMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });

  // State
  const [selectedSession, setSelectedSession] = useState<{ sessionId: string; eventId: string; planId: string } | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<TrainingEvent | null>(null);
  const [isWeekActionLoading, setIsWeekActionLoading] = useState(false);
  const [saveDialogWeek, setSaveDialogWeek] = useState<string | null>(null);
  const [savePlanName, setSavePlanName] = useState("");
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

  // Saved plans for apply-from-drop dialog
  const { plans: savedPlans } = useSavedPlans();

  // DnD with library drop handlers
  const dnd = useCalendarDnd({
    events,
    eventsByDate,
    clientId,
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
          await mutate();
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

  // Scroll today row into view when the viewed month contains today
  useEffect(() => {
    const viewingCurrentMonth =
      new Date().getFullYear() === viewMonth.year &&
      new Date().getMonth() === viewMonth.month;
    if (viewingCurrentMonth && todayRowRef.current) {
      todayRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isLoading, viewMonth]);

  // Escape key to cancel duplicate mode
  useEffect(() => {
    if (!pendingDuplicate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingDuplicate(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pendingDuplicate]);

  // Find session from plan for drawer
  // The clicked event may belong to a coexisting (non-active) plan whose sessions
  // aren't in `plan.sessions`. Resolve from the active plan when possible; else
  // lazy-fetch by id, showing an event-snapshot immediately so the drawer never
  // opens blank (hard floor).
  const [selectedSessionData, setSelectedSessionData] = useState<TrainingSession | null>(null);

  useEffect(() => {
    if (!selectedSession) {
      setSelectedSessionData(null);
      return;
    }
    const local = plan?.sessions.find((s) => s.id === selectedSession.sessionId);
    if (local) {
      setSelectedSessionData(local);
      return;
    }
    // Snapshot from the event so the drawer renders something instantly.
    const evt = events.find((e) => e.id === selectedSession.eventId);
    setSelectedSessionData(
      evt
        ? {
            id: selectedSession.sessionId,
            planId: selectedSession.planId,
            name: evt.sessionName,
            focus: evt.sessionFocus ?? undefined,
            orderIndex: 0,
            exercises: [],
            estimatedCalories: evt.estimatedCalories ?? undefined,
            calorieSurplusPercentage: evt.calorieSurplusPercentage,
            createdAt: "",
            updatedAt: "",
          }
        : null,
    );
    // Then fetch the full session (with exercises) for the coexisting plan.
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/training/${selectedSession.planId}/sessions/${selectedSession.sessionId}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.success && data.session) {
          setSelectedSessionData(data.session as TrainingSession);
        }
      } catch {
        // Keep the snapshot on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSession, plan, events, clientId]);

  // Count events sharing the selected session
  const sharedEventCount = useMemo(() => {
    if (!selectedSession) return 0;
    return events.filter((e) => e.trainingSessionId === selectedSession.sessionId).length;
  }, [selectedSession, events]);

  // Build per-day phase status map for tinting
  const phaseByDate = useMemo(() => {
    const map = new Map<string, PhaseStatus>();
    if (phases.length === 0) return map;
    const phasesSorted = [...phases].sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
    // Iterate each day in grid; linear scan over phases (typically <= 5)
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
      await mutate();
    } catch (error) {
      toast({
        title: "Duplicate failed",
        description: error instanceof Error ? error.message : "Failed to duplicate event",
        variant: "destructive",
      });
    } finally {
      setPendingDuplicate(null);
    }
  }, [pendingDuplicate, clientId, mutate, toast]);

  const handleSavePlanFromCalendar = useCallback(async (weekStartDate: string, name: string, sourcePlanId: string) => {
    try {
      const res = await fetch("/api/training/saved-plans/from-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, planId: sourcePlanId, weekStartDate, name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save plan");
      }
      toast({ title: "Saved to library", description: `"${name}" saved to your training library` });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save plan",
        variant: "destructive",
      });
    }
  }, [clientId, toast]);

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

  // Week action handler
  const handleWeekAction = useCallback(async (
    weekStartDate: string,
    action: "duplicate_next" | "duplicate_remaining" | "save_to_library" | "clear"
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

    if (action === "save_to_library") {
      setSaveDialogWeek(weekStartDate);
      setSavePlanName(`${plan?.name ?? "Plan"} - ${format(new Date(weekStartDate + "T00:00:00"), "MMM d")}`);
      return;
    }

    setIsWeekActionLoading(true);
    try {
      if (action === "clear") {
        const weekEvents: TrainingEvent[] = [];
        for (const date of weekDays) {
          const dayEvents = eventsByDate.get(date) ?? [];
          weekEvents.push(...dayEvents.filter((e) => e.status === "scheduled"));
        }
        let clearFailed = false;
        for (const event of weekEvents) {
          try {
            const res = await fetch(
              `/api/clients/${clientId}/training/${event.trainingPlanId}/events/${event.id}`,
              { method: "DELETE" }
            );
            if (!res.ok) clearFailed = true;
          } catch {
            clearFailed = true;
          }
        }
        if (clearFailed) {
          toast({ title: "Error", description: "Some events could not be deleted", variant: "destructive" });
        } else {
          toast({ title: "Week cleared" });
        }
      } else if (action === "duplicate_next") {
        const nextWeekStart = new Date(weekStartDate + "T00:00:00");
        nextWeekStart.setDate(nextWeekStart.getDate() + 7);
        const res = await fetch(
          `/api/clients/${clientId}/training/${rowPlanId}/events/duplicate-week`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceStartDate: weekStartDate,
              targetStartDate: getDateString(nextWeekStart),
            }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to duplicate week");
        }
        toast({ title: "Week duplicated to next week" });
      } else {
        // duplicate_remaining — the server bounds "remaining" by the plan's own
        // date range (its last scheduled event), so no phaseEndDate is needed.
        const res = await fetch(
          `/api/clients/${clientId}/training/${rowPlanId}/events/duplicate-week`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceStartDate: weekStartDate,
              fillRemaining: true,
            }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to duplicate weeks");
        }
        const weeks = data.weeksCreated ?? 0;
        toast({
          title:
            weeks > 0
              ? `Week duplicated to ${weeks} remaining week${weeks === 1 ? "" : "s"}`
              : "No remaining weeks to fill",
        });
      }
      await mutate();
    } catch (error) {
      toast({
        title: "Action failed",
        description: error instanceof Error ? error.message : "Failed to complete action",
        variant: "destructive",
      });
    } finally {
      setIsWeekActionLoading(false);
    }
  }, [clientId, plan, eventsByDate, mutate, toast, weekRowPlanId]);

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
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={closestCenter}
      onDragStart={dnd.handleDragStart}
      onDragEnd={dnd.handleDragEnd}
    >
      <div className="flex flex-col gap-2">
        {/* Duplicate banner */}
        {pendingDuplicate && (
          <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 rounded-[6px] border border-teal-200/50">
            <span className="text-[12px] text-teal-800 flex-1">
              Click a day to place a copy of <strong>{pendingDuplicate.sessionName}</strong>
            </span>
            <button
              onClick={() => setPendingDuplicate(null)}
              className="p-1 rounded hover:bg-teal-100 transition-colors"
            >
              <X className="h-3.5 w-3.5 text-teal-600" />
            </button>
          </div>
        )}

        {/* Month nav toolbar */}
        <div className="flex items-center gap-2 px-1">
          <button
            onClick={goPrevMonth}
            aria-label="Previous month"
            className="p-1 rounded hover:bg-[rgba(13,148,136,0.05)] transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-[#5a7d82]" />
          </button>
          <span className="text-[13px] font-semibold text-[#0c1a1e] min-w-[120px] text-center">
            {monthLabel}
          </span>
          <button
            onClick={goNextMonth}
            aria-label="Next month"
            className="p-1 rounded hover:bg-[rgba(13,148,136,0.05)] transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-[#5a7d82]" />
          </button>
          <button
            onClick={goToday}
            className="text-[11px] font-medium text-[#5a7d82] hover:text-[#0c1a1e] px-2 py-1 rounded transition-colors"
          >
            Today
          </button>

          <div className="ml-auto flex items-center gap-2">
            {editMode && (
              <Button
                variant={libraryOpen ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setLibraryOpen(!libraryOpen)}
              >
                <BookOpen className="h-3 w-3 mr-1" />
                Library
              </Button>
            )}
            {isLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#93b0b4]" />
            )}
          </div>
        </div>

        {/* Day headers */}
        <div className="flex gap-1">
          {editMode && <div className="w-10 flex-shrink-0" />}
          <div className="flex-1 grid grid-cols-7 gap-1">
            {DAY_LABELS.map((label) => (
              <div key={label} className="text-center text-[10px] uppercase tracking-[0.06em] text-[#93b0b4] font-medium py-1">
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Week rows */}
        <div ref={scrollRef} className="flex flex-col gap-1 max-h-[600px] overflow-y-auto">
          {weeks.map((days, i) => {
            const containsToday = days.includes(todayDate);
            const rowPlanId = weekRowPlanId(days);
            const rowHasEvents = days.some((d) => (eventsByDate.get(d) ?? []).length > 0);
            const showKebab = !!plan && !!rowPlanId && rowHasEvents;
            const disabledReason = !rowHasEvents
              ? undefined
              : rowPlanId === null
              ? "Mixed plans — use session menu"
              : undefined;
            return (
              <div key={days[0]} ref={containsToday ? todayRowRef : undefined}>
                <CalendarWeekRow
                  days={days}
                  eventsByDate={eventsByDate}
                  editMode={editMode}
                  todayDate={todayDate}
                  clientToday={clientToday}
                  duplicateMode={!!pendingDuplicate}
                  viewMonth={viewMonth.month}
                  viewYear={viewMonth.year}
                  phaseByDate={phaseByDate}
                  showWeekKebab={showKebab}
                  weekActionDisabledReason={disabledReason}
                  isLastWeek={i === weeks.length - 1}
                  onWeekAction={handleWeekAction}
                  onCellClick={handleCellClick}
                  onEventClick={(event) => {
                    if (pendingDuplicate) return;
                    if (event.trainingSessionId && event.trainingPlanId) {
                      setSelectedSession({
                        sessionId: event.trainingSessionId,
                        eventId: event.id,
                        planId: event.trainingPlanId,
                      });
                    }
                  }}
                  onDuplicate={(event) => setPendingDuplicate(event)}
                  onDelete={async (event) => {
                    if (!confirm(`Delete "${event.sessionName}" on ${event.date}?`)) return;
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
                      await mutate();
                      toast({ title: "Session removed" });
                    } catch {
                      toast({ title: "Error", description: "Failed to delete event", variant: "destructive" });
                    }
                  }}
                />
              </div>
            );
          })}
        </div>

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

      {/* Move scope dialog */}
      {dnd.pendingMove && (
        <MoveScopeDialog
          open={!!dnd.pendingMove}
          onOpenChange={() => dnd.handleMoveCancel()}
          event={dnd.pendingMove.event}
          sourceDate={dnd.pendingMove.sourceDate}
          targetDate={dnd.pendingMove.targetDate}
          onConfirm={dnd.handleMoveConfirm}
          isLoading={dnd.isMoving}
        />
      )}

      {/* Save plan to library dialog */}
      <Dialog
        open={!!saveDialogWeek}
        onOpenChange={(open) => { if (!open) setSaveDialogWeek(null); }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save as Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="save-plan-name">Plan Name</Label>
            <Input
              id="save-plan-name"
              value={savePlanName}
              onChange={(e) => setSavePlanName(e.target.value)}
              placeholder="Enter plan name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogWeek(null)}>
              Cancel
            </Button>
            <Button
              disabled={!savePlanName.trim()}
              onClick={async () => {
                if (!saveDialogWeek || !savePlanName.trim()) return;
                const rowPlanId = weekRowPlanId(
                  (() => {
                    const wd: string[] = [];
                    const ws = new Date(saveDialogWeek + "T00:00:00");
                    for (let d = 0; d < 7; d++) {
                      wd.push(getDateString(ws));
                      ws.setDate(ws.getDate() + 1);
                    }
                    return wd;
                  })()
                );
                if (!rowPlanId) {
                  toast({ title: "Mixed plans", variant: "destructive" });
                  setSaveDialogWeek(null);
                  return;
                }
                await handleSavePlanFromCalendar(saveDialogWeek, savePlanName.trim(), rowPlanId);
                setSaveDialogWeek(null);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Session detail drawer */}
      <SessionDetailDrawer
        open={!!selectedSession}
        onOpenChange={(open) => {
          if (!open) setSelectedSession(null);
        }}
        session={selectedSessionData}
        eventId={selectedSession?.eventId}
        clientId={clientId}
        planId={selectedSession?.planId ?? plan?.id ?? ""}
        sharedEventCount={sharedEventCount}
        onUpdate={() => {
          onUpdate();
          void mutate();
        }}
        onSelectSession={(sessionId, eventId) =>
          setSelectedSession(
            selectedSession
              ? { sessionId, eventId, planId: selectedSession.planId }
              : null
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
