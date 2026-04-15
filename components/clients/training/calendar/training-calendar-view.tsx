"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import { useCalendarEvents } from "@/hooks/use-calendar-events";
import { useCalendarDnd } from "@/hooks/use-calendar-dnd";
import { CalendarWeekRow } from "./calendar-week-row";
import { CalendarEventCard } from "./calendar-event-card";
import { MoveScopeDialog } from "./move-scope-dialog";
import { SessionDetailDrawer } from "./session-detail-drawer";
import { useToast } from "@/hooks/use-toast";
import { getTodayDateString, getDateString } from "@/lib/date-helpers";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrainingPlan, TrainingEvent } from "@/types/training";
import type { Phase } from "@/types/roadmap";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type TrainingCalendarViewProps = {
  clientId: string;
  planId: string;
  plan: TrainingPlan;
  activePhase: Phase | null;
  editMode: boolean;
  onUpdate: () => void;
};

function computeDateRange(plan: TrainingPlan, activePhase: Phase | null) {
  const startDate = activePhase?.startDate ?? plan.effectiveFrom ?? getTodayDateString();
  let endDate = activePhase?.endDate;
  if (!endDate && plan.effectiveFrom && plan.programDurationWeeks) {
    const end = new Date(plan.effectiveFrom + "T00:00:00");
    end.setDate(end.getDate() + plan.programDurationWeeks * 7 - 1);
    endDate = getDateString(end);
  }
  if (!endDate) {
    const end = new Date(startDate + "T00:00:00");
    end.setDate(end.getDate() + 55); // 8 weeks fallback
    endDate = getDateString(end);
  }
  return { startDate, endDate };
}

function computeWeeks(startDate: string, endDate: string): string[][] {
  const weeks: string[][] = [];
  const start = new Date(startDate + "T00:00:00");
  // Align to Monday
  const dayOfWeek = start.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(start);
  monday.setDate(monday.getDate() + mondayOffset);

  const end = new Date(endDate + "T00:00:00");
  const current = new Date(monday);

  while (current <= end) {
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
  planId,
  plan,
  activePhase,
  editMode,
  onUpdate,
}: TrainingCalendarViewProps) {
  const { toast } = useToast();
  const todayDate = getTodayDateString();
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRowRef = useRef<HTMLDivElement>(null);

  // State
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<TrainingEvent | null>(null);
  const [isWeekActionLoading, setIsWeekActionLoading] = useState(false);

  // Compute date range and weeks
  const { startDate, endDate } = useMemo(() => computeDateRange(plan, activePhase), [plan, activePhase]);
  const weeks = useMemo(() => computeWeeks(startDate, endDate), [startDate, endDate]);

  // Fetch events
  const { events, eventsByDate, isLoading, mutate } = useCalendarEvents(clientId, planId, startDate, endDate);

  // DnD
  const dnd = useCalendarDnd({ events, eventsByDate, clientId, planId, mutate });

  // Scroll to today on mount
  useEffect(() => {
    if (todayRowRef.current) {
      todayRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isLoading]);

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
  const selectedSessionData = useMemo(() => {
    if (!selectedSession) return null;
    return plan.sessions.find((s) => s.id === selectedSession) ?? null;
  }, [selectedSession, plan.sessions]);

  // Count events sharing the selected session
  const sharedEventCount = useMemo(() => {
    if (!selectedSession) return 0;
    return events.filter((e) => e.trainingSessionId === selectedSession).length;
  }, [selectedSession, events]);

  // Cell click handler (for duplicate mode)
  const handleCellClick = useCallback(async (targetDate: string) => {
    if (!pendingDuplicate) return;
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/events/${pendingDuplicate.id}/duplicate`,
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
  }, [pendingDuplicate, clientId, planId, mutate, toast]);

  // Week action handler
  const handleWeekAction = useCallback(async (
    weekNumber: number,
    weekStartDate: string,
    action: "duplicate_next" | "duplicate_remaining" | "clear"
  ) => {
    setIsWeekActionLoading(true);
    try {
      if (action === "clear") {
        // Delete all scheduled events in this week
        const weekEvents = [];
        const weekStart = new Date(weekStartDate + "T00:00:00");
        for (let d = 0; d < 7; d++) {
          const date = getDateString(weekStart);
          const dayEvents = eventsByDate.get(date) ?? [];
          weekEvents.push(...dayEvents.filter((e) => e.status === "scheduled"));
          weekStart.setDate(weekStart.getDate() + 1);
        }
        let clearFailed = false;
        for (const event of weekEvents) {
          try {
            const res = await fetch(
              `/api/clients/${clientId}/training/${planId}/events/${event.id}/move`,
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
          toast({ title: `Week ${weekNumber} cleared` });
        }
      } else if (action === "duplicate_next") {
        const nextWeekStart = new Date(weekStartDate + "T00:00:00");
        nextWeekStart.setDate(nextWeekStart.getDate() + 7);
        const res = await fetch(
          `/api/clients/${clientId}/training/${planId}/events/duplicate-week`,
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
        const res = await fetch(
          `/api/clients/${clientId}/training/${planId}/events/duplicate-week`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceStartDate: weekStartDate,
              fillRemaining: true,
              phaseEndDate: endDate,
            }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to duplicate weeks");
        }
        toast({ title: "Week duplicated to all remaining weeks" });
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
  }, [clientId, planId, endDate, eventsByDate, mutate, toast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" />
      </div>
    );
  }

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

        {/* Day headers */}
        <div className="flex gap-1">
          <div className="w-10 flex-shrink-0" />
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
            return (
              <div key={days[0]} ref={containsToday ? todayRowRef : undefined}>
                <CalendarWeekRow
                  weekNumber={i + 1}
                  days={days}
                  eventsByDate={eventsByDate}
                  editMode={editMode}
                  todayDate={todayDate}
                  duplicateMode={!!pendingDuplicate}
                  isLastWeek={i === weeks.length - 1}
                  onWeekAction={handleWeekAction}
                  onCellClick={handleCellClick}
                  onEventClick={(event) => {
                    if (pendingDuplicate) return;
                    setSelectedSession(event.trainingSessionId);
                  }}
                  onDuplicate={(event) => setPendingDuplicate(event)}
                  onDelete={async (event) => {
                    if (!confirm(`Delete "${event.sessionName}" on ${event.date}?`)) return;
                    try {
                      const res = await fetch(
                        `/api/clients/${clientId}/training/${planId}/events/${event.id}`,
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
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {dnd.activeEvent ? (
          <CalendarEventCard
            event={dnd.activeEvent}
            editMode={false}
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

      {/* Session detail drawer */}
      <SessionDetailDrawer
        open={!!selectedSession}
        onOpenChange={(open) => {
          if (!open) setSelectedSession(null);
        }}
        session={selectedSessionData}
        clientId={clientId}
        planId={planId}
        sharedEventCount={sharedEventCount}
        onUpdate={() => {
          onUpdate();
          mutate();
        }}
      />
    </DndContext>
  );
}
