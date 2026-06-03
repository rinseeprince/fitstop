"use client";

import { useState } from "react";
import {
  Sparkles,
  RefreshCw,
  Pencil,
  Check,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Flag,
  ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckInShareCard } from "./check-in-share-card";
import type { CheckInReview, WatchItemType, CoachActionPriority } from "@/types/check-in";

type CheckInReviewRailProps = {
  checkInId: string;
  clientName: string;
  review: CheckInReview;
  // Refetch the check-in (after a regenerate or a send) so every block updates.
  onRefresh?: () => void;
};

// Teal Summit two-colour: teal positive, amber attention, secondary-grey neutral.
const WATCH_META: Record<WatchItemType, { icon: LucideIcon; color: string }> = {
  win: { icon: CheckCircle2, color: "text-[#0d9488]" },
  risk: { icon: AlertTriangle, color: "text-[#d97706]" },
  trend: { icon: TrendingUp, color: "text-[#5a7d82]" },
  flag: { icon: Flag, color: "text-[#d97706]" },
};

const PRIORITY_META: Record<CoachActionPriority, { border: string; label: string }> = {
  high: { border: "border-l-[#d97706]", label: "text-[#d97706]" },
  medium: { border: "border-l-[#0d9488]", label: "text-[#0d9488]" },
  low: { border: "border-l-[rgba(13,148,136,0.25)]", label: "text-[#93b0b4]" },
};

export const CheckInReviewRail = ({
  checkInId,
  clientName,
  review,
  onRefresh,
}: CheckInReviewRailProps) => {
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  // null means "show the summary from the latest review"; a string is a local edit.
  const [editedSummary, setEditedSummary] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const displayedSummary = editedSummary ?? review.summary;

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const res = await fetch(`/api/check-in/${checkInId}/ai-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setEditedSummary(null);
        setIsEditingSummary(false);
        onRefresh?.();
      }
    } catch (error) {
      console.error(
        "Failed to regenerate review:",
        error instanceof Error ? error.message : "Unknown error"
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 1. Summary - what happened */}
      <div className="bg-[rgba(13,148,136,0.05)] border border-[rgba(13,148,136,0.15)] rounded-[6px] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-[#0d9488]" strokeWidth={1.5} />
            <span className="text-sm font-medium text-[#0c1a1e]">Summary</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditingSummary((value) => !value)}
              className="h-8 w-8 p-0 text-[#93b0b4] hover:text-[#5a7d82]"
            >
              {isEditingSummary ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRegenerate}
              disabled={isRegenerating}
              className="h-8 w-8 p-0 text-[#93b0b4] hover:text-[#5a7d82]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        {isEditingSummary ? (
          <Textarea
            value={displayedSummary}
            onChange={(e) => setEditedSummary(e.target.value)}
            rows={4}
            className="resize-none bg-white border-[rgba(13,148,136,0.15)] rounded-[6px] text-sm text-[#0c1a1e] focus:border-[#0d9488]"
          />
        ) : (
          <p className="text-sm text-[#0c1a1e] leading-relaxed">
            {displayedSummary || "No summary yet. Generate a review to begin."}
          </p>
        )}
      </div>

      {/* 2. What to watch */}
      {(review.watchItems.length > 0 || review.themes.length > 0) && (
        <div>
          <h4 className="text-sm font-semibold text-[#0c1a1e] mb-2">What to watch</h4>
          <div className="space-y-2">
            {review.watchItems.map((item, i) => {
              const meta = WATCH_META[item.type];
              const Icon = meta.icon;
              return (
                <div key={i} className="flex items-start gap-2.5 text-sm">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.color}`} strokeWidth={1.5} />
                  <span className="text-[#0c1a1e]">{item.text}</span>
                </div>
              );
            })}
          </div>
          {review.themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {review.themes.map((theme, i) => (
                <span key={i} className="px-2 py-0.5 text-xs rounded-[4px] bg-[rgba(13,148,136,0.08)] text-[#0d9488]">
                  {theme}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Coach actions - what to do */}
      {review.coachActions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ListChecks className="w-4 h-4 text-[#0c1a1e]" strokeWidth={1.5} />
            <h4 className="text-sm font-semibold text-[#0c1a1e]">Coach actions</h4>
          </div>
          <div className="space-y-2">
            {review.coachActions.map((action, i) => {
              const meta = PRIORITY_META[action.priority];
              return (
                <div key={i} className={`bg-white rounded-[6px] border-l-4 ${meta.border} p-3`}>
                  <span className={`text-xs font-semibold uppercase tracking-wide ${meta.label}`}>
                    {action.priority}
                  </span>
                  <p className="text-sm text-[#0c1a1e] mt-1">{action.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Share with client - what to say */}
      <CheckInShareCard
        checkInId={checkInId}
        clientName={clientName}
        clientMessage={review.clientMessage}
        onSent={onRefresh}
      />
    </div>
  );
};
