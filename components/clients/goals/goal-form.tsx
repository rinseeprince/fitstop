"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUnits } from "@/contexts/units-context";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { formatDateOnlyShort } from "@/lib/date-helpers";
import { goalSaveWrites, startsNewGoal, type GoalDraft } from "@/lib/goals/goal-form";
import type { ClientGoalsOverview, GoalFix, GoalOnDay } from "@/types/client-goals";
import { DeleteGoalDialog, type DeleteGoalSubject } from "./delete-goal-dialog";
import { GoalFields } from "./goal-fields";
import { useGoalDraft, type GoalDraftErrors } from "./use-goal-draft";
import { GoalRefusal, type GoalWrites } from "./use-goal-writes";

/** A fix, as its button says it. */
function fixLabel(fix: GoalFix): string {
  switch (fix.kind) {
    case "move_goal":
      return `Move ${fix.name} to ${formatDateOnlyShort(fix.startsOn)}`;
    case "delete_goal":
      return `Delete ${fix.name}`;
    case "end_deadline":
      return `End ${fix.name}'s deadline on ${formatDateOnlyShort(fix.deadline)}`;
  }
}

/**
 * The goals sheet's form, in place of the row it edits or of "Plan a goal".
 *
 * Save makes the writes the goal model calls for (`goalSaveWrites`). A write
 * the date rules refuse leaves the form open with the rule's sentence and the
 * fixes it offers, for as long as the fields read as they did when refused. A
 * fix makes its change and saves the goal again, in the one click — a delete
 * after the destructive confirm, and with no Undo: putting the goal back would
 * bring back the clash the delete settled. The last write's answer goes to
 * `onSaved`, which lands it and closes the form in one tick; an answer that
 * closes nothing — a fix, or the first of two writes — lands at once.
 */
export function GoalForm({
  stored,
  clientToday,
  clientName,
  planned,
  readings,
  writes,
  idPrefix,
  onSaved,
  onCancel,
}: {
  /** The goal being edited, as it stands today; null plans a new one. */
  stored: GoalOnDay | null;
  clientToday: string;
  clientName: string;
  /** The planned goals, which a "move" or "delete" fix acts on. */
  planned: GoalOnDay[];
  readings: { weight: number | null; bodyFat: number | null };
  writes: GoalWrites;
  idPrefix: string;
  onSaved: (answer: ClientGoalsOverview) => void;
  onCancel: () => void;
}) {
  const { preference } = useUnits();
  const draft = useGoalDraft({ preference, stored });
  const [errors, setErrors] = useState<GoalDraftErrors>({});
  const [refusal, setRefusal] = useState<{ error: GoalRefusal; fields: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The delete a fix asks to confirm, and the draft its save sends after.
  const deleteConfirm = useDialogSubject<{ subject: DeleteGoalSubject; draft: GoalDraft }>();

  // A goal that has started, and today's, keep their start day; a new goal and
  // a planned one take theirs from the form.
  const asksStart = stored === null || stored.startsOn > clientToday;

  // Said while the coach is still typing, from what the boxes read.
  const makesNewGoal =
    stored !== null &&
    draft.type !== null &&
    startsNewGoal(stored, { ...draft.targets, type: draft.type }, clientToday);

  // Targets are asked for, and checked, only where the save writes them: a
  // goal that started before today keeps its own unless the save makes a new
  // goal — so a target it has always lacked never blocks its deadline.
  const checksTargets = stored === null || stored.startsOn >= clientToday || makesNewGoal;

  // A deadline falls on or after the day its goal starts.
  const deadlineMin = asksStart
    ? draft.startsOn || clientToday
    : makesNewGoal
      ? clientToday
      : (stored?.startsOn ?? clientToday);

  // What the fields read, to hold a refusal to the values it refused.
  const fields = JSON.stringify([
    draft.type,
    draft.name,
    draft.weight.value,
    draft.bodyFat,
    draft.startsOn,
    draft.deadline,
    draft.description,
  ]);
  const shownRefusal = refusal?.fields === fields ? refusal.error : null;

  /** The draft to save, with the field errors shown; null when one stops it. */
  const check = () => {
    const result = draft.toDraft({ asksStart, checksTargets });
    setErrors(result.errors ?? {});
    return result.draft ?? null;
  };

  const fail = (error: unknown, landedOne: boolean) => {
    if (error instanceof GoalRefusal) {
      setRefusal({ error, fields });
    } else {
      // Two writes, no transaction: once the first has landed, "Save failed"
      // would tell the coach to redo what is already stored.
      const reason = error instanceof Error ? error.message : "Something went wrong";
      toast.error(landedOne ? "Partly saved" : "Save failed", {
        description: landedOne ? `The deadline was saved, but the rest was not: ${reason}` : reason,
      });
    }
    setBusy(false);
  };

  /**
   * Every write a checked draft calls for; the last answer closes the form.
   * Busy from the first write until the form closes or the save fails.
   */
  const send = async (checked: GoalDraft) => {
    const planWrites = goalSaveWrites({ stored, draft: checked, today: clientToday });
    if (planWrites.length === 0) {
      onCancel();
      return;
    }
    setBusy(true);
    setRefusal(null);
    let answer: ClientGoalsOverview | null = null;
    try {
      for (const write of planWrites) {
        if (answer) writes.land(answer);
        answer = await writes.run(write);
      }
      if (answer) onSaved(answer);
    } catch (error) {
      fail(error, answer !== null);
    }
  };

  const save = () => {
    const checked = check();
    if (checked) void send(checked);
  };

  /** A fix, then the save it made way for — checked before either is sent. */
  const applyFix = async (fix: GoalFix) => {
    const checked = check();
    if (!checked) return;
    if (fix.kind === "delete_goal") {
      const goal = planned.find((candidate) => candidate.id === fix.goalId);
      if (!goal) {
        toast.error("Delete failed", { description: `${fix.name} is no longer planned.` });
        return;
      }
      deleteConfirm.show({ subject: { goal, isCurrent: false, previousName: null }, draft: checked });
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      writes.land(await writes.applyFix(fix, planned));
    } catch (error) {
      fail(error, false);
      return;
    }
    await send(checked);
  };

  /** The confirmed delete fix: the goal in the way goes, then the save is sent again. */
  const confirmDeleteFix = async (subject: DeleteGoalSubject) => {
    const answer = await writes.remove(subject.goal.id);
    writes.land(answer);
    const draftToSend = deleteConfirm.subject?.draft;
    deleteConfirm.close();
    toast.success("Goal deleted");
    if (draftToSend) await send(draftToSend);
  };

  return (
    <div className="rounded-[6px] bg-white px-[18px] py-4">
      <GoalFields
        draft={draft}
        errors={errors}
        readings={readings}
        asksStart={asksStart}
        startMin={clientToday}
        deadlineMin={deadlineMin}
        idPrefix={idPrefix}
        controlClassName="h-8 text-[12.5px]"
      />

      {shownRefusal && (
        <div className="mt-3.5 rounded-[6px] bg-[rgba(245,158,11,0.07)] px-3 py-2.5">
          <p className="text-[12px] leading-[1.5] text-[#d97706]">{shownRefusal.message}</p>
          {shownRefusal.fixes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {shownRefusal.fixes.map((fix) => (
                <Button
                  key={`${fix.kind}-${fix.goalId}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void applyFix(fix)}
                  className={cn(
                    "h-7 bg-white text-[12px]",
                    fix.kind === "delete_goal" &&
                      "border-[rgba(192,96,96,0.3)] text-[#c06060] hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
                  )}
                >
                  {fixLabel(fix)}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {makesNewGoal && (
          <p className="mr-auto text-[11.5px] text-[#5a7d82]">This starts a new goal from today.</p>
        )}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={busy}
          className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
        >
          {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save goal
        </Button>
      </div>

      <DeleteGoalDialog
        key={`delete-fix-${deleteConfirm.openKey}`}
        open={deleteConfirm.open}
        subject={deleteConfirm.subject?.subject ?? null}
        clientName={clientName}
        onOpenChange={(next) => {
          if (!next) deleteConfirm.close();
        }}
        onConfirm={confirmDeleteFix}
      />
    </div>
  );
}
