"use client";

import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

type MetricListItemProps = {
  id: string;
  name: string;
  value: number | null;
  unit: string;
  lastUpdated: string | null;
  isSelected: boolean;
  onClick: () => void;
};

export const MetricListItem = ({
  name,
  value,
  unit,
  lastUpdated,
  isSelected,
  onClick,
}: MetricListItemProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-lg transition-colors",
        "hover:bg-muted/50",
        isSelected && "bg-primary/10 hover:bg-primary/15"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{name}</span>
        <span className="text-sm text-muted-foreground">
          {value !== null ? `${value} ${unit}` : "—"}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {lastUpdated
          ? formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })
          : "No data"}
      </div>
    </button>
  );
};
