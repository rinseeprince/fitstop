"use client";

import { useState } from "react";
import { Check } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseHabitAmount } from "@/lib/habits/habit-amount";
import type { ClientHabitDayItem } from "@/types/habits";

interface HabitNumberRowProps {
  /**
   * A number habit on the day: its entry is the number the client entered.
   * The host keys the row by that entry, so an answer that changes it mounts
   * the box fresh on the new number.
   */
  item: ClientHabitDayItem;
  /** A write for this habit is in flight. */
  isSaving: boolean;
  /** The day is locked: the row is display-only. */
  disabled?: boolean;
  /** The number the client left in the box, or null for an emptied box (the entry cleared). */
  onCommit: (value: number | null) => Promise<void>;
  /** A box that does not hold a number: the reason, in plain words. */
  onInvalid: (reason: string) => void;
}

/**
 * A number habit's row on the client-portal habits page: its name and the
 * day's target in words ("at least 3 L"), a box taking the number with the
 * coach's unit beside it — as typed, never converted — and a check when the
 * day's target is met. The number saves when the client leaves the box, or
 * presses Enter; an emptied box clears the entry; an untouched box writes
 * nothing (its seed decides).
 */
export function HabitNumberRow({ item, isSaving, disabled, onCommit, onInvalid }: HabitNumberRowProps) {
  const { habit, day, words } = item;
  const seed = day.entry?.value == null ? "" : String(day.entry.value);
  const [text, setText] = useState(seed);

  const commit = async () => {
    const typed = text.trim();
    if (typed === seed) return;
    if (typed === "") {
      if (day.entry) await onCommit(null);
      return;
    }
    const parsed = parseHabitAmount(typed);
    if ("error" in parsed) {
      onInvalid(parsed.error);
      return;
    }
    await onCommit(parsed.value);
  };

  return (
    <div className={`flex items-center justify-between gap-3 ${disabled ? "opacity-40" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Label htmlFor={`habit-${habit.id}`} className="text-sm font-normal">
            {habit.name}
          </Label>
          {day.met ? <Check className="h-4 w-4 text-success" aria-label="Done" /> : null}
        </div>
        {words.target ? <p className="text-xs text-muted-foreground">{words.target}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          id={`habit-${habit.id}`}
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          disabled={isSaving || disabled}
          className="h-9 w-24 text-right"
        />
        {habit.unit ? <span className="text-sm text-muted-foreground">{habit.unit}</span> : null}
      </div>
    </div>
  );
}
