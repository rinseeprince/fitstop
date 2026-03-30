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
    <div className={cn("bg-[rgba(13,148,136,0.05)] p-[2px] rounded-[6px] inline-flex", className)}>
      <button
        onClick={() => builder.setMode("ai")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-[13px] font-medium rounded-[4px] transition-all duration-150",
          builder.mode === "ai"
            ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
            : "text-[#5a7d82] hover:text-[#0c1a1e]"
        )}
      >
        <Sparkles className={cn("h-4 w-4", builder.mode === "ai" && "text-[#0d9488]")} />
        AI Generation
      </button>
      <button
        onClick={() => builder.setMode("manual")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-[13px] font-medium rounded-[4px] transition-all duration-150",
          builder.mode === "manual"
            ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
            : "text-[#5a7d82] hover:text-[#0c1a1e]"
        )}
      >
        <Pencil className={cn("h-4 w-4", builder.mode === "manual" && "text-[#0d9488]")} />
        Manual Creation
      </button>
    </div>
  );
});
