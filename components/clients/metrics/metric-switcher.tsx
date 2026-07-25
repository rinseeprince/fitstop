"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import type { ReactNode } from "react";
import type { MetricSummary } from "./metrics-view-types";

export type MetricSwitcherProps = {
  metrics: MetricSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  trigger: ReactNode;
};

// "78.2 kg" / "8/10" — score units ("/5", "/10") join without a space.
function formatLatestValue(metric: MetricSummary): string {
  if (!metric.latest) return "";
  if (!metric.unit) return String(metric.latest.value);
  return metric.unit.startsWith("/")
    ? `${metric.latest.value}${metric.unit}`
    : `${metric.latest.value} ${metric.unit}`;
}

// The page's ONLY metric picker: a styled DropdownMenu wrapping the hero's
// eyebrow+title+chevron cluster (passed in as `trigger`). Latest values render
// mono on the right; metrics with no data stay selectable (faint "No data").
// Check/chevron conventions mirror exercise-metric-select.
export function MetricSwitcher({
  metrics,
  activeId,
  onSelect,
  trigger,
}: MetricSwitcherProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-[260px]">
        {metrics.map((m) => {
          const isActive = m.id === activeId;
          return (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => onSelect(m.id)}
              className={cn(
                "justify-between",
                isActive && "font-medium text-[#0c1a1e]"
              )}
            >
              <span className="truncate text-[13px]">{m.name}</span>
              <span className="flex shrink-0 items-center">
                {m.latest ? (
                  <span
                    className={cn(MONO, "ml-3 shrink-0 text-[11px] text-[#93b0b4]")}
                  >
                    {formatLatestValue(m)}
                  </span>
                ) : (
                  <span className="ml-3 shrink-0 text-[11px] text-[#c2d0cc]">
                    No data
                  </span>
                )}
                {isActive && (
                  <Check
                    className="ml-1.5 h-3.5 w-3.5 shrink-0 text-[#0d9488]"
                    strokeWidth={1.5}
                  />
                )}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
