"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { AttentionAlert } from "@/types/attention-feed";
import type { UnreviewedCheckIn } from "@/types/coach-brief";

type WaitingOnYouSectionProps = {
  clientName: string;
  unreviewedCheckIn: UnreviewedCheckIn;
  attentionAlerts: AttentionAlert[];
  onReviewCheckIns: () => void;
};

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-destructive",
  medium: "bg-amber-500",
  low: "bg-muted-foreground",
};

export function WaitingOnYouSection({
  clientName,
  unreviewedCheckIn,
  attentionAlerts,
  onReviewCheckIns,
}: WaitingOnYouSectionProps) {
  const hasNothing = !unreviewedCheckIn && attentionAlerts.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Waiting on you</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasNothing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            You&apos;re caught up on {clientName}.
          </div>
        ) : (
          <>
            {unreviewedCheckIn && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <ClipboardCheck className="h-4 w-4 text-primary" />
                  <span>Check-in awaiting review</span>
                </div>
                <Button size="sm" variant="outline" onClick={onReviewCheckIns}>
                  Review
                </Button>
              </div>
            )}
            {attentionAlerts.map((alert, i) => (
              <div key={`${alert.type}-${i}`} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                    SEVERITY_DOT[alert.severity] ?? SEVERITY_DOT.low
                  }`}
                  aria-hidden
                />
                <span className="flex items-start gap-1.5">
                  {alert.severity === "high" && (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" />
                  )}
                  {alert.message}
                </span>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
