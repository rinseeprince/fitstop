"use client";

import { Check } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import { cn } from "@/lib/utils";
import { habitRowWords, habitWeekWords, noteAnswer, type HabitGroupKey } from "./habit-day-groups";
import { HabitNote } from "./habit-note";
import { HabitNumberBox } from "./habit-number-box";
import type { ClientHabitDayItem, HabitAnswer } from "@/types/habits";

interface HabitEntryRowProps {
  item: ClientHabitDayItem;
  group: HabitGroupKey;
  /** The client's today: a week holding it reads "this week", any other "that week". */
  today: string;
  /** The day is locked: the row is display-only. */
  locked: boolean;
  /** The day's answer: a tick habit's done or not, a number habit's number. */
  onAnswer: (answer: HabitAnswer) => void;
  /** A number habit's box emptied: the entry goes, its note with it. */
  onClear: () => void;
  /** The note left in its box, saved with the answer the day shows; null clears it. */
  onNote: (answer: HabitAnswer, note: string | null) => void;
  /** A box that does not hold a number, or a note with no answer to ride on: the reason, in plain words. */
  onInvalid: (reason: string) => void;
}

/**
 * One habit on the client's habits page (§2.5): its name and the day's entry
 * — a tick, or a number box with the coach's unit — then the coach's how-to
 * when there is one, its words (the day's target, and on a day it is not
 * planned, the days it is) beside its week's figure, and its note. A number
 * habit's name carries a check once the day's target is met; a tick habit's
 * tick says so itself. Each control saves on its own — a tick at once, a
 * number or a note when the client leaves its box or presses Enter — and
 * stays usable while an earlier save is on its way: the habit's writes go one
 * after another. Nothing on the row changes height as a box is left, so a tap
 * on the row below lands where it was aimed.
 */
export function HabitEntryRow({ item, group, today, locked, onAnswer, onClear, onNote, onInvalid }: HabitEntryRowProps) {
  const { habit, day } = item;
  const controlId = `habit-${habit.id}`;
  const words = habitRowWords(item, group);
  const answer = noteAnswer(item);

  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <label htmlFor={controlId} className={cn("truncate text-[13.5px] font-semibold", TEXT_PRIMARY)}>
            {habit.name}
          </label>
          {habit.measure === "number" && day.met ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-[#0d9488]" strokeWidth={1.5} role="img" aria-label="Done" />
          ) : null}
        </div>
        {habit.measure === "tick" ? (
          <Checkbox
            id={controlId}
            checked={day.entry?.done === true}
            onCheckedChange={(checked) => onAnswer({ done: checked === true })}
            disabled={locked}
            className="size-5"
          />
        ) : (
          <HabitNumberBox
            id={controlId}
            value={day.entry?.value ?? null}
            unit={habit.unit}
            disabled={locked}
            onCommit={(value) => (value === null ? onClear() : onAnswer({ value }))}
            onInvalid={onInvalid}
          />
        )}
      </div>
      {habit.howTo ? <p className={cn("mt-0.5 whitespace-pre-line text-[12px]", TEXT_MUTED)}>{habit.howTo}</p> : null}
      <div className="mt-1 flex items-baseline justify-between gap-3 text-[12px]">
        <span className={cn("min-w-0", TEXT_SECONDARY)}>{words}</span>
        {/* Words and numbers woven into one line read as a sentence: all sans. */}
        <span className={cn("shrink-0", TEXT_MUTED)}>{habitWeekWords(item, today)}</span>
      </div>
      <HabitNote
        habitName={habit.name}
        note={day.entry?.note ?? null}
        canAdd={answer !== null}
        locked={locked}
        onCommit={(note) => {
          // The note offers itself only while there is an answer to ride on.
          if (answer) onNote(answer, note);
        }}
        onInvalid={onInvalid}
      />
    </div>
  );
}
