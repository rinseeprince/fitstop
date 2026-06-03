"use client";

import { useState } from "react";
import { AppLayout } from "@/components/app-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CheckInDetailModal } from "@/components/check-in/check-in-detail-modal";
import { useUnreviewedCheckIns } from "@/hooks/use-check-in-data";
import { stripInlineMarkdown } from "@/lib/check-in/markdown";
import { AlertCircle, CheckCircle } from "lucide-react";
import Link from "next/link";
import { format, differenceInHours } from "date-fns";

export default function ReviewCheckInsPage() {
  const { checkIns: unreviewedCheckIns, isLoading, mutate } = useUnreviewedCheckIns();
  const [selectedCheckInId, setSelectedCheckInId] = useState<string | null>(null);
  const selectedIndex = selectedCheckInId
    ? unreviewedCheckIns.findIndex((ci) => ci.id === selectedCheckInId)
    : -1;

  const handleNavigate = (direction: "prev" | "next") => {
    if (!selectedCheckInId) return;

    const currentIndex = unreviewedCheckIns.findIndex((ci) => ci.id === selectedCheckInId);
    if (currentIndex === -1) return;

    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < unreviewedCheckIns.length) {
      setSelectedCheckInId(unreviewedCheckIns[newIndex].id);
    }
  };

  const handleReviewComplete = () => {
    mutate();
    setSelectedCheckInId(null);
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  // Teal Summit two-colour urgency: recent = teal, waiting over a day = amber.
  const getUrgencyBorder = (createdAt: string) => {
    const hours = differenceInHours(new Date(), new Date(createdAt));
    return hours > 24 ? "border-l-4 border-l-[#d97706]" : "border-l-4 border-l-[#0d9488]";
  };

  const getAiPreview = (aiSummary?: string) => {
    const clean = stripInlineMarkdown(aiSummary);
    if (!clean) return null;
    const firstSentence = clean.split(/[.!?]\s/)[0];
    return firstSentence.length > 120 ? firstSentence.slice(0, 120) + "..." : firstSentence;
  };

  const pageHeader = (
    <PageHeader
      title="Review Check-Ins"
      description="Review and provide feedback on client check-ins"
      backHref="/dashboard"
    />
  );

  return (
    <AppLayout pageHeader={pageHeader}>
      <div className="space-y-6">
        {isLoading ? (
          <div className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="w-8 h-8 border-4 border-[rgba(13,148,136,0.15)] border-t-[#0d9488] rounded-full animate-spin" />
              <p className="text-sm text-[#93b0b4]">Loading check-ins...</p>
            </div>
          </div>
        ) : unreviewedCheckIns.length === 0 ? (
          <div className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-6">
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <CheckCircle className="w-12 h-12 text-[#0d9488]" strokeWidth={1.5} />
              <div className="text-center space-y-1">
                <p className="font-semibold text-[#0c1a1e]">All caught up!</p>
                <p className="text-sm text-[#93b0b4]">
                  No check-ins pending review at the moment.
                </p>
              </div>
              <Button asChild className="bg-[#0d9488] hover:bg-[#0f766e] text-white">
                <Link href="/dashboard">Back to Dashboard</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Section header */}
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-[#0d9488]" strokeWidth={1.5} />
              <h2 className="text-[15px] font-bold text-[#0c1a1e]">
                Pending Review ({unreviewedCheckIns.length})
              </h2>
            </div>

            {/* Check-in cards */}
            <div className="space-y-3">
              {unreviewedCheckIns.map((checkIn) => {
                const aiPreview = getAiPreview(checkIn.aiSummary);
                return (
                  <div
                    key={checkIn.id}
                    className={`flex items-center justify-between p-4 bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] transition-all duration-150 cursor-pointer hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)] ${getUrgencyBorder(checkIn.createdAt)}`}
                    onClick={() => setSelectedCheckInId(checkIn.id)}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      {checkIn.clientAvatarUrl ? (
                        <img
                          src={checkIn.clientAvatarUrl}
                          alt={checkIn.clientName || "Client"}
                          className="h-12 w-12 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(13,148,136,0.1)] text-[#0d9488] font-semibold shrink-0">
                          {getInitials(checkIn.clientName || "Client")}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-[#0c1a1e]">
                          {checkIn.clientName || "Unknown Client"}
                        </p>
                        <p className="text-sm text-[#93b0b4] font-mono-display">
                          Submitted {format(new Date(checkIn.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                        {aiPreview && (
                          <p className="text-xs text-[#93b0b4] mt-0.5 line-clamp-1">
                            {aiPreview}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-[4px] bg-[rgba(13,148,136,0.08)] text-[#0d9488]">
                        AI Processed
                      </span>
                      <Button size="sm" className="bg-[#0d9488] hover:bg-[#0f766e] text-white">
                        Review
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <CheckInDetailModal
          checkInId={selectedCheckInId}
          clientId={selectedCheckInId ? unreviewedCheckIns.find((ci) => ci.id === selectedCheckInId)?.clientId || "" : ""}
          clientName={selectedCheckInId ? unreviewedCheckIns.find((ci) => ci.id === selectedCheckInId)?.clientName || "" : ""}
          onClose={handleReviewComplete}
          onNavigate={handleNavigate}
          canNavigatePrev={selectedIndex > 0}
          canNavigateNext={selectedIndex < unreviewedCheckIns.length - 1 && selectedIndex !== -1}
        />
      </div>
    </AppLayout>
  );
}
