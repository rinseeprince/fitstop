"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { CheckInReviewSection } from "@/components/check-in/check-in-review-section";
import { GoalProgressView } from "@/components/check-in/goal-progress-view";
import { KPIRibbon } from "@/components/check-in/kpi-ribbon";
import { WellnessSection } from "@/components/check-in/wellness-section";
import { NutritionSection } from "@/components/check-in/nutrition-section";
import { TrainingSection } from "@/components/check-in/training-section";
import { ClientNotesSection } from "@/components/check-in/client-notes-section";
import { HabitsSection } from "@/components/check-in/habits-section";
import { CheckInReviewHeader } from "./check-in-review-header";
import { useCheckInDetailData } from "@/hooks/use-check-in-detail-data";
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
 * emptiness predicate. Goal progress never returns null, so its rail is here.
 */
export const CheckInDetailView = ({ checkInId, client, onBack, onDone }: CheckInDetailViewProps) => {
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
      ) : data && ready && contextStartDate && contextEndDate ? (
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

          <TrainingSection checkIn={data.checkIn} adherence={adherence} />

          <NutritionSection
            dailyLogs={dailyLogs}
            contextStartDate={contextStartDate}
            contextEndDate={contextEndDate}
            fullWeekTarget={fullWeekTarget}
            nutrition={periodAdherence?.nutrition ?? null}
            periodDays={periodAdherence?.dates.length ?? null}
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
              degrade in place. */}
          <div>
            <SectionLabel label="Goal progress" />
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
          </div>

          <CheckInReviewSection
            checkInId={checkInId}
            clientName={clientName}
            review={toCheckInReview(data.checkIn)}
            onRefresh={refreshDetail}
            onSent={onDone}
          />
        </>
      ) : (
        <Notice>Failed to load check-in data</Notice>
      )}
    </div>
  );
};
