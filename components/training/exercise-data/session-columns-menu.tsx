"use client";

import { Columns3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  LABEL_CLASS,
  TEXT_MUTED,
} from "@/components/clients/training/program-builder/builder-tokens";
import {
  SESSION_COLUMN_GROUPS,
  SESSION_COLUMN_SPECS,
  type SessionColumn,
} from "@/utils/exercise-session-columns";

// The Sessions table's Columns menu, the coach's alone: the builder's column
// selector recipe (program-builder/set-columns-menu.tsx) without its presets —
// every column the window's sessions recorded, grouped Strength, Endurance and
// Framework, each ticked on and off. It only changes what the table shows;
// Date is the row itself and always shows. The menu stays open across ticks.

type SessionColumnsMenuProps = {
  /** The columns the window recorded, in the table's order. */
  columns: readonly SessionColumn[];
  hidden: ReadonlySet<SessionColumn>;
  onToggle: (column: SessionColumn) => void;
  /** Settled with nothing recorded: there is nothing to tick. */
  disabled: boolean;
};

const GROUP_LABEL_CLASS = cn(LABEL_CLASS, "px-2.5 pb-1 pt-2");

// By how many groups the window recorded: one column of ticks per group
const GRID_BY_GROUPS = ["grid-cols-1", "grid-cols-1", "grid-cols-2", "grid-cols-3"] as const;
const WIDTH_BY_GROUPS = ["w-44", "w-44", "w-[320px]", "w-[460px]"] as const;

export function SessionColumnsMenu({ columns, hidden, onToggle, disabled }: SessionColumnsMenuProps) {
  const groups = SESSION_COLUMN_GROUPS.map((group) => ({
    ...group,
    columns: columns.filter((column) => SESSION_COLUMN_SPECS[column].group === group.key),
  })).filter((group) => group.columns.length > 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Columns for the sessions table"
          title="Columns"
          disabled={disabled}
          className={cn(
            "rounded p-1 transition-colors hover:text-[#0d9488] disabled:cursor-default disabled:text-[#d5e0dd] data-[state=open]:text-[#0d9488]",
            TEXT_MUTED,
            FOCUS_RING,
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
          WIDTH_BY_GROUPS[groups.length],
        )}
      >
        <DropdownMenuLabel className="pb-0">Columns</DropdownMenuLabel>
        <div className={cn("grid gap-x-1", GRID_BY_GROUPS[groups.length])}>
          {groups.map((group) => (
            <DropdownMenuGroup key={group.key}>
              <div className={GROUP_LABEL_CLASS}>{group.label}</div>
              {group.columns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={!hidden.has(column)}
                  onSelect={(e) => {
                    // Stays open, so several columns can be set in one go
                    e.preventDefault();
                    onToggle(column);
                  }}
                >
                  {SESSION_COLUMN_SPECS[column].label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
