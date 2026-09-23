"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";
import { DeleteGoalDialog, type DeleteGoalSubject } from "@/components/clients/goals/delete-goal-dialog";
import { useGoalWrites } from "@/components/clients/goals/use-goal-writes";
import { useClientGoalHistory, useClientGoals } from "@/hooks/use-client-goals";
import { useMeasurementSeries } from "@/hooks/use-measurement-series";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { useUnits } from "@/contexts/units-context";
import { goalEndWeight, goalResult } from "@/lib/goals/goal-result";
import { formatWeight } from "@/utils/unit-conversions";
import type { GoalHistoryRow } from "@/types/client-goals";
import { GoalsTable, GoalsTableSkeleton, type GoalRowFigures } from "./goals-table";

/**
 * The Journey's Goals pane (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d3): every
 * goal, planned first, with the weight it ended at (today's goal: the newest),
 * its result and what happened during it, and a delete on each row.
 *
 * Three reads: the goals table (`GET …/goals/history`), the measurement series
 * each result is worked out from, and the goals read — today's goal's start
 * readings, which the goal card measures from — so today's goal reads the
 * card's own chip. The results are worked out here, in the viewer's units,
 * where the card judges.
 */
export function GoalsPane({ clientId }: { clientId: string }) {
  const { preference } = useUnits();
  const history = useClientGoalHistory(clientId);
  const { current, isLoading: goalLoading } = useClientGoals(clientId);
  const { series, isError: seriesFailed } = useMeasurementSeries(clientId);
  // The table is on screen: a delete refreshes it in place and closes once it has.
  const writes = useGoalWrites(clientId, true);
  const deleteDialog = useDialogSubject<DeleteGoalSubject>();

  const weightUnit = formatWeight(0, preference).unit;
  const readings = useMemo(
    () =>
      series && {
        weight: series.weight.map((point) => ({
          date: point.date,
          value: formatWeight(point.value, preference).value,
        })),
        bodyFat: series.bodyFat.map((point) => ({ date: point.date, value: point.value })),
      },
    [series, preference]
  );

  const resultOf = useCallback(
    (row: GoalHistoryRow): GoalRowFigures | null => {
      const isToday = row.status === "current";
      if (row.status !== "planned" && (!readings || (isToday && goalLoading))) return null;
      // Today's goal measures from the start the goals read carries, as the card does.
      const start = isToday && current?.id === row.id ? current.startReadings : null;
      const lines = goalResult(
        {
          type: row.type,
          status: row.status,
          startsOn: row.startsOn,
          endsOn: row.endsOn,
          deadline: row.deadline,
          targets: {
            weight: row.targetWeight === null ? null : formatWeight(row.targetWeight, preference).value,
            bodyFat: row.targetBodyFatPercentage,
          },
          startReadings: start
            ? {
                weight: start.weight === null ? null : formatWeight(start.weight, preference).value,
                bodyFat: start.bodyFat,
              }
            : undefined,
        },
        readings ?? { weight: [], bodyFat: [] },
        weightUnit
      );
      return { lines, weight: goalEndWeight(row, readings?.weight ?? []) };
    },
    [readings, goalLoading, current, preference, weightUnit]
  );

  const confirmDelete = async (subject: DeleteGoalSubject) => {
    await writes.land(await writes.remove(subject.goal.id));
    deleteDialog.close();
    toast.success("Goal deleted");
  };

  return (
    <section aria-label="Goals">
      <SectionLabel label="Goals" />
      <div className="rounded-[6px] bg-white p-5">
        {history.isError ? (
          <div className="py-12 text-center">
            <p className="text-sm text-[#5a7d82]">Couldn&apos;t load the goals</p>
            <button
              type="button"
              onClick={history.retry}
              className={cn(
                "mt-2 text-[12px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]",
                FOCUS_RING
              )}
            >
              Try again
            </button>
          </div>
        ) : history.isLoading ? (
          <GoalsTableSkeleton />
        ) : history.goals.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-[#93b0b4]">No goals yet</p>
        ) : (
          <GoalsTable
            rows={history.goals}
            resultOf={resultOf}
            resultsFailed={seriesFailed && !series}
            viewer={preference}
            onDelete={(row) =>
              deleteDialog.show({
                goal: row,
                isCurrent: row.status === "current",
                endsOn: row.status === "ended" && row.endsOn ? row.endsOn : undefined,
              })
            }
          />
        )}
      </div>

      <DeleteGoalDialog
        key={`delete-goal-${deleteDialog.openKey}`}
        open={deleteDialog.open}
        subject={deleteDialog.subject}
        onOpenChange={(next) => {
          if (!next) deleteDialog.close();
        }}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
