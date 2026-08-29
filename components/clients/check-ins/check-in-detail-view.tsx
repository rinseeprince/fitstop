"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { CheckInReviewRail } from "@/components/check-in/check-in-review-rail";
import { CheckInComparisonView } from "@/components/check-in/check-in-comparison-view";
import { GoalProgressView } from "@/components/check-in/goal-progress-view";
import { KPIRibbon } from "@/components/check-in/kpi-ribbon";
import { WellnessSection } from "@/components/check-in/wellness-section";
import { NutritionSection } from "@/components/check-in/nutrition-section";
import { TrainingSection } from "@/components/check-in/training-section";
import { ClientNotesSection } from "@/components/check-in/client-notes-section";
import { HabitsSection } from "@/components/check-in/habits-section";
import { useCheckInDetailData } from "@/hooks/use-check-in-detail-data";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import { summariseSessions } from "@/lib/check-in/adherence";
import { toCheckInReview } from "@/lib/check-in/to-review";
import type { Client } from "@/types/check-in";

type CheckInDetailViewProps = {
  checkInId: string;
  client: Client;
  /** The back row: clears `?checkIn=` through the tab handler. */
  onBack: () => void;
  /**
   * The coach's reply was sent — the review is done. The tab refreshes its
   * list and the queues, then returns to the list.
   */
  onDone: () => void;
};

const PANES = [
  { value: "current", label: "Current Check-In" },
  { value: "comparison", label: "Comparison & Trends" },
  { value: "goals", label: "Goal Progress" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateRange(start: Date, end: Date): string {
  const sameMonth =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `Week of ${MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    return `Week of ${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `Week of ${MONTHS[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

function formatSubmittedDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `Submitted ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const Spinner = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="h-5 w-5 animate-spin text-[#93b0b4]" />
  </div>
);

const Notice = ({ children }: { children: ReactNode }) => (
  <div className="bg-white rounded-[6px] p-6 text-center">
    <p className="text-sm text-[#93b0b4]">{children}</p>
  </div>
);

/**
 * The coach's review of one check-in, rendered by the Check-ins tab in place of
 * its list when `?checkIn=<id>` is present. The three panes came over from the
 * modal intact: a controlled Tabs driven by the shared SegmentedControl (the
 * reference pairing named in docs/newdesignsystem.md → Segmented control).
 * Comparison & Trends and Goal Progress are carried as they were — their
 * redesign is a separate session.
 */
export const CheckInDetailView = ({ checkInId, client, onBack, onDone }: CheckInDetailViewProps) => {
  const [tab, setTab] = useState("current");
  const {
    data,
    isLoading,
    isForeign,
    comparisonData,
    isLoadingComparison,
    dailyLogs,
    habitLogs,
    dailyContextLoading,
    contextStartDate,
    contextEndDate,
    fullWeekTarget,
    refreshDetail,
  } = useCheckInDetailData({ checkInId, clientId: client.id });

  const daysDiff =
    contextStartDate && contextEndDate
      ? Math.round((contextEndDate.getTime() - contextStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
      : 7;

  // Single source of training adherence (completed / prescribed) derived from the
  // check-in's session completions. Shared by the hero card, the prescription
  // panel and the comparison tab so the figure is identical everywhere.
  const adherence = summariseSessions(data?.checkIn.sessionCompletions ?? []);
  const clientName = data?.client?.name || client.name;

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          {/* The sidebar back-row grammar: the arrow is the affordance, the
              label names the destination. */}
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to check-ins"
            className="group flex items-center gap-2.5"
          >
            <ArrowLeft
              className="h-4 w-4 text-[#93b0b4] transition-colors group-hover:text-[#5a7d82]"
              strokeWidth={1.5}
            />
            <span className="text-[13.5px] font-semibold text-[#0c1a1e]">Check-ins</span>
          </button>
          {contextStartDate && contextEndDate && data && !isForeign && !dailyContextLoading && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#93b0b4]">
              <span className={MONO}>{formatDateRange(contextStartDate, contextEndDate)}</span>
              <span>&middot;</span>
              <span className={MONO}>{formatSubmittedDate(data.checkIn.createdAt)}</span>
              <span>&middot;</span>
              <span
                className={cn(
                  "inline-flex items-center text-xs font-semibold",
                  MONO,
                  "text-[#0d9488] bg-[rgba(13,148,136,0.08)] px-1.5 py-0.5 rounded-[4px]"
                )}
              >
                {dailyLogs.length}/{daysDiff} days logged
              </span>
            </p>
          )}
        </div>
        <SegmentedControl options={PANES} value={tab} onChange={setTab} />
      </div>

      {isForeign ? (
        <Notice>This check-in belongs to another client.</Notice>
      ) : isLoading || dailyContextLoading || (data && !contextStartDate) ? (
        <Spinner />
      ) : data && contextStartDate && contextEndDate ? (
        <>
          <TabsContent value="current" className="space-y-5">
            <KPIRibbon
              checkIn={data.checkIn}
              dailyLogs={dailyLogs}
              comparisonData={comparisonData}
              contextStartDate={contextStartDate}
              contextEndDate={contextEndDate}
              fullWeekTarget={fullWeekTarget}
              adherence={adherence}
            />

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5 items-start">
              <div className="space-y-4">
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
                <TrainingSection checkIn={data.checkIn} adherence={adherence} />
                <HabitsSection
                  habitLogs={habitLogs}
                  contextStartDate={contextStartDate}
                  contextEndDate={contextEndDate}
                />
                <ClientNotesSection checkIn={data.checkIn} />
              </div>

              {/* The client band is sticky at the top of the page scroller, so
                  the rail pins below it rather than sliding under. */}
              <div className="lg:sticky lg:top-[52px] space-y-5">
                <CheckInReviewRail
                  checkInId={checkInId}
                  clientName={clientName}
                  review={toCheckInReview(data.checkIn)}
                  onRefresh={refreshDetail}
                  onSent={onDone}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="comparison">
            {isLoadingComparison ? (
              <Spinner />
            ) : comparisonData ? (
              <CheckInComparisonView
                comparison={comparisonData.comparison}
                chartData={comparisonData.chartData}
                adherence={adherence}
              />
            ) : (
              <Notice>Failed to load comparison data</Notice>
            )}
          </TabsContent>

          <TabsContent value="goals">
            {isLoadingComparison ? (
              <Spinner />
            ) : comparisonData ? (
              <GoalProgressView
                goalProgress={comparisonData.goalProgress}
                clientName={clientName}
                clientData={comparisonData.comparison.client}
              />
            ) : (
              <Notice>Failed to load goal progress data</Notice>
            )}
          </TabsContent>
        </>
      ) : (
        <Notice>Failed to load check-in data</Notice>
      )}
    </Tabs>
  );
};
