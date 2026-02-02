"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QuickSuggestions } from "./quick-suggestions";
import { PreGenerationActivities } from "../../activities/pre-generation-activities";
import { SameDayTrainingCheckbox } from "./same-day-training-checkbox";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { Sparkles, Loader2, ArrowUp } from "lucide-react";

type AIPromptPanelProps = {
  clientWeightKg: number;
};

export const AIPromptPanel = memo(function AIPromptPanel({ clientWeightKg }: AIPromptPanelProps) {
  const builder = useTrainingBuilderContext();

  return (
    <div className="space-y-5">
      {/* Quick Suggestions */}
      <QuickSuggestions
        selectedIds={builder.selectedSuggestionIds}
        onToggle={builder.toggleSuggestion}
      />

      {/* Get More Ideas Button */}
      <Button
        variant="secondary"
        size="sm"
        onClick={builder.fetchAiSuggestions}
        disabled={builder.isLoadingSuggestions}
        className="w-full border-dashed border-accent/30 text-accent hover:bg-accent/5 hover:border-accent/40"
      >
        {builder.isLoadingSuggestions ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 mr-2" />
        )}
        Get more ideas
      </Button>

      {/* AI-generated suggestions */}
      {builder.aiSuggestions.length > 0 && (
        <div className="space-y-1.5">
          {builder.aiSuggestions.slice(0, 3).map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => builder.setPrompt(builder.prompt + (builder.prompt ? " " : "") + suggestion)}
              className="w-full text-left text-xs p-2.5 rounded-lg bg-accent/5 hover:bg-accent/10
                border border-accent/10 hover:border-accent/20 transition-colors text-gray-600"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* External Activities */}
      <PreGenerationActivities
        activities={builder.preGenerationActivities}
        onAddActivity={builder.addPreGenActivity}
        onRemoveActivity={builder.removePreGenActivity}
        clientWeightKg={clientWeightKg}
      />

      <SameDayTrainingCheckbox className="bg-gray-50" />

      {/* Prompt Input with Send Button */}
      <div className="pb-1">
        <div className="relative">
          <Textarea
            placeholder="Describe your ideal training program..."
            value={builder.prompt}
            onChange={(e) => builder.setPrompt(e.target.value)}
            rows={3}
            className="resize-none bg-white pr-14 pb-12 rounded-xl border-gray-200 focus:border-primary focus:ring-2 focus:ring-ring transition-all"
          />
          <Button
            onClick={builder.generate}
            disabled={builder.isGenerating || !builder.prompt.trim()}
            size="icon"
            className="absolute right-3 bottom-3 h-9 w-9 rounded-full bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 shadow-md hover:shadow-lg transition-all"
          >
            {builder.isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <ArrowUp className="h-4 w-4 text-white" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});
