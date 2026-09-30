"use client";

import { HabitDeleteDialog } from "./habit-delete-dialog";
import { HabitHistoryDialog } from "./habit-history-dialog";
import { HabitRenameDialog } from "./habit-rename-dialog";
import { HabitScheduleDialog } from "./habit-schedule-dialog";
import { HabitStopDialog } from "./habit-stop-dialog";
import type { HabitWrites } from "@/hooks/use-client-habits";
import type { CoachHabit } from "@/types/habits";

/** The row dialog a ⋯ opened, and the habit it is about as the row showed it. */
export type HabitRowDialogSubject = {
  kind: "change" | "start-again" | "stop" | "rename" | "history" | "delete";
  habit: CoachHabit;
};

/**
 * The one row dialog open at a time, from the ⋯ of a habit's row. One owner
 * (`useDialogSubject`): a close flips `open` and leaves the subject, so the
 * closing card shows what it showed; each open is keyed afresh, so its fields
 * start from the habit as it stands (CONVENTIONS §7 → "No frame disagrees").
 */
export function HabitRowDialogs({
  subject,
  open,
  openKey,
  clientToday,
  writes,
  onClose,
}: {
  subject: HabitRowDialogSubject | null;
  open: boolean;
  openKey: number;
  clientToday: string;
  writes: HabitWrites;
  onClose: () => void;
}) {
  if (!subject) return null;
  const { kind, habit } = subject;
  const key = `habit-${kind}-${openKey}`;
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  switch (kind) {
    case "change":
    case "start-again":
      return (
        <HabitScheduleDialog
          key={key}
          open={open}
          habit={habit}
          mode={kind}
          clientToday={clientToday}
          writes={writes}
          onOpenChange={onOpenChange}
        />
      );
    case "stop":
      return <HabitStopDialog key={key} open={open} habit={habit} clientToday={clientToday} writes={writes} onOpenChange={onOpenChange} />;
    case "rename":
      return <HabitRenameDialog key={key} open={open} habit={habit} writes={writes} onOpenChange={onOpenChange} />;
    case "history":
      return <HabitHistoryDialog key={key} open={open} habit={habit} clientToday={clientToday} onOpenChange={onOpenChange} />;
    case "delete":
      return <HabitDeleteDialog key={key} open={open} habit={habit} writes={writes} onOpenChange={onOpenChange} />;
  }
}
