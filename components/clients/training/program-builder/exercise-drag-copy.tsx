"use client";

import { cn } from "@/lib/utils";
import { GroupHeadingTitle } from "@/components/clients/training/group-heading-lines";
import { exerciseGroupPlace } from "@/utils/exercise-group-display";
import type { SessionDraft } from "./program-builder-types";
import type { ExerciseDragData } from "./exercise-drop";
import { exerciseCardSummary } from "./exercise-summary";
import { MONO, TEXT_PRIMARY, TEXT_SECONDARY, TRAINING_CARD_BORDER } from "./builder-tokens";

// What follows the pointer while an exercise or a linked group is dragged in
// the session editor: the card's top line, or the group's heading line, on the
// week grid's drag chip (program-builder.tsx). The card or group itself stays
// in its place, dimmed, so nothing in the scrolling list moves or grows.
const CHIP = cn("rounded-[6px] bg-white px-3 py-2 shadow-lg", TRAINING_CARD_BORDER);

export function ExerciseDragCopy({
  session,
  drag,
}: {
  session: SessionDraft;
  drag: ExerciseDragData;
}) {
  if (drag.type === "group") {
    const group = session.groups.find((g) => g.uid === drag.groupUid);
    return group ? (
      <div className={CHIP}>
        <GroupHeadingTitle group={group} />
      </div>
    ) : null;
  }
  for (const group of session.groups) {
    const position = group.exercises.findIndex((e) => e.uid === drag.exerciseUid);
    if (position === -1) continue;
    const exercise = group.exercises[position];
    const summary = exerciseCardSummary(exercise, exerciseGroupPlace(group, position).roundsAreRows);
    return (
      <div className={cn(CHIP, "flex items-center gap-3")}>
        <span className={cn("text-[13px] font-semibold", TEXT_PRIMARY)}>{exercise.name}</span>
        {summary && <span className={cn(MONO, "text-[11px]", TEXT_SECONDARY)}>{summary}</span>}
      </div>
    );
  }
  return null;
}
