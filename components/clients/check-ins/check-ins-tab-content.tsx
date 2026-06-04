"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { CheckInDetailModal } from "@/components/check-in/check-in-detail-modal";
import { CheckInStatusBadge } from "./check-in-status-badge";
import { useClientCheckInsInfinite } from "@/hooks/use-check-in-data";
import { getAiPreview } from "@/lib/check-in-helpers";
import type { Client } from "@/types/check-in";

type CheckInsTabContentProps = {
  client: Client;
};

export const CheckInsTabContent = ({ client }: CheckInsTabContentProps) => {
  const {
    checkIns,
    hasMore,
    isLoading,
    isLoadingMore,
    isError,
    size,
    setSize,
  } = useClientCheckInsInfinite(client.id);
  const [selectedCheckInId, setSelectedCheckInId] = useState<string | null>(
    null
  );

  const selectedIndex = selectedCheckInId
    ? checkIns.findIndex((ci) => ci.id === selectedCheckInId)
    : -1;

  const handleNavigate = (direction: "prev" | "next") => {
    if (selectedIndex === -1) return;
    const newIndex =
      direction === "prev" ? selectedIndex - 1 : selectedIndex + 1;
    if (newIndex >= 0 && newIndex < checkIns.length) {
      setSelectedCheckInId(checkIns[newIndex].id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[#93b0b4]" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-[6px] p-6 text-center">
        <p className="text-sm text-[#93b0b4]">Failed to load check-ins.</p>
      </div>
    );
  }

  if (checkIns.length === 0) {
    return (
      <div className="bg-white rounded-[6px] p-6 text-center">
        <p className="font-medium text-[#0c1a1e]">No check-ins yet</p>
        <p className="text-sm text-[#93b0b4] mt-1">
          This client hasn&apos;t submitted any check-ins.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {checkIns.map((checkIn) => {
        const aiPreview = getAiPreview(checkIn.aiSummary);
        return (
          <button
            key={checkIn.id}
            onClick={() => setSelectedCheckInId(checkIn.id)}
            className="w-full text-left flex items-center justify-between gap-3 p-4 bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#0c1a1e] font-mono-display">
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
          </button>
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

      <CheckInDetailModal
        checkInId={selectedCheckInId}
        clientId={client.id}
        clientName={client.name}
        onClose={() => setSelectedCheckInId(null)}
        onNavigate={handleNavigate}
        canNavigatePrev={selectedIndex > 0}
        canNavigateNext={
          selectedIndex < checkIns.length - 1 && selectedIndex !== -1
        }
      />
    </div>
  );
};
