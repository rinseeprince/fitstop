"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Plus, ListChecks, X } from "lucide-react";
import { toast } from "sonner";
import { HabitListItem } from "./habit-list-item";
import { AddHabitInlineForm } from "./add-habit-inline-form";
import { HabitConfirmDialog, type HabitConfirmSubject } from "./habit-confirm-dialog";
import type { HabitEditMode } from "./edit-habit-inline";
import { orderAfterMove } from "./habit-order";
import { LibrarySearchInput } from "@/components/programs/shared/library-search-input";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { DAYS_OF_WEEK } from "@/utils/nutrition-helpers";
import type { HabitWrites, NewHabit } from "@/hooks/use-client-habits";
import type { CoachHabit, CoachHabitList, HabitVersion } from "@/types/habits";

type HabitsManageDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client's habits — running, upcoming and stopped — in their order. */
  list: CoachHabitList;
  writes: HabitWrites;
};

/** The error a failed write shows: the server's own sentence. */
const reason = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong");

export function HabitsManageDrawer({ open, onOpenChange, list, writes }: HabitsManageDrawerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  // The habit whose row is a form, and why.
  const [editing, setEditing] = useState<{ habitId: string; mode: HabitEditMode } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [movingHabitId, setMovingHabitId] = useState<string | null>(null);
  const confirmDialog = useDialogSubject<HabitConfirmSubject>();

  const habits = list.habits;
  const found = searchQuery
    ? habits.filter((habit) => habit.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : habits;
  // The running and upcoming habits first, then the stopped ones, each in the
  // client's order. Only the first group moves, within itself, so a row's
  // index is its place in that group.
  const movable = found.filter((habit) => habit.status !== "stopped");
  const shownHabits = [...movable, ...found.filter((habit) => habit.status === "stopped")];

  const add = async (habit: NewHabit) => {
    const answer = await writes.add([habit]);
    writes.land(answer.habits);
    setShowAddForm(false);
    toast.success(`"${habit.name}" added`);
  };

  /**
   * A move among the running and upcoming habits shown, sent as the WHOLE
   * list: the order route names every one of the client's habits, and each
   * stopped or hidden one keeps its slot in it.
   */
  const move = async (habitId: string, direction: "up" | "down") => {
    const order = orderAfterMove(
      habits.map((habit) => habit.id),
      movable.map((habit) => habit.id),
      habitId,
      direction
    );
    if (!order) return;
    setMovingHabitId(habitId);
    try {
      writes.land((await writes.order(order)).habits);
    } catch (error) {
      toast.error("Could not reorder the habits", { description: reason(error) });
    } finally {
      setMovingHabitId(null);
    }
  };

  /**
   * A stopped habit started again from today with its last target and days.
   * One stopped on its first day has no version left: a tick habit starts
   * again every day; a number habit needs a target first, so its form opens
   * with the Target box empty.
   */
  const startAgain = async (habit: CoachHabit) => {
    const last: HabitVersion | undefined = habit.versions[habit.versions.length - 1];
    if (!last && habit.measure === "number") {
      setEditing({ habitId: habit.id, mode: "start-again" });
      return;
    }
    try {
      const answer = await writes.change(
        habit.id,
        last
          ? {
              target: last.target,
              ...(last.timesPerWeek !== null ? { timesPerWeek: last.timesPerWeek } : { weekdays: last.weekdays }),
            }
          : { target: null, weekdays: [...DAYS_OF_WEEK] }
      );
      writes.land(answer.habits);
      toast.success(`"${habit.name}" started again`, { description: "It runs from today." });
    } catch (error) {
      toast.error("Could not start the habit again", { description: reason(error) });
    }
  };

  /** The confirm's yes: its answer landed and the confirm closed together; a refusal leaves it open. */
  const confirm = async (subject: HabitConfirmSubject) => {
    const answer = subject.kind === "stop" ? await writes.stop(subject.habit.id) : await writes.remove(subject.habit.id);
    writes.land(answer.habits);
    confirmDialog.close();
    if (subject.kind === "stop") toast.success(`"${subject.habit.name}" stopped`, { description: "Its past stays." });
    else toast.success(`"${subject.habit.name}" deleted`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        overlayClassName="bg-[rgba(15,32,39,0.35)] backdrop-blur-[2px]"
        // The nutrition plan tray's width (nutrition-settings-drawer.tsx): the
        // same w-[420px] under the sheet's own cap on a right-hand panel
        // (sm:max-w-sm, sheet.tsx), left in place, so both render 384px on a
        // desktop screen.
        className="w-[420px] bg-[#f4f7f6] p-0 gap-0 flex flex-col inset-y-0 right-0 h-full [&>[data-slot=sheet-close]]:hidden animate-drawer-slide-in data-[state=closed]:slide-out-to-right data-[state=closed]:duration-300"
      >
        {/* Visually hidden title for accessibility */}
        <SheetHeader className="sr-only">
          <SheetTitle>Manage Habits</SheetTitle>
        </SheetHeader>

        {/* Dark header */}
        <div className="bg-[#0f2027] px-6 pt-5 pb-5 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-[28px] h-[28px] rounded-[6px] bg-[rgba(13,148,136,0.15)] flex items-center justify-center flex-shrink-0">
              <ListChecks className="w-[15px] h-[15px] text-[#0d9488]" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[16px] font-bold text-white leading-tight">
                Manage Habits
              </h2>
              <p className="text-[12px] text-[rgba(255,255,255,0.4)] mt-1 leading-[1.4]">
                Add, edit, stop and reorder your client&apos;s habits.
              </p>
            </div>
            <SheetClose className="w-[32px] h-[32px] rounded-[6px] bg-[rgba(255,255,255,0.06)] flex items-center justify-center flex-shrink-0 hover:bg-[rgba(255,255,255,0.1)] transition-colors">
              <X className="w-4 h-4 text-[rgba(255,255,255,0.5)]" strokeWidth={1.5} />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pt-5 pb-20 space-y-3">
          {/* Search */}
          <LibrarySearchInput
            size="panel"
            fill="page"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search habits"
          />

          {/* Add button / inline form */}
          {showAddForm ? (
            <AddHabitInlineForm onSubmit={add} onCancel={() => setShowAddForm(false)} />
          ) : (
            <Button
              onClick={() => setShowAddForm(true)}
              className="w-full bg-[#0d9488] hover:bg-[#0f766e] text-white text-[12px] font-medium"
              size="sm"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={2} />
              Add Habit
            </Button>
          )}

          {/* Habit list */}
          {shownHabits.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[13px] text-[#93b0b4]">
                {searchQuery ? "No habits match your search" : "No habits yet. Add one above."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {shownHabits.map((habit, index) => (
                <HabitListItem
                  key={habit.id}
                  habit={habit}
                  clientToday={list.clientToday}
                  editMode={editing?.habitId === habit.id ? editing.mode : null}
                  canMoveUp={index > 0 && index < movable.length && movingHabitId === null}
                  canMoveDown={index < movable.length - 1 && movingHabitId === null}
                  writes={writes}
                  onEdit={() => setEditing({ habitId: habit.id, mode: "edit" })}
                  onCloseEdit={() => setEditing(null)}
                  onStop={() => confirmDialog.show({ kind: "stop", habit })}
                  onDelete={() => confirmDialog.show({ kind: "delete", habit })}
                  onStartAgain={() => startAgain(habit)}
                  onMoveUp={() => move(habit.id, "up")}
                  onMoveDown={() => move(habit.id, "down")}
                />
              ))}
            </div>
          )}
        </div>

        {/* Hosted inside the sheet's content: a dialog over a modal sheet
            lives inside it (Radix layer order). */}
        <HabitConfirmDialog
          key={`habit-confirm-${confirmDialog.openKey}`}
          open={confirmDialog.open}
          subject={confirmDialog.subject}
          onOpenChange={(next) => {
            if (!next) confirmDialog.close();
          }}
          onConfirm={confirm}
        />
      </SheetContent>
    </Sheet>
  );
}
