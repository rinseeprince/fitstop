"use client";

import { X, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckInReviewRail } from "./check-in-review-rail";
import { CheckInComparisonView } from "./check-in-comparison-view";
import { GoalProgressView } from "./goal-progress-view";
import { KPIRibbon } from "./kpi-ribbon";
import { WellnessSection } from "./wellness-section";
import { NutritionSection } from "./nutrition-section";
import { TrainingSection } from "./training-section";
import { ClientNotesSection } from "./client-notes-section";
import { HabitsSection } from "./habits-section";
import { useCheckInDetailData, formatDateRange, formatSubmittedDate } from "@/hooks/use-check-in-detail-data";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import { summariseSessions } from "@/lib/check-in/adherence";
import { toCheckInReview } from "@/lib/check-in/to-review";

type CheckInDetailModalProps = {
  checkInId: string | null;
  clientId: string;
  clientName: string;
  onClose: () => void;
  onNavigate?: (direction: "prev" | "next") => void;
  canNavigatePrev?: boolean;
  canNavigateNext?: boolean;
};

export const CheckInDetailModal = ({
  checkInId,
  clientId,
  clientName,
  onClose,
  onNavigate,
  canNavigatePrev = false,
  canNavigateNext = false,
}: CheckInDetailModalProps) => {
  const {
    data,
    comparisonData,
    isLoading,
    isLoadingComparison,
    dailyLogs,
    habitLogs,
    dailyContextLoading,
    contextStartDate,
    contextEndDate,
    fullWeekTarget,
    handleResponseSent,
  } = useCheckInDetailData({
    checkInId,
    clientId,
    onClose,
    onNavigate,
    canNavigatePrev,
    canNavigateNext,
  });

  if (!checkInId) return null;

  const daysDiff = contextStartDate && contextEndDate
    ? Math.round((contextEndDate.getTime() - contextStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 7;

  // Single source of training adherence (completed / prescribed) derived from the
  // check-in's session completions. Shared by the hero card, the prescription
  // panel and the comparison tab so the figure is identical everywhere.
  const adherence = summariseSessions(data?.checkIn.sessionCompletions ?? []);

  return (
    <Dialog open={!!checkInId} onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="bg-[#f4f7f6] rounded-[6px] shadow-[0_10px_40px_rgba(13,148,136,0.10)] p-0 max-w-[90vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[80vw] w-full max-h-[90vh] overflow-hidden flex flex-col">
        <Tabs defaultValue="current" className="flex flex-col flex-1 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <DialogTitle className="text-lg font-semibold text-[#0c1a1e]">
                  {clientName} &ndash; Check-In Review
                </DialogTitle>
                {onNavigate && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onNavigate("prev")}
                      disabled={!canNavigatePrev}
                      className="w-5 h-5 text-[#93b0b4] hover:text-[#5a7d82] hover:bg-[rgba(13,148,136,0.05)] rounded-[4px] transition-all disabled:opacity-50"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onNavigate("next")}
                      disabled={!canNavigateNext}
                      className="w-5 h-5 text-[#93b0b4] hover:text-[#5a7d82] hover:bg-[rgba(13,148,136,0.05)] rounded-[4px] transition-all disabled:opacity-50"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
              {contextStartDate && contextEndDate && data && !dailyContextLoading && (
                <p className="text-xs text-[#93b0b4] mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className={MONO}>{formatDateRange(contextStartDate, contextEndDate)}</span>
                  <span>&middot;</span>
                  <span className={MONO}>{formatSubmittedDate(data.checkIn.createdAt)}</span>
                  <span>&middot;</span>
                  <span className={cn("inline-flex items-center text-xs font-semibold", MONO, "text-[#0d9488] bg-[rgba(13,148,136,0.08)] px-1.5 py-0.5 rounded-[4px]")}>
                    {dailyLogs.length}/{daysDiff} days logged
                  </span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <TabsList className="bg-[rgba(13,148,136,0.05)] p-0.5 rounded-[6px] inline-flex">
                <TabsTrigger
                  value="current"
                  className="px-3 py-1.5 text-xs font-medium rounded-[4px] transition-all data-[state=active]:bg-white data-[state=active]:text-[#0c1a1e] data-[state=active]:shadow-[0_1px_3px_rgba(0,0,0,0.05)] data-[state=inactive]:text-[#5a7d82] data-[state=inactive]:hover:text-[#0c1a1e]"
                >
                  Current Check-In
                </TabsTrigger>
                <TabsTrigger
                  value="comparison"
                  className="px-3 py-1.5 text-xs font-medium rounded-[4px] transition-all data-[state=active]:bg-white data-[state=active]:text-[#0c1a1e] data-[state=active]:shadow-[0_1px_3px_rgba(0,0,0,0.05)] data-[state=inactive]:text-[#5a7d82] data-[state=inactive]:hover:text-[#0c1a1e]"
                >
                  Comparison & Trends
                </TabsTrigger>
                <TabsTrigger
                  value="goals"
                  className="px-3 py-1.5 text-xs font-medium rounded-[4px] transition-all data-[state=active]:bg-white data-[state=active]:text-[#0c1a1e] data-[state=active]:shadow-[0_1px_3px_rgba(0,0,0,0.05)] data-[state=inactive]:text-[#5a7d82] data-[state=inactive]:hover:text-[#0c1a1e]"
                >
                  Goal Progress
                </TabsTrigger>
              </TabsList>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="w-9 h-9 text-[#93b0b4] hover:text-[#5a7d82] hover:bg-[rgba(13,148,136,0.05)] rounded-[6px] transition-all"
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {isLoading || dailyContextLoading || (data && !contextStartDate) ? (
          <div className="flex items-center justify-center py-12 px-6">
            <div className="w-5 h-5 border-2 border-[rgba(13,148,136,0.15)] border-t-[#0d9488] rounded-full animate-spin" />
          </div>
        ) : data ? (
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 pt-0 pb-5">

                <TabsContent value="current" className="space-y-5">
                  {contextStartDate && contextEndDate && (
                    <KPIRibbon
                      checkIn={data.checkIn}
                      dailyLogs={dailyLogs}
                      comparisonData={comparisonData}
                      contextStartDate={contextStartDate}
                      contextEndDate={contextEndDate}
                      fullWeekTarget={fullWeekTarget}
                      adherence={adherence}
                    />
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5 items-start">
                    <div className="space-y-4">
                      {contextStartDate && contextEndDate && (
                        <>
                          <WellnessSection
                            dailyLogs={dailyLogs}
                            contextStartDate={contextStartDate}
                            contextEndDate={contextEndDate}
                          />
                          <NutritionSection
                            dailyLogs={dailyLogs}
                            contextStartDate={contextStartDate}
                            contextEndDate={contextEndDate}
                            fullWeekTarget={fullWeekTarget}
                          />
                          <TrainingSection
                            checkIn={data.checkIn}
                            adherence={adherence}
                          />
                        </>
                      )}
                      {contextStartDate && contextEndDate && (
                        <HabitsSection
                          habitLogs={habitLogs}
                          contextStartDate={contextStartDate}
                          contextEndDate={contextEndDate}
                        />
                      )}
                      <ClientNotesSection checkIn={data.checkIn} />
                    </div>

                    <div className="lg:sticky lg:top-0 space-y-5">
                      <CheckInReviewRail
                        checkInId={checkInId}
                        clientName={data.client?.name || "Client"}
                        review={toCheckInReview(data.checkIn)}
                        onRefresh={handleResponseSent}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="comparison">
                  {isLoadingComparison ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-5 h-5 border-2 border-[rgba(13,148,136,0.15)] border-t-[#0d9488] rounded-full animate-spin" />
                    </div>
                  ) : comparisonData ? (
                    <CheckInComparisonView
                      comparison={comparisonData.comparison}
                      chartData={comparisonData.chartData}
                      adherence={adherence}
                    />
                  ) : (
                    <div className="text-center py-12 text-sm text-[#93b0b4]">
                      Failed to load comparison data
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="goals">
                  {isLoadingComparison ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-5 h-5 border-2 border-[rgba(13,148,136,0.15)] border-t-[#0d9488] rounded-full animate-spin" />
                    </div>
                  ) : comparisonData ? (
                    <GoalProgressView
                      goalProgress={comparisonData.goalProgress}
                      clientName={data.client?.name || "Client"}
                      clientData={comparisonData.comparison.client}
                    />
                  ) : (
                    <div className="text-center py-12 text-sm text-[#93b0b4]">
                      Failed to load goal progress data
                    </div>
                  )}
                </TabsContent>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 px-6 text-sm text-[#93b0b4]">
            Failed to load check-in data
          </div>
        )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
