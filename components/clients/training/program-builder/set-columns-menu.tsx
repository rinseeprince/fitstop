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
  DEFAULT_PRESCRIBED_FIELDS,
  PRESCRIBED_FIELD_LABELS,
  PRESCRIBED_FIELDS,
  type PrescribedField,
} from "@/utils/prescribed-fields";
import { TEXT_MUTED } from "./builder-tokens";

// Which measurement columns this exercise uses. Per EXERCISE, not per coach or
// per session: a heavy compound wants load and RPE, a high-rep accessory wants
// reps and rest and nothing else.
//
// This is not a display preference. Unticking a column stops the CLIENT app
// rendering it, so it stops collecting that data — which is why unticking Load
// ends an exercise's strength history and why an exercise's last column cannot
// be unticked. Values already entered are untouched and return intact when the
// column is re-shown.
//
// The menu offers today's five columns; commit 12's selector offers every
// column with presets. A column the menu doesn't offer — an endurance column
// the exercise already carries — is kept exactly as it is by every tick here.
//
// Built from the styled DropdownMenu primitives rather than a Popover with
// checkboxes: DropdownMenuCheckboxItem already carries the teal tick, the 6px
// panel and the disabled treatment, and components/ui/checkbox.tsx is still
// un-migrated OKLCH.
const OFFERED: readonly PrescribedField[] = DEFAULT_PRESCRIBED_FIELDS;

// The order a stored list takes: the offered five as they read in the menu,
// then every other column in the canonical order.
const STORED_ORDER: readonly PrescribedField[] = [
  ...OFFERED,
  ...PRESCRIBED_FIELDS.filter((field) => !OFFERED.includes(field)),
];

type SetColumnsMenuProps = {
  fields: ReadonlySet<PrescribedField>;
  // Columns that don't apply where the exercise sits and so aren't offered —
  // Rest in a superset or circuit, whose rests are the group's. Their stored
  // choice is kept, not changed, by the columns ticked here.
  hiddenFields?: readonly PrescribedField[];
  exerciseName: string;
  onChange: (next: PrescribedField[]) => void;
};

export function SetColumnsMenu({
  fields,
  hiddenFields = [],
  exerciseName,
  onChange,
}: SetColumnsMenuProps) {
  const offered = OFFERED.filter((field) => !hiddenFields.includes(field));
  const showingAll = offered.every((field) => fields.has(field));

  const toggle = (field: PrescribedField) => {
    onChange(
      STORED_ORDER.filter((f) => (f === field ? !fields.has(f) : fields.has(f))),
    );
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
        {offered.map((field) => {
          const checked = fields.has(field);
          // The exercise must always keep one column; an exercise prescribing
          // nothing is refused by the migration-183 CHECK too.
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
              {PRESCRIBED_FIELD_LABELS[field]}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={showingAll}
          onSelect={(e) => {
            e.preventDefault();
            onChange(
              STORED_ORDER.filter((f) => offered.includes(f) || fields.has(f)),
            );
          }}
        >
          Show all columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
