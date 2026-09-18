"use client";

import { Columns3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  COLUMN_GROUPS,
  COLUMN_PRESET_LABELS,
  COLUMN_PRESETS,
  describePresetColumns,
  orderColumns,
  type ColumnsPreset,
} from "@/utils/column-presets";
import { PRESCRIBED_FIELD_LABELS, type PrescribedField } from "@/utils/prescribed-fields";
import { LABEL_CLASS, TEXT_MUTED } from "./builder-tokens";

// Which measurement columns an exercise uses — the column selector
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4): the presets first,
// then every column grouped as Strength, Endurance and Framework, each ticked
// or unticked freely. Per EXERCISE, not per coach or per session: a heavy
// compound wants load and RPE, a run wants distance, duration and pace.
//
// This is not a display preference. Unticking a column stops the CLIENT app
// rendering it, so it stops collecting that data — which is why unticking Load
// ends an exercise's strength history and why an exercise's last column cannot
// be unticked. Values already entered are untouched and return intact when the
// column is re-shown.
//
// A preset is a starting point: it sets the exercise's columns to exactly its
// own (utils/column-presets.ts). On a linked group's heading the same menu
// offers the presets alone, and a pick applies to every exercise in the group.
// A column the selector doesn't offer where the exercise sits — Rest in a
// superset or circuit, whose rests are the group's — keeps its stored choice
// through every tick and every preset. The preset the exercise is on — on a
// group, the one every exercise is on — carries the tick, so a pick made while
// the cards are collapsed is confirmed in the menu itself (owner, 2026-09-18).
//
// Built from the styled DropdownMenu primitives rather than a Popover with
// checkboxes: DropdownMenuCheckboxItem already carries the teal tick, the 6px
// panel and the disabled treatment, and components/ui/checkbox.tsx is still
// un-migrated OKLCH. The menu stays open across ticks and presets so several
// columns can be set in one go.
type SetColumnsMenuProps = {
  /**
   * The exercise's columns. Absent for a linked group's heading, where the
   * menu offers the presets alone.
   */
  fields?: ReadonlySet<PrescribedField>;
  // Columns that don't apply where the exercise sits and so aren't offered —
  // Rest in a superset or circuit. Their stored choice is kept, not changed.
  hiddenFields?: readonly PrescribedField[];
  /** The preset the columns are on (`presetOf`; a group's, `groupColumnsPreset`), ticked; null for none. */
  activePreset: ColumnsPreset | null;
  /** What the menu is for, in its accessible name: "Bench Press", "the superset". */
  subject: string;
  onChange?: (next: PrescribedField[]) => void;
  onPreset: (preset: ColumnsPreset) => void;
};

const GROUP_LABEL_CLASS = cn(LABEL_CLASS, "px-2.5 pb-1 pt-2");

export function SetColumnsMenu({
  fields,
  hiddenFields = [],
  activePreset,
  subject,
  onChange,
  onPreset,
}: SetColumnsMenuProps) {
  const forGroup = fields === undefined;

  const toggle = (field: PrescribedField) => {
    if (!fields || !onChange) return;
    const next = new Set(fields);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    onChange(orderColumns(next));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Columns for ${subject}`}
          title="Columns"
          className={cn(
            "rounded p-1 transition-colors hover:text-[#0d9488] data-[state=open]:text-[#0d9488]",
            TEXT_MUTED,
          )}
        >
          <Columns3 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className={cn(
          "max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto",
          forGroup ? "w-64" : "w-[460px]",
        )}
      >
        <DropdownMenuLabel className="pb-0">Columns</DropdownMenuLabel>
        <p className="px-2 pb-1 text-[11px] text-[#93b0b4]">
          {forGroup
            ? `A preset sets every exercise in ${subject}`
            : "What your client sees and fills in"}
        </p>

        <DropdownMenuGroup>
          <div className={GROUP_LABEL_CLASS}>Presets</div>
          <div className={cn("grid", forGroup ? "grid-cols-1" : "grid-cols-4")}>
            {COLUMN_PRESETS.map((preset) => (
              // The preset the columns are on is ticked; picking it again
              // changes nothing.
              <DropdownMenuCheckboxItem
                key={preset}
                checked={preset === activePreset}
                title={describePresetColumns(preset)}
                onSelect={(e) => {
                  // Keep the menu open so the ticks the preset set can be
                  // adjusted in the same go.
                  e.preventDefault();
                  onPreset(preset);
                }}
              >
                {COLUMN_PRESET_LABELS[preset]}
              </DropdownMenuCheckboxItem>
            ))}
          </div>
        </DropdownMenuGroup>

        {fields && (
          <>
            <DropdownMenuSeparator />
            <div className="grid grid-cols-3 gap-x-1">
              {COLUMN_GROUPS.map((group) => (
                <DropdownMenuGroup key={group.key}>
                  <div className={GROUP_LABEL_CLASS}>{group.label}</div>
                  {group.fields
                    .filter((field) => !hiddenFields.includes(field))
                    .map((field) => {
                      const checked = fields.has(field);
                      // The exercise must always keep one column; an exercise
                      // prescribing nothing is refused by the migration-183
                      // CHECK too.
                      const isLastRemaining = checked && fields.size === 1;
                      return (
                        <DropdownMenuCheckboxItem
                          key={field}
                          checked={checked}
                          disabled={isLastRemaining}
                          title={isLastRemaining ? "Keep at least one column" : undefined}
                          onSelect={(e) => {
                            e.preventDefault();
                            if (!isLastRemaining) toggle(field);
                          }}
                        >
                          {PRESCRIBED_FIELD_LABELS[field]}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                </DropdownMenuGroup>
              ))}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
