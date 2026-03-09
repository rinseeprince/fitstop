"use client";

import { useState } from "react";
import { Sparkles, AlertCircle, TrendingUp, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AIInsight, AIRecommendation } from "@/types/check-in";

type AISummaryCardProps = {
  checkInId: string;
  summary?: string;
  insights?: AIInsight[];
  recommendations?: AIRecommendation[];
  onUpdate?: (newSummary: string) => void;
};

const insightIcons = {
  strength: CheckCircle2,
  concern: AlertCircle,
  trend: TrendingUp,
};

// Semantic colours from design system (Tailwind v4 CSS variables with opacity)
const insightColors = {
  strength: {
    bg: "bg-success/10",
    text: "text-success",
    icon: "text-success",
  },
  concern: {
    bg: "bg-warning/10",
    text: "text-warning",
    icon: "text-warning",
  },
  trend: {
    bg: "bg-primary/10",
    text: "text-primary",
    icon: "text-primary",
  },
};

// Priority Recommendation Cards from design system section 12.3
const priorityColors = {
  high: {
    border: "border-destructive",
    label: "text-destructive",
  },
  medium: {
    border: "border-warning",
    label: "text-warning",
  },
  low: {
    border: "border-primary",
    label: "text-primary",
  },
};

export const AISummaryCard = ({
  checkInId,
  summary = "",
  insights = [],
  recommendations = [],
  onUpdate,
}: AISummaryCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState(summary);
  const [isRegenerating, setIsRegenerating] = useState(false);

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
      console.error("Failed to regenerate:", error);
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* AI Summary Card - Design System Section 12.3 */}
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
              <Button
                size="sm"
                onClick={handleSave}
                className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs px-3 py-1.5 rounded-md"
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditedSummary(summary);
                  setIsEditing(false);
                }}
                className="bg-card border-border text-foreground hover:bg-muted/50 text-xs px-3 py-1.5 rounded-md"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground leading-relaxed">
              {editedSummary || "No AI summary available yet."}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(true)}
              className="text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 mt-2 h-7 px-2"
            >
              Edit Summary
            </Button>
          </>
        )}
      </div>

      {/* Key Insights - Semantic colours */}
      {insights.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Key Insights</h4>
          <div className="space-y-2">
            {insights.map((insight, index) => {
              const Icon = insightIcons[insight.type];
              const colors = insightColors[insight.type];
              return (
                <div
                  key={index}
                  className={`flex items-start gap-3 p-3 rounded-lg ${colors.bg}`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${colors.icon}`} />
                  <p className={`text-sm ${colors.text}`}>{insight.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendations - Priority Cards from Design System Section 12.3 */}
      {recommendations.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Recommendations</h4>
          <div className="space-y-2">
            {recommendations.map((rec, index) => {
              const colors = priorityColors[rec.priority];
              return (
                <div
                  key={index}
                  className={`bg-card rounded-lg border-l-4 ${colors.border} p-4`}
                >
                  <span className={`text-xs font-semibold uppercase tracking-wide ${colors.label}`}>
                    {rec.priority} Priority
                  </span>
                  <p className="text-sm text-foreground mt-1">{rec.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
