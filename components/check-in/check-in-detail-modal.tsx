"use client";

import { useEffect, useState } from "react";
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
import type { CheckIn, GetCheckInComparisonResponse } from "@/types/check-in";
import type { DailyLog } from "@/types/daily-log";
import type { HabitLogWithDetails } from "@/types/daily-habit";

type CheckInDetailModalProps = {
  checkInId: string | null;
  clientId: string;
  clientName: string;
  onClose: () => void;
  onNavigate?: (direction: "prev" | "next") => void;
  canNavigatePrev?: boolean;
  canNavigateNext?: boolean;
};

type CheckInWithClient = {
  checkIn: CheckIn;
  client: {
    id: string;
    name: string;
    email?: string;
    avatar_url?: string;
  } | null;
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
  const [data, setData] = useState<CheckInWithClient | null>(null);
  const [comparisonData, setComparisonData] = useState<GetCheckInComparisonResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingComparison, setIsLoadingComparison] = useState(false);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLogWithDetails[]>([]);
  const [dailyContextLoading, setDailyContextLoading] = useState(false);
  const [contextStartDate, setContextStartDate] = useState<Date | null>(null);
  const [contextEndDate, setContextEndDate] = useState<Date | null>(null);

  useEffect(() => {
    if (!checkInId) {
      setData(null);
      setComparisonData(null);
      return;
    }

    const fetchCheckIn = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/check-in/${checkInId}`);
        if (response.ok) {
          const result = await response.json();
          setData(result);
        }
      } catch (error) {
        console.error("Error fetching check-in:", error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    const fetchComparison = async () => {
      setIsLoadingComparison(true);
      try {
        const response = await fetch(`/api/check-in/${checkInId}/comparison`);
        if (response.ok) {
          const result = await response.json();
          setComparisonData(result);
        }
      } catch (error) {
        console.error("Error fetching comparison:", error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsLoadingComparison(false);
      }
    };

    fetchCheckIn();
    fetchComparison();
  }, [checkInId]);

  // Fetch daily context when check-in data is available
  useEffect(() => {
    if (!data?.checkIn || !clientId) {
      setDailyLogs([]);
      setHabitLogs([]);
      setContextStartDate(null);
      setContextEndDate(null);
      return;
    }

    const fetchDailyContext = async () => {
      setDailyContextLoading(true);
      try {
        const currentCheckIn = data.checkIn;
        let startDate: Date;
        let endDate: Date;

        // Use stored period from check-in if available, otherwise fallback to 7 days
        if (currentCheckIn.periodStart && currentCheckIn.periodEnd) {
          startDate = new Date(currentCheckIn.periodStart + "T00:00:00");
          endDate = new Date(currentCheckIn.periodEnd + "T00:00:00");
        } else {
          endDate = new Date(currentCheckIn.createdAt);
          startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - 6);
        }

        // Store the calculated dates for use in the component
        setContextStartDate(startDate);
        setContextEndDate(endDate);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        // Fetch both daily logs and habit logs in parallel
        const [logsResponse, habitsResponse] = await Promise.all([
          fetch(
            `/api/clients/${clientId}/daily-logs?startDate=${startDateStr}&endDate=${endDateStr}`,
            { cache: 'no-store' }
          ),
          fetch(
            `/api/clients/${clientId}/habits/logs?startDate=${startDateStr}&endDate=${endDateStr}`,
            { cache: 'no-store' }
          ),
        ]);

        if (logsResponse.ok) {
          const logsData = await logsResponse.json();
          setDailyLogs(logsData.data || []);
        }

        if (habitsResponse.ok) {
          const habitsData = await habitsResponse.json();
          setHabitLogs(habitsData.data || []);
        }
      } catch (error) {
        console.error('Error fetching daily context:', error instanceof Error ? error.message : "Unknown error");
      } finally {
        setDailyContextLoading(false);
      }
    };

    fetchDailyContext();
  }, [data?.checkIn?.id, checkInId, clientId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!checkInId) return;

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && canNavigatePrev && onNavigate) {
        onNavigate("prev");
      } else if (e.key === "ArrowRight" && canNavigateNext && onNavigate) {
        onNavigate("next");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkInId, canNavigatePrev, canNavigateNext, onNavigate, onClose]);

  const handleResponseSent = () => {
    // Refresh data after response sent
    if (checkInId) {
      fetch(`/api/check-in/${checkInId}`)
        .then((res) => res.json())
        .then((result) => setData(result));
    }
  };

  const formatDateRange = (start: Date, end: Date) => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    if (sameMonth) {
      return `Week of ${months[start.getMonth()]} ${start.getDate()} \u2013 ${end.getDate()}, ${end.getFullYear()}`;
    }
    const sameYear = start.getFullYear() === end.getFullYear();
    if (sameYear) {
      return `Week of ${months[start.getMonth()]} ${start.getDate()} \u2013 ${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    }
    return `Week of ${months[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} \u2013 ${months[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  };

  const formatSubmittedDate = (dateStr: string) => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = new Date(dateStr);
    return `Submitted ${months[d.getMonth()]} ${d.getDate()}`;
  };

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
                  {/* KPI Ribbon */}
                  {contextStartDate && contextEndDate && (
                    <KPIRibbon
                      checkIn={data.checkIn}
                      dailyLogs={dailyLogs}
                      comparisonData={comparisonData}
                      contextStartDate={contextStartDate}
                      contextEndDate={contextEndDate}
                    />
                  )}

                  {/* Two-column layout: Data | AI */}
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5 items-start">
                    {/* Left: Data sections */}
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

                    {/* Right: AI Analysis + Coach Response */}
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
