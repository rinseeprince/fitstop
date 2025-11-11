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

const insightColors = {
  strength: "text-green-600 bg-green-100 dark:bg-green-900/20",
  concern: "text-red-600 bg-red-100 dark:bg-red-900/20",
  trend: "text-blue-600 bg-blue-100 dark:bg-blue-900/20",
};

const priorityColors = {
  high: "border-l-red-500 bg-red-50 dark:bg-red-900/10",
  medium: "border-l-orange-500 bg-orange-50 dark:bg-orange-900/10",
  low: "border-l-blue-500 bg-blue-50 dark:bg-blue-900/10",
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-semibold">AI Summary</h3>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRegenerate}
          disabled={isRegenerating}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRegenerating ? "animate-spin" : ""}`} />
          Regenerate
        </Button>
      </div>

      {/* Summary */}
      <div className="glass-card p-4 space-y-3">
        {isEditing ? (
          <>
            <Textarea
              value={editedSummary}
              onChange={(e) => setEditedSummary(e.target.value)}
              rows={4}
              className="resize-none"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditedSummary(summary);
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {editedSummary}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(true)}
              className="text-xs"
            >
              Edit Summary
            </Button>
          </>
        )}
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Key Insights</h4>
          <div className="space-y-2">
            {insights.map((insight, index) => {
              const Icon = insightIcons[insight.type];
              return (
                <div
                  key={index}
                  className={`flex items-start gap-3 p-3 rounded-lg ${insightColors[insight.type]}`}
                >
                  <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p className="text-sm">{insight.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Recommendations</h4>
          <div className="space-y-2">
            {recommendations.map((rec, index) => (
              <div
                key={index}
                className={`border-l-4 p-3 rounded-r-lg ${priorityColors[rec.priority]}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase">
                    {rec.priority} Priority
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{rec.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
