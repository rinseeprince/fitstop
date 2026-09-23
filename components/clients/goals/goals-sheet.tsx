"use client";

import { useState } from "react";
import { Pencil, Plus, Target, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { RowActions } from "@/components/programs/shared/row-actions";
import {
  FOCUS_RING,
  HEADER_EYEBROW_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useClientGoals } from "@/hooks/use-client-goals";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { useUnits } from "@/contexts/units-context";
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions";
import { formatDateOnlyShort } from "@/lib/date-helpers";
import { goalTypeBesideName } from "@/lib/goals/goal-types";
import type { ClientGoalsOverview, GoalOnDay } from "@/types/client-goals";
import { GoalForm } from "./goal-form";
import { DeleteGoalDialog, type DeleteGoalSubject } from "./delete-goal-dialog";
import { useGoalWrites } from "./use-goal-writes";

/** "Lean out · 81.5 kg · since 3 Sep · by 21 Oct" without its name — the row's second line. */
function goalMeta(goal: GoalOnDay, isCurrent: boolean, preference: UnitSystem): string {
  const parts: string[] = [];
  const type = goalTypeBesideName(goal.type, goal.name);
  if (type) parts.push(type);
  if (goal.targetWeight != null) {
    const shown = formatWeight(goal.targetWeight, preference);
    parts.push(`${shown.value.toFixed(1)} ${shown.unit}`);
  }
  if (goal.targetBodyFatPercentage != null) parts.push(`${goal.targetBodyFatPercentage.toFixed(1)}%`);
  parts.push(`${isCurrent ? "since" : "from"} ${formatDateOnlyShort(goal.startsOn)}`);
  if (goal.deadline) {
    parts.push(
      `${goal.type === "event_prep" ? "event day" : "by"} ${formatDateOnlyShort(goal.deadline)}`
    );
  }
  return parts.join(" · ");
}

function GoalRow({
  goal,
  isCurrent,
  preference,
  onEdit,
  onDelete,
}: {
  goal: GoalOnDay;
  isCurrent: boolean;
  preference: UnitSystem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group/row mb-2 flex items-center gap-3 rounded-[6px] bg-white px-[18px] py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-[#0c1a1e]">{goal.name}</p>
        <p className="mt-0.5 text-[12px] text-[#5a7d82]">{goalMeta(goal, isCurrent, preference)}</p>
      </div>
      <RowActions
        actions={[
          { label: `Edit ${goal.name}`, icon: Pencil, onClick: onEdit },
          { label: `Delete ${goal.name}`, icon: Trash2, onClick: onDelete, danger: true },
        ]}
      />
    </div>
  );
}

/**
 * A client's goals, behind the pencil on the Overview's goal card
 * (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d2): today's goal and the planned
 * ones, each with Edit and Delete, and "Plan a goal". One form is open at a
 * time, in place of what it edits.
 *
 * Every write's answer is landed in the same tick its surface closes — the
 * form on a save, the confirm on a delete — so no frame shows the goal it just
 * changed.
 */
export function GoalsSheet({
  clientId,
  clientName,
  open,
  onOpenChange,
  readings,
}: {
  clientId: string;
  clientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client's current readings, kg and %, for the form's direction warning. */
  readings: { weight: number | null; bodyFat: number | null };
}) {
  const { preference } = useUnits();
  const { current, planned, clientToday, isLoading, isError, retry } = useClientGoals(clientId);
  const writes = useGoalWrites(clientId);
  // Which goal's form is open — null plans a new one — and a count that mounts
  // every opening of a form fresh.
  const [editing, setEditing] = useState<{ goalId: string | null; opening: number } | null>(null);
  const deleteDialog = useDialogSubject<DeleteGoalSubject>();

  const openForm = (goalId: string | null) =>
    setEditing((previousForm) => ({ goalId, opening: (previousForm?.opening ?? 0) + 1 }));

  // The goals table is not on screen here, so landing is done when it returns:
  // the answer and the closing surface render together.
  const onSaved = (answer: ClientGoalsOverview) => {
    void writes.land(answer);
    setEditing(null);
    toast.success("Goal saved");
  };

  const confirmDelete = async (subject: DeleteGoalSubject) => {
    void writes.land(await writes.remove(subject.goal.id));
    deleteDialog.close();
    toast.success("Goal deleted");
  };

  const form = (stored: GoalOnDay | null) =>
    editing && clientToday ? (
      <div className="mb-2">
        <GoalForm
          key={`goal-form-${editing.opening}`}
          stored={stored}
          clientToday={clientToday}
          planned={planned}
          readings={readings}
          writes={writes}
          idPrefix={`goal-form-${editing.opening}`}
          onSaved={onSaved}
          onCancel={() => setEditing(null)}
        />
      </div>
    ) : null;

  const row = (goal: GoalOnDay, isCurrent: boolean) =>
    editing?.goalId === goal.id ? (
      <div key={goal.id}>{form(goal)}</div>
    ) : (
      <GoalRow
        key={goal.id}
        goal={goal}
        isCurrent={isCurrent}
        preference={preference}
        onEdit={() => openForm(goal.id)}
        onDelete={() => deleteDialog.show({ goal, isCurrent })}
      />
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideClose
        className="flex w-full flex-col gap-0 bg-[#f4f7f6] p-0 sm:w-[780px] sm:max-w-full"
      >
        <SheetTitle className="sr-only">Goals for {clientName}</SheetTitle>
        <SheetDescription className="sr-only">
          The current goal and the planned ones.
        </SheetDescription>

        <header className="flex shrink-0 items-center gap-3.5 bg-[#0f2027] px-5 py-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] bg-[rgba(13,148,136,0.15)] text-[#0d9488]">
            <Target className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <p className={HEADER_EYEBROW_CLASS}>Goals</p>
            <p className="mt-0.5 truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-white">
              {clientName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className={cn(
              "ml-auto self-start rounded p-1 text-[rgba(255,255,255,0.35)] transition-colors hover:text-white",
              FOCUS_RING
            )}
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <>
              <SectionLabel label="Current goal" />
              <Skeleton className="mb-2 h-[62px] rounded-[6px]" />
            </>
          ) : isError ? (
            <div className="rounded-[6px] bg-white px-[18px] py-6 text-center">
              <p className="text-sm text-[#5a7d82]">Couldn&apos;t load the goals</p>
              <button
                type="button"
                onClick={retry}
                className={cn(
                  "mt-2 text-[12px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]",
                  FOCUS_RING
                )}
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <SectionLabel label="Current goal" />
              {current ? (
                row(current, true)
              ) : (
                <p className="mb-2 rounded-[6px] bg-white px-[18px] py-3 text-[13px] text-[#93b0b4]">
                  No current goal
                </p>
              )}

              {planned.length > 0 && (
                <div className="mt-5">
                  <SectionLabel label="Planned" />
                  {planned.map((goal) => row(goal, false))}
                </div>
              )}

              <div className="mt-5">
                {editing?.goalId === null ? (
                  form(null)
                ) : (
                  <button
                    type="button"
                    onClick={() => openForm(null)}
                    className={cn(
                      "flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.25)] py-2 text-xs font-medium text-[#5a7d82] transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55]",
                      FOCUS_RING
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Plan a goal
                  </button>
                )}
              </div>
            </>
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
      </SheetContent>
    </Sheet>
  );
}
