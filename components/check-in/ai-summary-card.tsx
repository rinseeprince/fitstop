"use client";

import { useState } from "react";
import { Sparkles, AlertCircle, TrendingUp, CheckCircle2, RefreshCw, Lightbulb, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AIInsight, AIRecommendation, EnhancedAIData } from "@/types/check-in";
import {
  CollapsibleSection,
  NutritionInsightSection,
  NotesIntelligenceSection,
  TrainingInsightSection,
  WellnessInsightSection,
  CoachActionsSection,
  ClientHighlightsSection,
} from "./ai-insight-sections";

type AISummaryCardProps = {
  checkInId: string;
  summary?: string;
  aiInsights?: AIInsight[] | EnhancedAIData;
  recommendations?: AIRecommendation[];
  onUpdate?: (newSummary: string) => void;
};

// Detect whether stored ai_insights is v2 enhanced format or legacy array
function isEnhancedData(data: AIInsight[] | EnhancedAIData | undefined): data is EnhancedAIData {
  return !!data && !Array.isArray(data) && (data as EnhancedAIData)._version === 2;
}

function getLegacyInsights(data: AIInsight[] | EnhancedAIData | undefined): AIInsight[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return (data as EnhancedAIData).insights ?? [];
}

const insightIcons = {
  strength: CheckCircle2,
  concern: AlertCircle,
  trend: TrendingUp,
};

const insightColors = {
  strength: { bg: "bg-success/10", text: "text-success", icon: "text-success" },
  concern: { bg: "bg-warning/10", text: "text-warning", icon: "text-warning" },
  trend: { bg: "bg-primary/10", text: "text-primary", icon: "text-primary" },
};

const priorityColors = {
  high: { border: "border-destructive", label: "text-destructive" },
  medium: { border: "border-warning", label: "text-warning" },
  low: { border: "border-primary", label: "text-primary" },
};

export const AISummaryCard = ({
  checkInId,
  summary = "",
  aiInsights,
  recommendations = [],
  onUpdate,
}: AISummaryCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState(summary);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const enhanced = isEnhancedData(aiInsights) ? aiInsights : null;
  const legacyInsights = getLegacyInsights(aiInsights);

  const handleSave = () => {
    onUpdate?.(editedSummary);
    setIsEditing(false);
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const response = await fetch(`/api/check-in/${checkInId}/ai-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.summary) {
          setEditedSummary(data.summary.summary);
          onUpdate?.(data.summary.summary);
        }
      }
    } catch (error) {
      console.error("Failed to regenerate:", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* AI Summary Card */}
      <div className="bg-primary/5 border border-primary/15 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-card rounded-full flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">AI Summary</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 h-8 px-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRegenerating ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <Textarea
              value={editedSummary}
              onChange={(e) => setEditedSummary(e.target.value)}
              rows={4}
              className="resize-none bg-card border-border rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs px-3 py-1.5 rounded-md">
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditedSummary(summary); setIsEditing(false); }} className="bg-card border-border text-foreground hover:bg-muted/50 text-xs px-3 py-1.5 rounded-md">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground leading-relaxed">
              {editedSummary || "No AI summary available yet."}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)} className="text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 mt-2 h-7 px-2">
              Edit Summary
            </Button>
          </>
        )}
      </div>

      {/* Enhanced sections (v2 format) */}
      {enhanced?.nutritionInsight && <NutritionInsightSection data={enhanced.nutritionInsight} />}
      {enhanced?.notesIntelligence && <NotesIntelligenceSection data={enhanced.notesIntelligence} />}
      {enhanced?.trainingInsight && <TrainingInsightSection data={enhanced.trainingInsight} />}
      {enhanced?.wellnessInsight && <WellnessInsightSection data={enhanced.wellnessInsight} />}
      {enhanced?.coachActions && enhanced.coachActions.length > 0 && <CoachActionsSection data={enhanced.coachActions} />}
      {enhanced?.clientHighlights && enhanced.clientHighlights.length > 0 && <ClientHighlightsSection data={enhanced.clientHighlights} />}

      {/* Key Insights (always shown) */}
      {legacyInsights.length > 0 && (
        <CollapsibleSection icon={Lightbulb} title="Key Insights" iconColor="text-primary">
          <div className="space-y-2 pl-7">
            {legacyInsights.map((insight, index) => {
              const Icon = insightIcons[insight.type];
              const colors = insightColors[insight.type];
              return (
                <div key={index} className={`flex items-start gap-3 p-3 rounded-lg ${colors.bg}`}>
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${colors.icon}`} />
                  <p className={`text-sm ${colors.text}`}>{insight.text}</p>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <CollapsibleSection icon={Target} title="Recommendations" iconColor="text-foreground">
          <div className="space-y-2 pl-7">
            {recommendations.map((rec, index) => {
              const colors = priorityColors[rec.priority];
              return (
                <div key={index} className={`bg-card rounded-lg border-l-4 ${colors.border} p-4`}>
                  <span className={`text-xs font-semibold uppercase tracking-wide ${colors.label}`}>
                    {rec.priority} Priority
                  </span>
                  <p className="text-sm text-foreground mt-1">{rec.text}</p>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
};
