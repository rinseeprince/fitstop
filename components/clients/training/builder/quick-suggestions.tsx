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
    labelColor: "text-success",
    selectedBg: "bg-success/15",
    selectedBorder: "border-success/30",
    selectedText: "text-success",
  },
  style: {
    label: "Training Style",
    icon: Dumbbell,
    labelColor: "text-primary",
    selectedBg: "bg-primary/15",
    selectedBorder: "border-primary/30",
    selectedText: "text-primary",
  },
  equipment: {
    label: "Equipment",
    icon: Wrench,
    labelColor: "text-warning",
    selectedBg: "bg-warning/15",
    selectedBorder: "border-warning/30",
    selectedText: "text-warning",
  },
} as const;

export const QuickSuggestions = memo(function QuickSuggestions({ selectedIds, onToggle }: QuickSuggestionsProps) {
  const categories = ["goal", "style", "equipment"] as const;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-muted-foreground">Quick suggestions</p>
      {categories.map((category) => {
        const config = categoryConfig[category];
        const Icon = config.icon;
        const suggestions = getSuggestionsByCategory(category);

        return (
          <div key={category} className="space-y-2">
            <div className={cn("flex items-center gap-1.5 text-xs font-medium", config.labelColor)}>
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
                      "px-3 py-1.5 text-sm rounded-md transition-colors duration-150",
                      isSelected
                        ? cn(config.selectedBg, "border", config.selectedBorder, config.selectedText, "font-medium")
                        : "bg-muted text-foreground hover:bg-muted"
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
