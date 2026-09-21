"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";

type RailDropdownOption = { value: string; label: string };

type RailDropdownProps = {
  /** The trigger's words: the current value, sentence case. */
  label: string;
  options: readonly RailDropdownOption[];
  /** The selected option, ticked in the menu. */
  value: string;
  onChange: (value: string) => void;
  /** Lay the options out two to a row — pairs, like a sort's "Heaviest" and "Lightest". */
  pairs?: boolean;
};

// The design system's rail dropdown (docs/newdesignsystem.md → "Rail
// dropdown"): a value picker mounted on a divider rail. A sentence-case trigger
// reading the current value — mixed casing survives (e1RM, % FTP), and it never
// reads as one of the rail's uppercase text actions — opening the styled
// DropdownMenu with the teal tick on the selected option. The trigger's
// accessible name IS its value, so it carries no aria-label. A pick closes the
// menu, which is the menu's own open state.
export function RailDropdown({ label, options, value, onChange, pairs = false }: RailDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] px-2 py-1 text-[11px] font-medium text-[#93b0b4] transition-colors hover:text-[#0d9488] data-[state=open]:bg-[rgba(13,148,136,0.05)] data-[state=open]:text-[#0d9488]",
            FOCUS_RING,
          )}
        >
          {label}
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className={cn(pairs && "w-[320px]")}>
        <div className={cn(pairs && "grid grid-cols-2")}>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={option.value === value}
              onSelect={() => onChange(option.value)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
