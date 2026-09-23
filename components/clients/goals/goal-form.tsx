"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUnits } from "@/contexts/units-context";
import { goalSaveWrites, startsNewGoal, type GoalDraft } from "@/lib/goals/goal-form";
import type { ClientGoalsOverview, GoalOnDay } from "@/types/client-goals";
import { GoalFields } from "./goal-fields";
import { useGoalDraft, type GoalDraftErrors } from "./use-goal-draft";
import { GoalRefusal, type GoalWrites } from "./use-goal-writes";

/**
 * The goals sheet's form, in place of the row it edits or of "Plan a goal".
 *
 * Save makes the writes the goal model calls for (`goalSaveWrites`). A write
 * the date rules refuse leaves the form open with the rule's sentence, for as
 * long as the fields and the planned goals are as they were when refused. The
 * last write's answer goes to `onSaved`, which lands it and closes the form in
 * one tick; the first of two writes lands at once.
 */
export function GoalForm({
  stored,
  clientToday,
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
  /** The planned goals, which a refusal was judged against. */
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
  const [refusal, setRefusal] = useState<{ message: string; judged: string } | null>(null);
  const [busy, setBusy] = useState(false);

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

  // What a refusal was judged against: the fields, and the planned goals.
  const judged = JSON.stringify([
    draft.type,
    draft.name,
    draft.weight.value,
    draft.bodyFat,
    draft.startsOn,
    draft.deadline,
    draft.description,
    planned.map((goal) => [goal.id, goal.startsOn, goal.deadline]),
  ]);
  const shownRefusal = refusal?.judged === judged ? refusal.message : null;

  /** Every write the checked draft calls for; the last answer closes the form. */
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
        if (answer) void writes.land(answer);
        answer = await writes.run(write);
      }
      if (answer) onSaved(answer);
    } catch (error) {
      if (error instanceof GoalRefusal) {
        setRefusal({ message: error.message, judged });
      } else {
        // Two writes, no transaction: once the first has landed, "Save failed"
        // would tell the coach to redo what is already stored.
        const reason = error instanceof Error ? error.message : "Something went wrong";
        toast.error(answer ? "Partly saved" : "Save failed", {
          description: answer ? `The deadline was saved, but the rest was not: ${reason}` : reason,
        });
      }
      setBusy(false);
    }
  };

  const save = () => {
    const result = draft.toDraft({ asksStart, checksTargets });
    setErrors(result.errors ?? {});
    if (result.draft) void send(result.draft);
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
        <p className="mt-3.5 rounded-[6px] bg-[rgba(245,158,11,0.07)] px-3 py-2.5 text-[12px] leading-[1.5] text-[#d97706]">
          {shownRefusal}
        </p>
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
    </div>
  );
}
