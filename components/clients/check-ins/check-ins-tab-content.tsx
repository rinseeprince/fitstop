"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { CheckInDetailView } from "./check-in-detail-view";
import { CheckInFormSheet } from "./check-in-form-sheet";
import { CheckInStatusBadge } from "./check-in-status-badge";
import {
  useClientCheckInsInfinite,
  useInvalidateCheckInsQueue,
  useInvalidateClientCheckIns,
} from "@/hooks/use-check-in-data";
import { getAiPreview } from "@/lib/check-in-helpers";
import { checkInReviewUrl, type ClientTab } from "@/lib/client-tabs";
import { cn } from "@/lib/utils";
import { pluralize } from "@/components/clients/overview/overview-format";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import type { Client } from "@/types/check-in";

type CheckInsTabContentProps = {
  client: Client;
  /**
   * The client page's tab handler (ARCHITECTURE → "Client page tab structure").
   * The detail's back row and its post-Send return both clear this tab's own
   * `?checkIn=` through it, so `activeTab` and the URL stay in step.
   */
  onTabChange: (tab: ClientTab, extraParams?: Record<string, string | null>) => void;
};

export const CheckInsTabContent = ({ client, onTabChange }: CheckInsTabContentProps) => {
  const searchParams = useSearchParams();
  // This tab's single-owner pane param — a record id, like Journey's `?block=`
  // — read unconditionally so a deep link resolves on the first render, before
  // the page's replace lands.
  const checkInId = searchParams.get("checkIn");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const {
    checkIns,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    isError,
    size,
    setSize,
    mutate,
  } = useClientCheckInsInfinite(client.id);
  const invalidateQueue = useInvalidateCheckInsQueue();
  const invalidateClientCheckIns = useInvalidateClientCheckIns();

  if (checkInId) {
    return (
      <CheckInDetailView
        checkInId={checkInId}
        client={client}
        onTabChange={onTabChange}
        onBack={() => onTabChange("check-ins", { checkIn: null })}
        onDone={() => {
          // The review is done (status → reviewed). This list refreshes through
          // its own bound mutate — a filter mutate cannot reach an infinite
          // reader — then the Journey reader's pages and the bell's queue.
          void mutate();
          void invalidateClientCheckIns(client.id);
          void invalidateQueue();
          onTabChange("check-ins", { checkIn: null });
        }}
      />
    );
  }

  // The rail sits ABOVE the body's four states, not inside the list: a coach
  // customises a client's form before their first check-in, so the entry point
  // has to survive the empty state.
  const body = isLoading ? (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-[#93b0b4]" />
    </div>
  ) : isError ? (
    <div className="bg-white rounded-[6px] p-6 text-center">
      <p className="text-sm text-[#93b0b4]">Failed to load check-ins.</p>
    </div>
  ) : checkIns.length === 0 ? (
    <div className="bg-white rounded-[6px] p-6 text-center">
      <p className="font-medium text-[#0c1a1e]">No check-ins yet</p>
      <p className="text-sm text-[#93b0b4] mt-1">
        This client hasn&apos;t submitted any check-ins.
      </p>
    </div>
  ) : (
    <div className="space-y-3">
      {checkIns.map((checkIn) => {
        const aiPreview = getAiPreview(checkIn.aiSummary);
        return (
          // A real link — the one push in the tab's URL contract, so browser
          // Back returns to this list.
          <Link
            key={checkIn.id}
            href={checkInReviewUrl(client.id, checkIn.id)}
            className="w-full text-left flex items-center justify-between gap-3 p-4 bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
          >
            <div className="min-w-0">
              <p className={cn(MONO, "text-sm font-semibold text-[#0c1a1e]")}>
                {format(new Date(checkIn.createdAt), "MMM d, yyyy")}
              </p>
              {aiPreview && (
                <p className="text-xs text-[#93b0b4] mt-0.5 line-clamp-1">
                  {aiPreview}
                </p>
              )}
              {checkIn.coachResponse && (
                <p className="text-xs text-[#5a7d82] mt-0.5 line-clamp-1">
                  Your reply: {checkIn.coachResponse}
                </p>
              )}
            </div>
            <div className="shrink-0">
              <CheckInStatusBadge status={checkIn.status} />
            </div>
          </Link>
        );
      })}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSize(size + 1)}
            disabled={isLoadingMore}
            className="bg-white border-[rgba(13,148,136,0.08)] text-[#5a7d82] hover:text-[#0d9488] hover:border-[#0d9488]"
          >
            {isLoadingMore ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Load older"
            )}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <SectionLabel
        label="Check-in history"
        meta={total > 0 ? pluralize(total, "check-in") : undefined}
        actions={
          <button
            type="button"
            onClick={() => setIsFormOpen(true)}
            aria-label="Customise check-in"
            title="Customise check-in"
            className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        }
      />

      {body}

      <CheckInFormSheet
        client={client}
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
      />
    </div>
  );
};
