"use client";

import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ExerciseMetric =
  | "weight"
  | "e1rm"
  | "volume"
  | "rpe"
  | "compliance"
  | "prs";

export const METRIC_OPTIONS: { value: ExerciseMetric; label: string }[] = [
  { value: "weight", label: "Weight" },
  { value: "e1rm", label: "e1RM" },
  { value: "volume", label: "Volume" },
  { value: "rpe", label: "RPE" },
  { value: "compliance", label: "Compliance" },
  { value: "prs", label: "PRs" },
];

type ExerciseMetricSelectProps = {
  value: ExerciseMetric;
  onChange: (value: ExerciseMetric) => void;
};

// The divider rail's rightmost action: a dropdown trigger at the rail
// text-action scale (sentence case + chevron — sentence case also preserves
// the e1RM/PRs casing), fitting the 24.5px row. The trigger's accessible name
// is its content (the active metric), mirroring the exercise combobox.
export function ExerciseMetricSelect({
  value,
  onChange,
}: ExerciseMetricSelectProps) {
  const selected = METRIC_OPTIONS.find((m) => m.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium text-[#93b0b4] transition-colors hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0d9488] data-[state=open]:bg-[rgba(13,148,136,0.05)] data-[state=open]:text-[#0d9488]"
        >
          {selected?.label}
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-40">
        {METRIC_OPTIONS.map((m) => {
          const isSelected = m.value === value;
          return (
            <DropdownMenuItem
              key={m.value}
              onSelect={() => onChange(m.value)}
              className={cn(
                "justify-between",
                isSelected && "font-medium text-[#0c1a1e]",
              )}
            >
              {m.label}
              {isSelected && (
                <Check
                  className="h-3.5 w-3.5 shrink-0 text-[#0d9488]"
                  strokeWidth={1.5}
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
