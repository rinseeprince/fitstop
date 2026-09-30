"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { AddHabitsSheet } from "./add-habits-sheet";
import { HabitDayDialog, type HabitDaySubject } from "./habit-day-dialog";
import { HabitLoadError } from "./habit-load-error";
import { orderAfterMove } from "./habit-order";
import { HabitRowDialogs, type HabitRowDialogSubject } from "./habit-row-dialogs";
import type { HabitRowAction } from "./habit-row-menu";
import { habitTrackerRows, movableHabitIds } from "./habit-tracker-rows";
import { HabitsStatBand } from "./habits-stat-band";
import { HabitsWeekNav } from "./habits-week-nav";
import { HabitsWeekTracker } from "./habits-week-tracker";
import { useClientHabitList, useClientHabitWeek, useHabitWrites } from "@/hooks/use-client-habits";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { addDaysToDateString } from "@/lib/date-helpers";
import type { Client } from "@/types/check-in";
import type { CoachHabit } from "@/types/habits";

type HabitsTabContentProps = {
  client: Client;
};

/** The days a client week runs. */
const WEEK_DAYS = 7;

/**
 * The coach's Habits tab (ARCHITECTURE → "Habits"): the summary of now — this
 * week, today, the habits running — over one client week of the client's
 * habits as it happened: the week holding the client's today, or another
 * paged to, back or forward to plan one-date changes. Each row's ⋯ holds what
 * can be done to its habit, a set-days habit's day from today on opens "This
 * day", and + Add habits opens the sheet. Every figure is the server's, from
 * the habit kernel, on the client's calendar. Every write names the week on
 * screen and answers with it, so the card changes in place with no loading
 * state between (`useHabitWrites`).
 */
export const HabitsTabContent = ({ client }: HabitsTabContentProps) => {
  // The first day of the week paged to; null is the week holding the
  // client's today, which the server resolves.
  const [pagedStart, setPagedStart] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [movingId, setMovingId] = useState<string | null>(null);
  const rowDialog = useDialogSubject<HabitRowDialogSubject>();
  const dayDialog = useDialogSubject<HabitDaySubject>();

  const { list, error: listError, isLoading: listLoading, retry: retryList } = useClientHabitList(client.id);
  const { week, error: weekError, retry: retryWeek } = useClientHabitWeek(client.id, pagedStart);
  // The summary is of now whichever week the table shows: the week holding
  // the client's today — the same read as the table's while it shows that week.
  const { week: currentWeek, isLoading: currentLoading } = useClientHabitWeek(client.id, null);
  const writes = useHabitWrites(client.id, pagedStart);

  const retry = () => {
    if (listError) retryList();
    if (weekError) retryWeek();
  };

  // The week on screen: the one paged to, known from the click; else the
  // client's current week once the server has said which it is.
  const weekStart = pagedStart ?? week?.start ?? null;
  const weekEnd = weekStart === null ? null : addDaysToDateString(weekStart, WEEK_DAYS - 1);
  const clientToday = currentWeek?.clientToday ?? week?.clientToday ?? list?.clientToday ?? null;

  /** A week start, or null when the week it starts holds the client's today: that week is the server's to name. */
  const pageTo = (start: string) => {
    const holdsToday = clientToday !== null && start <= clientToday && clientToday <= addDaysToDateString(start, WEEK_DAYS - 1);
    setPagedStart(holdsToday ? null : start);
  };
  const page = (weeks: number) => {
    if (weekStart !== null) pageTo(addDaysToDateString(weekStart, weeks * WEEK_DAYS));
  };

  const rows = list && week ? habitTrackerRows(list, week) : null;
  const movableIds = list ? movableHabitIds(list) : [];
  // A move is the one write made with no surface of its own over the page, so
  // while it is in flight nothing else may write: two answers in flight could
  // land out of order and leave the older on screen.
  const moving = movingId !== null;

  /**
   * A move among the running and starting-later habits, sent as the WHOLE
   * list: the order route names every one of the client's habits, and each
   * stopped one keeps its slot in it.
   */
  const move = async (habitId: string, direction: "up" | "down") => {
    if (!list) return;
    const order = orderAfterMove(
      list.habits.map((habit) => habit.id),
      movableIds,
      habitId,
      direction
    );
    if (!order) return;
    setMovingId(habitId);
    try {
      writes.land(await writes.order(order));
    } catch (error) {
      toast.error("Could not reorder the habits", { description: error instanceof Error ? error.message : "Something went wrong" });
    } finally {
      setMovingId(null);
    }
  };

  const onAction = (habit: CoachHabit, action: HabitRowAction) => {
    if (action === "move-up" || action === "move-down") void move(habit.id, action === "move-up" ? "up" : "down");
    else rowDialog.show({ kind: action, habit });
  };

  return (
    // Block flow, not space-y: the week-nav divider owns its own mb-3 (12px
    // below); a space-y margin would collapse against it.
    <div>
      {/* The summary — hero first, like every other tab (mb-4 = the divider
          spec's 16px above) */}
      <div className="mb-4">
        <HabitsStatBand week={currentWeek} list={list} weekPending={currentLoading} listPending={listLoading} />
      </div>

      {/* Week-nav divider: the week left in the label slot, + Add habits right */}
      <HabitsWeekNav
        weekStart={weekStart}
        weekEnd={weekEnd}
        canPrev={weekStart !== null}
        canNext={weekStart !== null && clientToday !== null}
        onPrev={() => page(-1)}
        onNext={() => page(1)}
        actions={
          // A word-only interactive rail action, so it takes the rail's own
          // register: LABEL_CLASS at 11px with the teal hover — the shape of
          // the drop-set editor's "Add drop" and the calendar's Today jump
          // (docs/newdesignsystem.md: rail uppercase is reserved for
          // interactive options). py-0.5 keeps the row at its 24.5px.
          <button
            type="button"
            onClick={() => {
              setAddKey((key) => key + 1);
              setAddOpen(true);
            }}
            disabled={!list || moving}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap py-0.5",
              LABEL_CLASS,
              "text-[11px] transition-colors hover:text-[#0d9488] disabled:pointer-events-none disabled:opacity-50"
            )}
          >
            <Plus className="h-3 w-3" strokeWidth={1.5} />
            Add habits
          </button>
        }
      />

      {listError || weekError ? (
        <div className="bg-white rounded-[6px] p-5">
          <div className="h-24 flex items-center justify-center">
            <HabitLoadError message="Failed to load habits" onRetry={retry} />
          </div>
        </div>
      ) : (
        <HabitsWeekTracker
          rows={rows}
          weekDays={week?.dates ?? []}
          today={clientToday ?? ""}
          movableIds={movableIds}
          movingId={movingId}
          onAction={onAction}
          onDay={(habit, day) => dayDialog.show({ habit, day })}
        />
      )}

      {list && (
        <>
          <AddHabitsSheet
            key={`add-habits-${addKey}`}
            open={addOpen}
            onOpenChange={setAddOpen}
            clientId={client.id}
            clientToday={list.clientToday}
            writes={writes}
          />
          <HabitRowDialogs
            subject={rowDialog.subject}
            open={rowDialog.open}
            openKey={rowDialog.openKey}
            clientToday={list.clientToday}
            writes={writes}
            onClose={rowDialog.close}
          />
        </>
      )}
      {dayDialog.subject && (
        <HabitDayDialog
          key={`habit-day-${dayDialog.openKey}`}
          open={dayDialog.open}
          subject={dayDialog.subject}
          writes={writes}
          onOpenChange={(next) => {
            if (!next) dayDialog.close();
          }}
        />
      )}
    </div>
  );
};
