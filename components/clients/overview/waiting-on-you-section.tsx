"use client";

import { CheckCircle2, ChevronRight, ClipboardCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { alertDestination } from "@/lib/attention-alert-destinations";
import {
  COUNT_CHIP_CLASS,
  LABEL_CLASS,
  MONO_META_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { CardHeader, OverviewCard } from "./overview-primitives";
import { relativeDayPhrase } from "./overview-format";
import type { ClientTab } from "@/lib/client-tabs";
import type { AlertSeverity, AlertType, AttentionAlert } from "@/types/attention-feed";
import type { UnreviewedCheckIn } from "@/types/coach-brief";

type WaitingOnYouSectionProps = {
  clientName: string;
  unreviewedCheckIn: UnreviewedCheckIn;
  attentionAlerts: AttentionAlert[];
  onTabChange: (tab: ClientTab) => void;
  /**
   * Dismisses one alert type for this client. Dismissal is shared with the coach
   * dashboard's feed — the same `attention_dismissals` row drives both — and it
   * lapses when a newer day trips the same trigger again.
   */
  onDismissAlert: (alertType: AlertType) => void;
};

// High takes the destructive-soft accent, medium the warning tone. There is no
// filled red anywhere in the system, so severity reads through the dot only.
const SEVERITY_DOT: Record<AlertSeverity, string> = {
  high: "bg-[#c06060]",
  medium: "bg-[#d97706]",
  low: "bg-[#93b0b4]",
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

export function WaitingOnYouSection({
  clientName,
  unreviewedCheckIn,
  attentionAlerts,
  onTabChange,
  onDismissAlert,
}: WaitingOnYouSectionProps) {
  const pendingCount = attentionAlerts.length + (unreviewedCheckIn ? 1 : 0);
  const sortedAlerts = [...attentionAlerts].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
  const submitted = unreviewedCheckIn ? relativeDayPhrase(unreviewedCheckIn.submittedAt) : null;

  return (
    <OverviewCard animationDelay="0.02s">
      <CardHeader
        title="Waiting on you"
        right={
          pendingCount > 0 ? <span className={COUNT_CHIP_CLASS}>{pendingCount}</span> : undefined
        }
      />

      {pendingCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
          <CheckCircle2 className="h-8 w-8 text-[#0d9488] opacity-50" strokeWidth={1.5} />
          <p className="mt-2 text-sm text-[#5a7d82]">You&apos;re caught up on {clientName}</p>
          <p className="mt-1 text-xs text-[#93b0b4]">
            No unreviewed check-in and nothing flagged this week.
          </p>
        </div>
      ) : (
        <div className="px-3 pb-4">
          {unreviewedCheckIn && (
            <div className="flex items-center gap-3 rounded-[6px] px-2 py-2">
              <span className={cn(THUMB_CLASS, "h-9 w-9")}>
                <ClipboardCheck className="h-4 w-4" strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-[#0c1a1e]">
                  Check-in awaiting review
                </p>
                {submitted && (
                  <p
                    className={cn(
                      "mt-0.5 text-[11px]",
                      submitted.isNumeric ? MONO_META_CLASS : "text-[#93b0b4]"
                    )}
                  >
                    Submitted {submitted.text}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onTabChange("check-ins")}
                className="h-7 shrink-0 rounded-[6px] border-[rgba(13,148,136,0.08)] px-3 text-[12px] font-medium text-[#5a7d82] hover:text-[#0c1a1e]"
              >
                Review
              </Button>
            </div>
          )}

          {sortedAlerts.map((alert, i) => {
            const destination = alertDestination(alert.type);
            return (
              // The row navigates and the × dismisses, so they are siblings —
              // a button cannot legally contain another button.
              <div
                key={`${alert.type}-${i}`}
                className="group/alert flex items-center rounded-[6px] transition-colors hover:bg-[rgba(13,148,136,0.03)]"
              >
                <button
                  type="button"
                  onClick={() => onTabChange(destination.tab)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      SEVERITY_DOT[alert.severity] ?? SEVERITY_DOT.low
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 text-[13px] text-[#0c1a1e]">{alert.message}</span>
                  <span className={cn(LABEL_CLASS, "shrink-0")}>{destination.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#93b0b4]" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={() => onDismissAlert(alert.type)}
                  title="Dismiss this alert"
                  aria-label={`Dismiss: ${alert.message}`}
                  className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[#93b0b4] opacity-0 transition-opacity duration-150 hover:bg-[#f0f5f4] hover:text-[#5a7d82] focus-visible:opacity-100 group-hover/alert:opacity-100"
                >
                  <X className="h-[15px] w-[15px]" strokeWidth={1.5} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </OverviewCard>
  );
}
