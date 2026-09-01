"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { CheckInReviewSection } from "@/components/check-in/check-in-review-section";
import { KPIRibbon } from "@/components/check-in/kpi-ribbon";
import { WellnessSection } from "@/components/check-in/wellness-section";
import { NutritionSection } from "@/components/check-in/nutrition-section";
import { TrainingSection } from "@/components/check-in/training-section";
import { ClientNotesSection } from "@/components/check-in/client-notes-section";
import { HabitsSection } from "@/components/check-in/habits-section";
import { CheckInReviewHeader } from "./check-in-review-header";
import { CheckInReplyBlock } from "./check-in-reply-block";
import { CheckInGoalStrip } from "./check-in-goal-strip";
import { useCheckInDetailData } from "@/hooks/use-check-in-detail-data";
import { summariseSessions } from "@/lib/check-in/adherence";
import { toCheckInReview } from "@/lib/check-in/to-review";
import { OPEN_PROFILE_EDITOR_PARAM, type ClientTab } from "@/lib/client-tabs";
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
 * whether there is something to show. Five of them return null on an empty
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
    periodAdherence,
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
  // check-in's session completions. Shared by the band, the training section
  // and the comparison so the figure is identical everywhere.
  const adherence = summariseSessions(data?.checkIn.sessionCompletions ?? []);
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
                daysLogged: dailyLogs.length,
                daysInPeriod: daysDiff,
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
            // The denominator is the server's own date list, never the local
            // day count — the two resolve differently on a legacy row.
            periodDays={periodAdherence?.dates.length ?? null}
          />

          {/* Flex, not a 2-col grid: either section returns null on an empty
              week, and a grid would leave a hole where the missing one was.
              Both carry `flex-1`, so a lone survivor takes the whole row and
              this page never has to ask which of them rendered. */}
          <div className="flex flex-col gap-5 lg:flex-row">
            <TrainingSection checkIn={data.checkIn} adherence={adherence} />

            <NutritionSection
              dailyLogs={dailyLogs}
              contextStartDate={contextStartDate}
              contextEndDate={contextEndDate}
              fullWeekTarget={fullWeekTarget}
              nutrition={periodAdherence?.nutrition ?? null}
              periodDays={periodAdherence?.dates.length ?? null}
            />
          </div>

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
              // The goal editor is the Overview's details sheet. `checkIn: null`
              // goes with it so Back does not land on a review left behind.
              onSetNewGoals={() =>
                onTabChange("overview", {
                  [OPEN_PROFILE_EDITOR_PARAM]: "1",
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
