"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Input } from "@/components/ui/input";
import { FOCUS_RING, TEXT_SECONDARY } from "@/components/clients/training/program-builder/builder-tokens";
import { HABIT_NOTE_MAX } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface HabitNoteProps {
  /** The habit's name, for the note's own names. */
  habitName: string;
  /** The note the day's entry holds, or null. */
  note: string | null;
  /** The day has an answer the note can ride on (a number habit's needs its number first). */
  canAdd: boolean;
  /** The day is locked: a note is shown, never offered or changed. */
  locked: boolean;
  /** The note left in the box, trimmed; null for a box emptied (the note cleared). */
  onCommit: (note: string | null) => void;
  /** A note that cannot be saved yet: the reason, in plain words. */
  onInvalid: (reason: string) => void;
}

/** The note's line: one height whether it holds the box or the button that opens it, so leaving a box never moves the rows below. */
const LINE = "mt-1.5 h-8";

/** Why a note cannot be saved on a day with no answer to ride on. */
const NEEDS_ANSWER = "Add the number first: a note is saved with it.";

/**
 * A habit's note for the day: "Add a note" opens a box, and the note saves
 * when the client leaves it or presses Enter — with the day's answer, since a
 * note belongs to the entry. A note already made shows in its box, changed
 * the same way, and cleared by emptying it. An untouched box writes nothing.
 * On a number habit with no number the button waits, and a note left in a
 * box whose number went is refused out loud, its words kept and marked.
 *
 * The box holds what the client is typing beside the note it was given; a
 * saved note moving under it is followed only while nothing is typed, so the
 * box is never remounted mid-edit. It stands while it is focused, so an entry
 * cleared underneath it never takes the focus away.
 */
export function HabitNote({ habitName, note, canAdd, locked, onCommit, onInvalid }: HabitNoteProps) {
  const seed = note ?? "";
  const [box, setBox] = useState({ seed, text: seed, invalid: false });
  const [open, setOpen] = useState(false);
  if (box.seed !== seed) {
    const untouched = box.text === box.seed;
    setBox({ seed, text: untouched ? seed : box.text, invalid: untouched ? false : box.invalid });
  }

  if (locked) {
    return note ? <p className={cn("mt-2 whitespace-pre-line text-[12px]", TEXT_SECONDARY)}>{note}</p> : null;
  }

  // The box stands while there is a note, while it is being edited, and while
  // it holds words not saved; otherwise the button that opens it.
  if (note === null && !open && box.text.trim() === "") {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!canAdd}
        aria-label={`Add a note to ${habitName}`}
        className={cn(
          LINE,
          "inline-flex items-center gap-1 rounded-[4px] text-[12px] font-medium transition-colors duration-150 hover:text-[#0d9488] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-[#5a7d82]",
          TEXT_SECONDARY,
          FOCUS_RING
        )}
      >
        <Plus className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
        Add a note
      </button>
    );
  }

  const commit = () => {
    setOpen(false);
    const typed = box.text.trim();
    if (typed === box.seed || box.invalid) return;
    if (!canAdd) {
      setBox({ ...box, invalid: true });
      onInvalid(NEEDS_ANSWER);
      return;
    }
    onCommit(typed === "" ? null : typed);
  };

  return (
    <Input
      aria-label={`Note for ${habitName}`}
      value={box.text}
      onChange={(event) => setBox({ ...box, text: event.target.value, invalid: false })}
      onFocus={() => setOpen(true)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      maxLength={HABIT_NOTE_MAX}
      // Opened by "Add a note": the client is about to type into it.
      autoFocus={open && note === null}
      aria-invalid={box.invalid || undefined}
      placeholder="Add a note"
      className={cn(LINE, "bg-white text-[12px]")}
    />
  );
}
