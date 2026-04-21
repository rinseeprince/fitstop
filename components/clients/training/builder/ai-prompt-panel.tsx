"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QuickSuggestions } from "./quick-suggestions";
import { PreGenerationActivities } from "../../activities/pre-generation-activities";
import { SameDayTrainingCheckbox } from "./same-day-training-checkbox";
import { PlanNameInput } from "./plan-name-input";
import { useTrainingBuilderContext } from "@/contexts/training-builder-context";
import { Sparkles, Loader2, ArrowUp } from "lucide-react";

type AIPromptPanelProps = {
  clientWeightKg: number;
};

export const AIPromptPanel = memo(function AIPromptPanel({ clientWeightKg }: AIPromptPanelProps) {
  const builder = useTrainingBuilderContext();
  const hasPrompt = builder.prompt.trim().length > 0;

  return (
    <div className="space-y-5">
      {/* Plan Name */}
      <PlanNameInput
        value={builder.planName}
        onChange={builder.setPlanName}
        placeholder="Plan name (optional)"
        helpText="Leave blank and AI will suggest one for you."
      />

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
        className="w-full border-dashed border-[rgba(13,148,136,0.2)] bg-transparent text-[#0d9488] hover:bg-[rgba(13,148,136,0.03)] hover:border-[rgba(13,148,136,0.3)] rounded-[6px]"
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
              className="w-full text-left text-[12.5px] p-2.5 rounded-[6px] bg-[rgba(13,148,136,0.04)]
                border border-[rgba(13,148,136,0.08)] hover:border-[rgba(13,148,136,0.2)] transition-colors text-[#5a7d82]"
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

      <SameDayTrainingCheckbox />

      {/* Prompt Input with Send Button */}
      <div>
        <div className="relative">
          <Textarea
            placeholder="Describe your ideal training program..."
            value={builder.prompt}
            onChange={(e) => builder.setPrompt(e.target.value)}
            rows={4}
            className="resize-y min-h-[110px] bg-[#f4f7f6] pr-14 pb-12 rounded-[6px] border-[rgba(13,148,136,0.08)] text-[13px] text-[#0c1a1e] placeholder:text-[#93b0b4] focus:border-[#0d9488] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all"
          />
          <button
            onClick={() => void builder.generate()}
            disabled={builder.isGenerating || !hasPrompt}
            className={`absolute right-3 bottom-3 w-[34px] h-[34px] rounded-[6px] flex items-center justify-center transition-colors ${
              hasPrompt
                ? "bg-[#0d9488] hover:bg-[#0a7c72]"
                : "bg-[rgba(13,148,136,0.15)]"
            } disabled:pointer-events-none`}
          >
            {builder.isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <ArrowUp className={`h-4 w-4 ${hasPrompt ? "text-white" : "text-[#93b0b4]"}`} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
