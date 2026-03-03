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
import { CheckInDataDisplay } from "./check-in-data-display";
import { AISummaryCard } from "./ai-summary-card";
import { CheckInResponseEditor } from "./check-in-response-editor";
import { CheckInComparisonView } from "./check-in-comparison-view";
import { GoalProgressView } from "./goal-progress-view";
import { DailyContextSummary } from "./daily-context-summary";
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
        console.error("Error fetching check-in:", error);
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
        console.error("Error fetching comparison:", error);
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
        // Calculate date range based on check-in logic
        const currentCheckIn = data.checkIn;
        const endDate = new Date(currentCheckIn.createdAt);
        
        // Get previous check-in to determine start date
        let startDate: Date;
        const prevCheckInResponse = await fetch(
          `/api/check-in/${checkInId}/previous`,
          { cache: 'no-store' }
        );
        
        if (prevCheckInResponse.ok) {
          const prevData = await prevCheckInResponse.json();
          if (prevData.previousCheckIn) {
            // Start from day after previous check-in
            startDate = new Date(prevData.previousCheckIn.createdAt);
            startDate.setDate(startDate.getDate() + 1);
          } else {
            // No previous check-in, look back 7 days
            startDate = new Date(endDate);
            startDate.setDate(startDate.getDate() - 6);
          }
        } else {
          // Default to 7 days back
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
        console.error('Error fetching daily context:', error);
        // Don't fail the modal, just hide the daily context section
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

  if (!checkInId) return null;

  return (
    <Dialog open={!!checkInId} onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="bg-white rounded-2xl shadow-xl p-0 max-w-[90vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-[80vw] w-full max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold text-gray-900">
              {clientName} - Check-In Review
            </DialogTitle>
            <div className="flex items-center gap-1">
              {onNavigate && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onNavigate("prev")}
                    disabled={!canNavigatePrev}
                    className="w-9 h-9 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all disabled:opacity-50"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onNavigate("next")}
                    disabled={!canNavigateNext}
                    className="w-9 h-9 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all disabled:opacity-50"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="w-9 h-9 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {isLoading || dailyContextLoading ? (
          <div className="flex items-center justify-center py-12 px-6">
            <div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : data ? (
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-5">
              <Tabs defaultValue="current" className="w-full">
                <TabsList className="bg-gray-100 p-1 rounded-lg inline-flex mb-6">
                  <TabsTrigger
                    value="current"
                    className="px-4 py-2 text-sm font-medium rounded-md transition-all data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm data-[state=inactive]:text-gray-500 data-[state=inactive]:hover:text-gray-700"
                  >
                    Current Check-In
                  </TabsTrigger>
                  <TabsTrigger
                    value="comparison"
                    className="px-4 py-2 text-sm font-medium rounded-md transition-all data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm data-[state=inactive]:text-gray-500 data-[state=inactive]:hover:text-gray-700"
                  >
                    Comparison & Trends
                  </TabsTrigger>
                  <TabsTrigger
                    value="goals"
                    className="px-4 py-2 text-sm font-medium rounded-md transition-all data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm data-[state=inactive]:text-gray-500 data-[state=inactive]:hover:text-gray-700"
                  >
                    Goal Progress
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="current" className="space-y-6">
                  {/* Daily Context Summary - only show if there's data */}
                  {dailyLogs.length > 0 && data?.checkIn && contextStartDate && contextEndDate && (
                    <DailyContextSummary
                      dailyLogs={dailyLogs}
                      habitLogs={habitLogs}
                      startDate={contextStartDate}
                      endDate={contextEndDate}
                    />
                  )}
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Check-In Data</h3>
                      <CheckInDataDisplay checkIn={data.checkIn} />
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">AI Analysis</h3>
                      <AISummaryCard
                        checkInId={checkInId}
                        summary={data.checkIn.aiSummary}
                        insights={data.checkIn.aiInsights}
                        recommendations={data.checkIn.aiRecommendations}
                        onUpdate={handleResponseSent}
                      />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Response</h3>
                    <CheckInResponseEditor
                      checkInId={checkInId}
                      clientName={data.client?.name || "Client"}
                      onSent={handleResponseSent}
                    />
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
                    <div className="text-center py-12 text-sm text-gray-500">
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
                    <div className="text-center py-12 text-sm text-gray-500">
                      Failed to load goal progress data
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 px-6 text-sm text-gray-500">
            Failed to load check-in data
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
