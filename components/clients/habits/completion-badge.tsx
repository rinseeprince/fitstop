"use client";

import { cn } from "@/lib/utils";

type CompletionBadgeProps = {
  completionRate: number;
};

export const CompletionBadge = ({ completionRate }: CompletionBadgeProps) => {
  const getColor = () => {
    if (completionRate >= 80) return "bg-success/10 text-success";
    if (completionRate >= 60) return "bg-warning/10 text-warning";
    return "bg-destructive/10 text-destructive";
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-medium",
        getColor()
      )}
    >
      {Math.round(completionRate)}%
    </div>
  );
};