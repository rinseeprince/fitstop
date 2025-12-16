"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QuickSuggestions } from "./quick-suggestions";
import { PreGenerationActivities } from "../../activities/pre-generation-activities";
import { Checkbox } from "@/components/ui/checkbox";
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
        variant="outline"
        size="sm"
        onClick={builder.fetchAiSuggestions}
        disabled={builder.isLoadingSuggestions}
        className="w-full border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50"
      >
        {builder.isLoadingSuggestions ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4 mr-2" />
        )}
        Get more ideas
      </Button>

      {/* AI-generated suggestions - compact */}
      {builder.aiSuggestions.length > 0 && (
        <div className="space-y-1.5">
          {builder.aiSuggestions.slice(0, 3).map((suggestion, idx) => (
            <button
              key={idx}
              onClick={() => builder.setPrompt(builder.prompt + (builder.prompt ? " " : "") + suggestion)}
              className="w-full text-left text-xs p-2 rounded-lg bg-indigo-50/50 hover:bg-indigo-100
                border border-indigo-100 transition-colors text-slate-600"
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

      {/* Same-day training checkbox */}
      {builder.preGenerationActivities.length > 0 && (
        <div className="flex items-start space-x-3 p-3 bg-muted/50 rounded-lg">
          <Checkbox
            id="allowSameDayTraining"
            checked={builder.allowSameDayTraining}
            onCheckedChange={(checked) => builder.setAllowSameDayTraining(checked === true)}
          />
          <div className="grid gap-1.5 leading-none">
            <label
              htmlFor="allowSameDayTraining"
              className="text-sm font-medium cursor-pointer"
            >
              Client can train on activity days
            </label>
            <p className="text-xs text-muted-foreground">
              Enable for athletes or clients comfortable with multiple sessions per day
            </p>
          </div>
        </div>
      )}

      {/* Prompt Input with Side Arrow Button */}
      <div>
        <div className="relative">
          <Textarea
            placeholder="Describe your ideal training program..."
            value={builder.prompt}
            onChange={(e) => builder.setPrompt(e.target.value)}
            rows={3}
            className="resize-none bg-white pr-14 rounded-xl"
          />
          <Button
            onClick={builder.generate}
            disabled={builder.isGenerating || !builder.prompt.trim()}
            size="icon"
            className="absolute right-2 bottom-2 h-9 w-9 rounded-full bg-gradient-to-r from-indigo-600 to-sky-500 hover:from-indigo-700 hover:to-sky-600 shadow-md"
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
