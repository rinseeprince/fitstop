"use client";

import useSWR from "swr";
import { format } from "date-fns";
import {
  DsCardSummary,
  DsCardSummaryRow,
} from "@/components/client-portal/ds-card-summary";
import { Skeleton } from "@/components/ui/skeleton";
import { swrFetcher } from "@/lib/swr-fetcher";
import type { CheckInGateStatus } from "@/lib/check-in-schedule";

type StatusResponse = {
  success: boolean;
  data: { status: CheckInGateStatus; nextDueDate: string | null };
};

// Status-aware home entry point for the check-in flow (which left the bottom
// nav when Metrics took its slot). Backed by the lightweight check-in-status
// endpoint so the home day-view doesn't pay for the full check-in context.
export function CheckInCardSummary() {
  const { data, isLoading } = useSWR<StatusResponse>(
    "/api/client/check-in-status",
    swrFetcher,
    {
      revalidateOnFocus: false,
      onError: (err) =>
        console.error("[check-in-card] status fetch failed:", err),
    },
  );

  if (isLoading || !data?.data) {
    return (
      <DsCardSummary title="Weekly check-in">
        <Skeleton className="h-5 w-32" />
      </DsCardSummary>
    );
  }

  const { leading, hint } = describe(data.data.status, data.data.nextDueDate);

  return (
    <DsCardSummary title="Weekly check-in">
      <DsCardSummaryRow
        href="/client/check-in"
        prefetch={false}
        leadingText={leading}
        hint={hint}
        ariaLabel={`Weekly check-in — ${leading}`}
      />
    </DsCardSummary>
  );
}

function describe(
  status: CheckInGateStatus,
  nextDueDate: string | null,
): { leading: string; hint?: string } {
  switch (status) {
    case "available":
      return { leading: "Due today", hint: "Start" };
    case "overdue":
      return { leading: "Overdue — submit now", hint: "Start" };
    // Covers both "you have already checked in" and "your turn has not come
    // round yet". Submitting advances the due date, so those are one state —
    // and the date is the more useful half of it: a client knows they just
    // checked in, they do not know when the next one lands.
    case "not_due":
      return {
        leading: nextDueDate
          ? `Next check-in ${formatDue(nextDueDate)}`
          : "Up to date",
      };
  }
}

function formatDue(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return format(new Date(Number(y), Number(mo) - 1, Number(d)), "MMM d");
}
