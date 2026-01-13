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
    bg: "bg-success/15",
    text: "text-success",
    icon: "text-success",
  },
  concern: {
    bg: "bg-warning/15",
    text: "text-warning",
    icon: "text-warning",
  },
  trend: {
    bg: "bg-primary/15",
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
      <div className="bg-gradient-to-br from-accent/10 to-primary/10 border border-accent/20 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
            </div>
            <span className="text-sm font-medium text-gray-900">AI Summary</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="text-xs text-gray-600 hover:text-gray-900 hover:bg-white/50 h-8 px-2"
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
              className="resize-none bg-white/80 border-gray-200 rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-ring"
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
                className="bg-white border-gray-200 text-gray-700 hover:bg-gray-50 text-xs px-3 py-1.5 rounded-md"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-700 leading-relaxed">
              {editedSummary || "No AI summary available yet."}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(true)}
              className="text-xs text-gray-500 hover:text-gray-700 hover:bg-white/50 mt-2 h-7 px-2"
            >
              Edit Summary
            </Button>
          </>
        )}
      </div>

      {/* Key Insights - Semantic colours */}
      {insights.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Key Insights</h4>
          <div className="space-y-2">
            {insights.map((insight, index) => {
              const Icon = insightIcons[insight.type];
              const colors = insightColors[insight.type];
              return (
                <div
                  key={index}
                  className={`flex items-start gap-3 p-3 rounded-xl ${colors.bg}`}
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
          <h4 className="text-sm font-semibold text-gray-900">Recommendations</h4>
          <div className="space-y-2">
            {recommendations.map((rec, index) => {
              const colors = priorityColors[rec.priority];
              return (
                <div
                  key={index}
                  className={`bg-white rounded-lg border-l-4 ${colors.border} p-4 shadow-sm`}
                >
                  <span className={`text-xs font-semibold uppercase tracking-wide ${colors.label}`}>
                    {rec.priority} Priority
                  </span>
                  <p className="text-sm text-gray-700 mt-1">{rec.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
