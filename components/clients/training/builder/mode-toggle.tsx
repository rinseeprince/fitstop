"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { Sparkles, Pencil } from "lucide-react";

type ModeToggleProps = {
  className?: string;
};

export const ModeToggle = memo(function ModeToggle({ className }: ModeToggleProps) {
  const builder = useTrainingBuilderContext();

  return (
    <div className={cn("bg-gray-100 p-1 rounded-lg inline-flex", className)}>
      <button
        onClick={() => builder.setMode("ai")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-150",
          builder.mode === "ai"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-500 hover:text-gray-700"
        )}
      >
        <Sparkles className={cn("h-4 w-4", builder.mode === "ai" && "text-accent")} />
        AI Generation
      </button>
      <button
        onClick={() => builder.setMode("manual")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-150",
          builder.mode === "manual"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-500 hover:text-gray-700"
        )}
      >
        <Pencil className="h-4 w-4" />
        Manual Creation
      </button>
    </div>
  );
});
