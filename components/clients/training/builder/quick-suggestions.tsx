"use client";

import { memo } from "react";
import { getSuggestionsByCategory } from "@/lib/training-suggestions";
import { cn } from "@/lib/utils";
import { Target, Dumbbell, Wrench } from "lucide-react";

type QuickSuggestionsProps = {
  selectedIds: string[];
  onToggle: (id: string, prompt: string) => void;
};

const categoryConfig = {
  goal: {
    label: "Goals",
    icon: Target,
    labelColor: "text-[#0d9488]",
  },
  style: {
    label: "Training Style",
    icon: Dumbbell,
    labelColor: "text-[#c8923a]",
  },
  equipment: {
    label: "Equipment",
    icon: Wrench,
    labelColor: "text-[#c8923a]",
  },
} as const;

export const QuickSuggestions = memo(function QuickSuggestions({ selectedIds, onToggle }: QuickSuggestionsProps) {
  const categories = ["goal", "style", "equipment"] as const;

  return (
    <div className="space-y-4">
      <p className="text-[11px] uppercase tracking-[0.07em] font-semibold text-[#93b0b4]">Quick suggestions</p>
      {categories.map((category) => {
        const config = categoryConfig[category];
        const Icon = config.icon;
        const suggestions = getSuggestionsByCategory(category);

        return (
          <div key={category} className="space-y-2">
            <div className={cn("flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.07em] uppercase", config.labelColor)}>
              <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
              {config.label}
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => {
                const isSelected = selectedIds.includes(suggestion.id);
                return (
                  <button
                    key={suggestion.id}
                    onClick={() => onToggle(suggestion.id, suggestion.prompt)}
                    className={cn(
                      "px-3 py-1.5 text-[12.5px] font-medium rounded-[6px] border transition-colors duration-150",
                      isSelected
                        ? "bg-[rgba(13,148,136,0.08)] border-[#0d9488] text-[#0d9488]"
                        : "bg-[#f4f7f6] border-[rgba(13,148,136,0.08)] text-[#0c1a1e] hover:border-[rgba(13,148,136,0.2)]"
                    )}
                  >
                    {suggestion.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
});
