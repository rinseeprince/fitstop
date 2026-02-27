"use client";

import { cn } from "@/lib/utils";

type CompletionBadgeProps = {
  completionRate: number;
};

export const CompletionBadge = ({ completionRate }: CompletionBadgeProps) => {
  const getColor = () => {
    if (completionRate >= 80) return "bg-success/15 text-success";
    if (completionRate >= 60) return "bg-warning/15 text-warning";
    return "bg-destructive/15 text-destructive";
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium",
        getColor()
      )}
    >
      {Math.round(completionRate)}%
    </div>
  );
};