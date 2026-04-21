"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { Sparkles, BookOpen, Pencil } from "lucide-react";
import type { BuilderMode } from "@/types/training";

type ModeToggleProps = {
  className?: string;
};

const modes: { value: BuilderMode; label: string; Icon: typeof Sparkles }[] = [
  { value: "ai", label: "AI Generation", Icon: Sparkles },
  { value: "saved", label: "Saved Plans", Icon: BookOpen },
  { value: "manual", label: "Manual Creation", Icon: Pencil },
];

export const ModeToggle = memo(function ModeToggle({ className }: ModeToggleProps) {
  const builder = useTrainingBuilderContext();

  return (
    <div className={cn("bg-[rgba(13,148,136,0.05)] p-[2px] rounded-[6px] inline-flex", className)}>
      {modes.map(({ value, label, Icon }) => (
        <button
          key={value}
          onClick={() => builder.setMode(value)}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-[13px] font-medium rounded-[4px] transition-all duration-150",
            builder.mode === value
              ? "bg-white text-[#0c1a1e] shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
              : "text-[#5a7d82] hover:text-[#0c1a1e]"
          )}
        >
          <Icon className={cn("h-4 w-4", builder.mode === value && "text-[#0d9488]")} />
          {label}
        </button>
      ))}
    </div>
  );
});
