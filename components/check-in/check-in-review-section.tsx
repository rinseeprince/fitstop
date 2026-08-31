"use client";

import { useState } from "react";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Flag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { TEXT_MUTED } from "@/components/clients/training/program-builder/builder-tokens";
import { NeutralChip } from "@/components/clients/overview/overview-primitives";
import {
  ReviewBlock,
  ReviewList,
  ReviewListRow,
  ReviewProse,
} from "@/components/clients/check-ins/review-block";
import type { CheckInReview, WatchItemType, CoachActionPriority } from "@/types/check-in";

type CheckInReviewSectionProps = {
  checkInId: string;
  review: CheckInReview;
  // Refetch the check-in (after a regenerate) so every block updates in place.
  onRefresh?: () => void;
};

// Teal Summit two-colour: teal positive, amber attention, secondary-grey neutral.
const WATCH_META: Record<WatchItemType, { icon: LucideIcon; color: string }> = {
  win: { icon: CheckCircle2, color: "text-[#0d9488]" },
  risk: { icon: AlertTriangle, color: "text-[#d97706]" },
  trend: { icon: TrendingUp, color: "text-[#5a7d82]" },
  flag: { icon: Flag, color: "text-[#d97706]" },
};

// The priority used to be a `border-l-4` on a nested white card plus an
// uppercase word — a third card shape inside the card. It is now a marker dot
// in the shared list slot, carrying the word for anyone who cannot see colour.
const PRIORITY_META: Record<CoachActionPriority, { dot: string; label: string }> = {
  high: { dot: "bg-[#d97706]", label: "High priority" },
  medium: { dot: "bg-[#0d9488]", label: "Medium priority" },
  low: { dot: "bg-[rgba(13,148,136,0.35)]", label: "Low priority" },
};

export const CheckInReviewSection = ({
  checkInId,
  review,
  onRefresh,
}: CheckInReviewSectionProps) => {
  const [isRegenerating, setIsRegenerating] = useState(false);

  const hasWatch = review.watchItems.length > 0 || review.themes.length > 0;
  const hasActions = review.coachActions.length > 0;
  const hasAiReview = Boolean(review.summary) || hasWatch || hasActions;

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const res = await fetch(`/api/check-in/${checkInId}/ai-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      // A non-OK response used to be swallowed whole, so the coach-keyed
      // `aiRateLimit` 429 spun the icon and then simply did nothing.
      if (!res.ok) {
        toast.error(
          res.status === 429
            ? "Too many regenerations — try again in a minute"
            : "Could not regenerate the review"
        );
        return;
      }
      onRefresh?.();
    } catch (error) {
      toast.error("Could not regenerate the review");
      console.error(
        "Failed to regenerate review:",
        error instanceof Error ? error.message : "Unknown error"
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div>
      <SectionLabel
        label="AI review"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRegenerate}
            disabled={isRegenerating}
            aria-label="Regenerate review"
            className="h-8 w-8 p-0 text-[#93b0b4] hover:text-[#5a7d82]"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRegenerating && "animate-spin")} />
          </Button>
        }
      />

      <div className="flex flex-col gap-5 rounded-[6px] bg-white p-5">
        {!hasAiReview ? (
          <p className={cn("text-[13px] leading-relaxed", TEXT_MUTED)}>
            No AI review yet. Regenerate to write one.
          </p>
        ) : (
          <>
            {review.summary && (
              <ReviewBlock label="Summary">
                <ReviewProse>{review.summary}</ReviewProse>
              </ReviewBlock>
            )}

            {hasWatch && (
              <ReviewBlock label="What to watch">
                {review.watchItems.length > 0 && (
                  <ReviewList>
                    {review.watchItems.map((item, i) => {
                      const meta = WATCH_META[item.type];
                      const Icon = meta.icon;
                      return (
                        <ReviewListRow
                          key={i}
                          marker={
                            <Icon
                              className={cn("h-4 w-4", meta.color)}
                              strokeWidth={1.5}
                              aria-hidden="true"
                            />
                          }
                        >
                          {item.text}
                        </ReviewListRow>
                      );
                    })}
                  </ReviewList>
                )}
                {review.themes.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {review.themes.map((theme) => (
                      <NeutralChip key={theme}>{theme}</NeutralChip>
                    ))}
                  </div>
                )}
              </ReviewBlock>
            )}

            {hasActions && (
              <ReviewBlock label="Coach actions">
                <ReviewList>
                  {review.coachActions.map((action, i) => {
                    const meta = PRIORITY_META[action.priority];
                    return (
                      <ReviewListRow
                        key={i}
                        marker={
                          <>
                            <span
                              className={cn("h-1.5 w-1.5 rounded-full", meta.dot)}
                              title={meta.label}
                            />
                            <span className="sr-only">{meta.label}</span>
                          </>
                        }
                      >
                        {action.text}
                      </ReviewListRow>
                    );
                  })}
                </ReviewList>
              </ReviewBlock>
            )}
          </>
        )}
      </div>
    </div>
  );
};
