"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { CheckInReviewSection } from "@/components/check-in/check-in-review-section";
import { KPIRibbon } from "@/components/check-in/kpi-ribbon";
import { WellnessSection } from "@/components/check-in/wellness-section";
import { WeekGrid } from "@/components/check-in/week-grid";
import { ClientNotesSection } from "@/components/check-in/client-notes-section";
import { HabitsSection } from "@/components/check-in/habits-section";
import { CheckInReviewHeader } from "./check-in-review-header";
import { CheckInReplyBlock } from "./check-in-reply-block";
import { CheckInGoalStrip } from "./check-in-goal-strip";
import { useCheckInDetailData } from "@/hooks/use-check-in-detail-data";
import { summariseTraining } from "@/lib/training-adherence";
import { toCheckInReview } from "@/lib/check-in/to-review";
import { expandDateRange, getDateString } from "@/lib/date-helpers";
import { OPEN_GOALS_SHEET_PARAM, type ClientTab } from "@/lib/client-tabs";
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
  /**
   * The client page's tab handler. Cross-tab navigation goes through it or the
   * URL changes while the visible tab does not — `activeTab` is seeded from
   * `?tab=` at mount only.
   */
  onTabChange: (tab: ClientTab, extraParams?: Record<string, string | null>) => void;
};

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
 * its list when `?checkIn=<id>` is present.
 *
 * One page, read top to bottom in the order the review runs: what happened
 * (the band), what the week looked like (training, nutrition, wellness,
 * habits, the client's own words), where they stand (goals), and what gets
 * sent back (the AI review and the reply).
 *
 * **Each section renders its OWN rail**, inside the component that decides
 * whether there is something to show. Three of them return null on an empty
 * week, and a rail owned by this page would leave a bare label over empty
 * space — or force this page to hold a second copy of each child's
 * emptiness predicate.
 */
export const CheckInDetailView = ({
  checkInId,
  client,
  onBack,
  onDone,
  onTabChange,
}: CheckInDetailViewProps) => {
  const {
    data,
    isLoading,
    isForeign,
    comparisonData,
    isLoadingComparison,
    dailyLogs,
    trainingEventDetails,
    periodAdherence,
    dailyContextLoading,
    contextStartDate,
    contextEndDate,
    refreshDetail,
  } = useCheckInDetailData({ checkInId, clientId: client.id });

  // The one training derivation for this surface: completed (full + PARTIAL)
  // over planned, from the period's own workouts with each one's quality read
  // off its log. The ribbon and the pills beside it come out of this one run.
  const adherence = summariseTraining(trainingEventDetails);
  const clientName = data?.client?.name || client.name;
  // Both the Review section and the Reply block read it; narrowing on it below
  // is what lets them share one call.
  const review = data ? toCheckInReview(data.checkIn) : null;

  const ready = Boolean(data && contextStartDate && contextEndDate);

  return (
    <div className="space-y-5">
      <CheckInReviewHeader
        onBack={onBack}
        meta={
          data && contextStartDate && contextEndDate && !isForeign && !dailyContextLoading
            ? {
                start: contextStartDate,
                end: contextEndDate,
                submittedAt: data.checkIn.createdAt,
                // Days with any client log, from the same server date lists the
                // cells divide by (lib/logged-days.ts through the adherence
                // kernel) — never a count of the daily-log rows this page holds,
                // which only wellness and nutrition create.
                daysLogged: periodAdherence
                  ? {
                      logged: periodAdherence.loggedDates.length,
                      inPeriod: periodAdherence.dates.length,
                    }
                  : null,
                daysSinceLast: comparisonData?.comparison.timeBetweenCheckIns,
              }
            : null
        }
      />

      {isForeign ? (
        <Notice>This check-in belongs to another client.</Notice>
      ) : isLoading || dailyContextLoading || (data && !contextStartDate) ? (
        <Spinner />
      ) : data && review && ready && contextStartDate && contextEndDate ? (
        <>
          <KPIRibbon
            checkIn={data.checkIn}
            comparisonData={comparisonData}
            adherence={adherence}
            nutrition={periodAdherence?.nutrition ?? null}
          />

          {/* The week, one line per day: its workouts, its calories and macros
              over that day's target, and its word. Its days are the copy's; a
              legacy row whose copy saved no week shows its training over the
              check-in's own period. */}
          <WeekGrid
            dates={
              periodAdherence?.dates ??
              expandDateRange(getDateString(contextStartDate), getDateString(contextEndDate))
            }
            workouts={trainingEventDetails}
            highlights={data.checkIn.exerciseHighlights ?? []}
            nutrition={periodAdherence?.nutrition ?? null}
          />

          <WellnessSection
            dailyLogs={dailyLogs}
            contextStartDate={contextStartDate}
            contextEndDate={contextEndDate}
            changes={comparisonData?.comparison.changes ?? null}
          />

          <HabitsSection perHabit={periodAdherence?.habits.perHabit ?? []} />

          <ClientNotesSection checkIn={data.checkIn} />

          {/* Goal progress is the one section the comparison read feeds on its
              own, so it carries that read's loading and failure states rather
              than the page doing. The band's deltas and the wellness deltas
              degrade in place. The strip renders its own rail, like every other
              section — these two states are what needs one when it cannot. */}
          {isLoadingComparison ? (
            <div>
              <SectionLabel label="Goal progress" />
              <Spinner />
            </div>
          ) : comparisonData ? (
            <CheckInGoalStrip
              goalProgress={comparisonData.goalProgress}
              clientName={clientName}
              clientData={comparisonData.comparison.client}
              // The goals sheet is the Overview's. `checkIn: null` goes with
              // it so Back does not land on a review left behind.
              onSetNewGoals={() =>
                onTabChange("overview", {
                  [OPEN_GOALS_SHEET_PARAM]: "1",
                  checkIn: null,
                })
              }
            />
          ) : (
            <div>
              <SectionLabel label="Goal progress" />
              <Notice>Failed to load goal progress data</Notice>
            </div>
          )}

          <CheckInReviewSection
            checkInId={checkInId}
            review={review}
            onRefresh={refreshDetail}
          />

          <CheckInReplyBlock
            checkInId={checkInId}
            clientName={clientName}
            draft={review.clientMessage}
            sentMessage={data.checkIn.coachResponse}
            sentAt={data.checkIn.responseSentAt}
            onSent={onDone}
          />
        </>
      ) : (
        <Notice>Failed to load check-in data</Notice>
      )}
    </div>
  );
};
