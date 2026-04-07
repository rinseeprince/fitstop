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
import { AISummaryCard } from "./ai-summary-card";
import { CheckInResponseEditor } from "./check-in-response-editor";
import { CheckInComparisonView } from "./check-in-comparison-view";
import { GoalProgressView } from "./goal-progress-view";
import { KPIRibbon } from "./kpi-ribbon";
import { WellnessSection } from "./wellness-section";
import { NutritionSection } from "./nutrition-section";
import { TrainingSection } from "./training-section";
import { ClientNotesSection } from "./client-notes-section";
import { HabitsSection } from "./habits-section";
import { useCheckInDetailData, formatDateRange, formatSubmittedDate } from "@/hooks/use-check-in-detail-data";

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
    trainingPeriodStats,
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

  return (
    <Dialog open={!!checkInId} onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="bg-card rounded-lg shadow-md p-0 max-w-[90vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[80vw] w-full max-h-[90vh] overflow-hidden flex flex-col">
        <Tabs defaultValue="current" className="flex flex-col flex-1 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <DialogTitle className="text-lg font-semibold text-foreground">
                  {clientName} &ndash; Check-In Review
                </DialogTitle>
                {onNavigate && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onNavigate("prev")}
                      disabled={!canNavigatePrev}
                      className="w-5 h-5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all disabled:opacity-50"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onNavigate("next")}
                      disabled={!canNavigateNext}
                      className="w-5 h-5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-all disabled:opacity-50"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
              {contextStartDate && contextEndDate && data && !dailyContextLoading && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{formatDateRange(contextStartDate, contextEndDate)}</span>
                  <span>&middot;</span>
                  <span>{formatSubmittedDate(data.checkIn.createdAt)}</span>
                  <span>&middot;</span>
                  <span className="inline-flex items-center text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400 px-1.5 py-0.5 rounded">
                    {dailyLogs.length}/{daysDiff} days logged
                  </span>
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <TabsList className="bg-muted p-1 rounded-lg inline-flex">
                <TabsTrigger
                  value="current"
                  className="px-3 py-1.5 text-xs font-medium rounded-md transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
                >
                  Current Check-In
                </TabsTrigger>
                <TabsTrigger
                  value="comparison"
                  className="px-3 py-1.5 text-xs font-medium rounded-md transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
                >
                  Comparison & Trends
                </TabsTrigger>
                <TabsTrigger
                  value="goals"
                  className="px-3 py-1.5 text-xs font-medium rounded-md transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
                >
                  Goal Progress
                </TabsTrigger>
              </TabsList>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {isLoading || dailyContextLoading || (data && !contextStartDate) ? (
          <div className="flex items-center justify-center py-12 px-6">
            <div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" />
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
                      trainingPeriodStats={trainingPeriodStats}
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
                            dailyLogs={dailyLogs}
                            checkIn={data.checkIn}
                            contextStartDate={contextStartDate}
                            contextEndDate={contextEndDate}
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
                      <div>
                        <AISummaryCard
                          checkInId={checkInId}
                          summary={data.checkIn.aiSummary}
                          aiInsights={data.checkIn.aiInsights}
                          recommendations={data.checkIn.aiRecommendations}
                          onUpdate={handleResponseSent}
                        />
                      </div>
                      <CheckInResponseEditor
                        checkInId={checkInId}
                        clientName={data.client?.name || "Client"}
                        onSent={handleResponseSent}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="comparison">
                  {isLoadingComparison ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" />
                    </div>
                  ) : comparisonData ? (
                    <CheckInComparisonView
                      comparison={comparisonData.comparison}
                      chartData={comparisonData.chartData}
                    />
                  ) : (
                    <div className="text-center py-12 text-sm text-muted-foreground">
                      Failed to load comparison data
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="goals">
                  {isLoadingComparison ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" />
                    </div>
                  ) : comparisonData ? (
                    <GoalProgressView
                      goalProgress={comparisonData.goalProgress}
                      clientName={data.client?.name || "Client"}
                      clientData={comparisonData.comparison.client}
                    />
                  ) : (
                    <div className="text-center py-12 text-sm text-muted-foreground">
                      Failed to load goal progress data
                    </div>
                  )}
                </TabsContent>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 px-6 text-sm text-muted-foreground">
            Failed to load check-in data
          </div>
        )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
