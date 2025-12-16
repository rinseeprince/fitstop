"use client";

import { quickSuggestions, getSuggestionsByCategory } from "@/lib/training-suggestions";
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
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    selectedBg: "bg-emerald-100",
  },
  style: {
    label: "Training Style",
    icon: Dumbbell,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
    borderColor: "border-indigo-200",
    selectedBg: "bg-indigo-100",
  },
  equipment: {
    label: "Equipment",
    icon: Wrench,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    selectedBg: "bg-amber-100",
  },
} as const;

export function QuickSuggestions({ selectedIds, onToggle }: QuickSuggestionsProps) {
  const categories = ["goal", "style", "equipment"] as const;

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-muted-foreground">Quick suggestions</div>
      {categories.map((category) => {
        const config = categoryConfig[category];
        const Icon = config.icon;
        const suggestions = getSuggestionsByCategory(category);

        return (
          <div key={category} className="space-y-2">
            <div className={cn("flex items-center gap-1.5 text-xs font-medium", config.color)}>
              <Icon className="h-3.5 w-3.5" />
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
                      "px-3 py-1.5 text-sm rounded-full border transition-all",
                      "hover:shadow-sm hover:scale-[1.02] active:scale-[0.98]",
                      isSelected
                        ? cn(config.selectedBg, config.borderColor, config.color, "font-medium")
                        : cn(
                            "bg-slate-50 border-slate-200 text-slate-700",
                            "hover:bg-slate-100 hover:border-slate-300"
                          )
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
}
