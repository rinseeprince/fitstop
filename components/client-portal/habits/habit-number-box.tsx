"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { MONO_INPUT_CLASS, TEXT_SECONDARY } from "@/components/clients/training/program-builder/builder-tokens";
import { parseHabitAmount } from "@/lib/habits/habit-amount";
import { cn } from "@/lib/utils";

interface HabitNumberBoxProps {
  /** The box's id, which the row's name labels. */
  id: string;
  /** The number the day's entry holds, or null. */
  value: number | null;
  /** The coach's word for the unit, shown as typed and never converted. */
  unit: string | null;
  disabled: boolean;
  /** The number the client left in the box, or null for a box emptied (the entry cleared). */
  onCommit: (value: number | null) => void;
  /** A box that does not hold a number: the reason, in plain words. */
  onInvalid: (reason: string) => void;
}

/**
 * A number habit's box on the habits page: the client's number for the day,
 * with the coach's unit beside it. It saves when the client leaves the box or
 * presses Enter, which keeps the box focused; an emptied box clears the
 * entry; an untouched box writes nothing, because its seed decides. A box
 * that does not hold a number keeps what was typed, is marked, and says why
 * (CONVENTIONS §20, "Reading and writing a box").
 *
 * The box holds what the client is typing beside the number it was given
 * (its seed). When the day's number moves — a save landing, a refusal, a
 * fresh read — a box still reading its seed follows the new number, and a
 * box being typed in keeps what is typed: the box is never remounted, so
 * neither a landing nor a refusal takes the focus or a number half typed.
 */
export function HabitNumberBox({ id, value, unit, disabled, onCommit, onInvalid }: HabitNumberBoxProps) {
  const seed = value === null ? "" : String(value);
  const [box, setBox] = useState({ seed, text: seed, invalid: false });
  if (box.seed !== seed) {
    const untouched = box.text === box.seed;
    setBox({ seed, text: untouched ? seed : box.text, invalid: untouched ? false : box.invalid });
  }

  const commit = () => {
    const typed = box.text.trim();
    // An untouched box writes nothing, and a box already refused says so once.
    if (typed === box.seed || box.invalid) return;
    if (typed === "") {
      onCommit(null);
      return;
    }
    const parsed = parseHabitAmount(typed);
    if ("error" in parsed) {
      setBox({ ...box, invalid: true });
      onInvalid(parsed.error);
      return;
    }
    onCommit(parsed.value);
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Input
        id={id}
        inputMode="decimal"
        value={box.text}
        onChange={(event) => setBox({ ...box, text: event.target.value, invalid: false })}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        disabled={disabled}
        aria-invalid={box.invalid || undefined}
        className={cn("h-9 w-20", MONO_INPUT_CLASS)}
      />
      {unit ? <span className={cn("text-[13px]", TEXT_SECONDARY)}>{unit}</span> : null}
    </div>
  );
}
