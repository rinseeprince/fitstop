"use client";

import { Columns3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  PRESCRIBED_FIELDS,
  type PrescribedField,
} from "@/utils/prescribed-fields";
import { TEXT_MUTED } from "./builder-tokens";

// Which prescription columns this exercise uses. Per EXERCISE, not per coach or
// per session: a heavy compound wants load and RPE, a high-rep accessory wants
// reps and rest and nothing else.
//
// This is not a display preference. Unticking a column stops the CLIENT app
// rendering it, so it stops collecting that data — which is why unticking Load
// ends an exercise's strength history and why the last column cannot be
// unticked. Values already entered are untouched and return intact when the
// column is re-shown.
//
// Built from the styled DropdownMenu primitives rather than a Popover with
// checkboxes: DropdownMenuCheckboxItem already carries the teal tick, the 6px
// panel and the disabled treatment, and components/ui/checkbox.tsx is still
// un-migrated OKLCH.
const FIELD_LABELS: Record<PrescribedField, string> = {
  set_type: "Set type",
  reps: "Reps",
  load: "Load",
  rpe: "RPE",
  rest: "Rest",
};

type SetColumnsMenuProps = {
  fields: ReadonlySet<PrescribedField>;
  exerciseName: string;
  onChange: (next: PrescribedField[] | null) => void;
};

export function SetColumnsMenu({
  fields,
  exerciseName,
  onChange,
}: SetColumnsMenuProps) {
  const showingAll = fields.size === PRESCRIBED_FIELDS.length;

  const toggle = (field: PrescribedField) => {
    const next = PRESCRIBED_FIELDS.filter((f) =>
      f === field ? !fields.has(f) : fields.has(f),
    );
    // All five is stored as null, not an exhaustive list — null is what every
    // pre-149 row carries and what a forgetful write path produces, so the two
    // must not be distinguishable.
    onChange(next.length === PRESCRIBED_FIELDS.length ? null : next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Columns for ${exerciseName}`}
          title="Columns"
          className={cn(
            "rounded p-1 transition-colors hover:text-[#0d9488] data-[state=open]:text-[#0d9488]",
            TEXT_MUTED,
          )}
        >
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-56">
        <DropdownMenuLabel className="pb-0">Columns</DropdownMenuLabel>
        <p className="px-2 pb-1.5 text-[11px] text-[#93b0b4]">
          What your client sees and fills in
        </p>
        {PRESCRIBED_FIELDS.map((field) => {
          const checked = fields.has(field);
          // The grid must always keep one column; an exercise prescribing
          // nothing is refused by the migration-149 CHECK too.
          const isLastRemaining = checked && fields.size === 1;
          return (
            <DropdownMenuCheckboxItem
              key={field}
              checked={checked}
              disabled={isLastRemaining}
              title={isLastRemaining ? "Keep at least one column" : undefined}
              onSelect={(e) => {
                // Keep the menu open so several columns can be set in one go.
                e.preventDefault();
                if (!isLastRemaining) toggle(field);
              }}
            >
              {FIELD_LABELS[field]}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={showingAll}
          onSelect={(e) => {
            e.preventDefault();
            onChange(null);
          }}
        >
          Show all columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
