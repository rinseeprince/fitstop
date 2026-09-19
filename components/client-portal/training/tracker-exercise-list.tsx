"use client";

import type { ReactNode } from "react";
import type { FieldArrayWithId } from "react-hook-form";
import type { ResolvedExerciseGroup } from "@/types/training";
import {
  exerciseGroupPlace,
  groupHeading,
  groupHeadingText,
  readsAsGroup,
  type ExerciseGroupPlace,
} from "@/utils/exercise-group-display";
import { isTimedFormat } from "@/utils/group-scores";
import {
  ExerciseTrackerBlock,
  type ExerciseFormContext,
  type PrescribedExerciseView,
} from "./exercise-tracker-block";
import type { LogFormValues } from "./log-form-types";
import { TimedGroupSection } from "./timed-group-section";

// The workout's exercise blocks, laid out by their groups: a lone exercise as a
// plain block, a linked group (two or more exercises) under one heading, a
// timed group under its heading with its timer and its score boxes. The form
// underneath stays flat — its leading exercises are the prescription group by
// group, then anything unplanned — so a group changes where a block sits and
// never which form entry, row or set number it logs to; a score is its own
// entry in the form's `groupScores`, found by the group's id.

type Props = {
  groups: ResolvedExerciseGroup[];
  /** The prescription group by group, index-aligned with the form's leading exercises. */
  prescribedViews: PrescribedExerciseView[];
  fields: FieldArrayWithId<LogFormValues, "exercises", "id">[];
  /** Each scoring group's entry in the form's `groupScores`, by group id. */
  scoreIndexByGroupId: ReadonlyMap<string, number>;
  form: Pick<ExerciseFormContext, "control" | "register" | "setValue" | "getValues">;
  onRemoveExercise: (index: number) => void;
};

export function TrackerExerciseList({
  groups,
  prescribedViews,
  fields,
  scoreIndexByGroupId,
  form,
  onRemoveExercise,
}: Props) {
  const block = (index: number, place?: ExerciseGroupPlace) => {
    const field = fields[index];
    if (!field) return null;
    // Nothing prescribed. `sets: 0` is this tree's spelling of that
    // (exercise-tracker-block's zero-guard), which is what makes every row of an
    // unplanned exercise deletable: the row list is entirely the client's own,
    // so there is no prescription for a delete to shift out of alignment.
    const unplannedView: PrescribedExerciseView = {
      id: field.trainingExerciseId || field.id,
      name: field.exerciseName,
      sets: 0,
      isWarmup: false,
    };
    const prescribedView = prescribedViews[index];
    return (
      <ExerciseTrackerBlock
        key={field.id}
        // The PRESCRIPTION, unmodified. It used to carry
        // `sets: field.sets.length`, which fed the form's own row count back
        // into expandSetSpecs — so prescribedRows tracked the form rather than
        // the coach, and "is this row past the prescription?" could never be
        // true.
        exercise={field.isUnplanned || !prescribedView ? unplannedView : prescribedView}
        index={index}
        formContext={{
          ...form,
          isUnplanned: field.isUnplanned,
          onRemove: field.isUnplanned ? () => onRemoveExercise(index) : undefined,
        }}
        place={place}
      />
    );
  };

  let start = 0;
  const prescribed = groups.flatMap((group) => {
    const first = start;
    start += group.exercises.length;
    const blocks = group.exercises.map((_, position) =>
      block(first + position, exerciseGroupPlace(group, position)),
    );
    if (!readsAsGroup(group)) return blocks;
    if (isTimedFormat(group.format)) {
      return [
        <TimedGroupSection
          key={group.id}
          group={group}
          scoreIndex={scoreIndexByGroupId.get(group.id) ?? null}
          form={form}
        >
          {blocks}
        </TimedGroupSection>,
      ];
    }
    return [
      <ExerciseGroupSection key={group.id} group={group}>
        {blocks}
      </ExerciseGroupSection>,
    ];
  });

  const unplanned = fields
    .slice(prescribedViews.length)
    .map((_, offset) => block(prescribedViews.length + offset));

  return (
    <>
      {prescribed}
      {unplanned}
    </>
  );
}

function ExerciseGroupSection({
  group,
  children,
}: {
  group: ResolvedExerciseGroup;
  children: ReactNode;
}) {
  const heading = groupHeading(group);
  const { title, rests } = groupHeadingText(heading);
  return (
    <section
      aria-label={title}
      data-testid="exercise-group"
      className="space-y-2 rounded-[6px] border border-[rgba(13,148,136,0.15)] p-2"
    >
      <header className="px-2 pt-1">
        <h2 className="text-[13px] font-semibold text-[#0c1a1e]">{title}</h2>
        {rests && <p className="text-[12px] text-[#5a7d82]">{rests}</p>}
        {heading.notes && (
          <p className="mt-1 whitespace-pre-wrap text-[12px] text-[#5a7d82]">
            {heading.notes}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}
