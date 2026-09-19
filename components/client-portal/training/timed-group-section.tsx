"use client";

import type { ReactNode } from "react";
import { useFormState, useWatch } from "react-hook-form";
import { Input } from "@/components/ui/input";
import type { ResolvedExerciseGroup } from "@/types/training";
import { groupHeading, groupHeadingText } from "@/utils/exercise-group-display";
import { formatDuration, parseDuration } from "@/utils/unit-conversions";
import type { ExerciseFormContext } from "./exercise-tracker-block";
import { GroupTimer } from "./group-timer";
import { SCORE_BOX_LABELS, scoreTakesRounds, type ScoreBox } from "./log-form-types";

// A timed group in the client's workout (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md
// sections 4.2 and 4.5): its heading, its timer, its score boxes where the
// format takes a score, then its exercise blocks. An AMRAP's boxes are Rounds
// and Reps. A For time's is a Finish time, or Rounds and Reps once the client
// says they didn't finish inside the cap. An EMOM has the cue alone: it logs
// its rows like a circuit's. Entering a score ticks no rows; the rows below
// still take ticks and values, optional.

type Props = {
  group: ResolvedExerciseGroup;
  /** The group's entry in the form's `groupScores`, or null where the format takes no score. */
  scoreIndex: number | null;
  form: Pick<ExerciseFormContext, "control" | "register" | "setValue" | "getValues">;
  children: ReactNode;
};

const SCORE_INPUT_CLASS = "h-9 w-24 text-center text-[13px] font-mono-display";
const LINK_CLASS =
  "text-[12px] font-medium text-[#0d9488] transition-colors hover:text-[#0a766b]";

export function TimedGroupSection({ group, scoreIndex, form, children }: Props) {
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
          <p className="mt-1 whitespace-pre-wrap text-[12px] text-[#5a7d82]">{heading.notes}</p>
        )}
      </header>
      <Timer group={group} scoreIndex={scoreIndex} form={form} />
      {scoreIndex !== null && <ScoreBoxes index={scoreIndex} name={heading.name} form={form} />}
      {children}
    </section>
  );
}

function Timer({
  group,
  scoreIndex,
  form,
}: {
  group: ResolvedExerciseGroup;
  scoreIndex: number | null;
  form: Props["form"];
}) {
  switch (group.format) {
    case "amrap":
      return group.timeCapSeconds !== null ? (
        <GroupTimer kind="countdown" seconds={group.timeCapSeconds} />
      ) : null;
    case "emom":
      return group.intervalSeconds !== null && group.rounds !== null ? (
        <GroupTimer kind="intervals" intervalSeconds={group.intervalSeconds} rounds={group.rounds} />
      ) : null;
    case "for_time":
      return (
        <GroupTimer
          kind="stopwatch"
          capSeconds={group.timeCapSeconds}
          onUseTime={(seconds) => {
            if (scoreIndex === null) return;
            // The stopwatch's time goes into the Finish time box; a client who
            // had said "Didn't finish" is finishing after all.
            form.setValue(`groupScores.${scoreIndex}.capped`, false, { shouldDirty: true });
            form.setValue(`groupScores.${scoreIndex}.finishTime`, formatDuration(seconds), {
              shouldDirty: true,
            });
          }}
        />
      );
    default:
      return null;
  }
}

function ScoreBoxes({ index, name, form }: { index: number; name: string; form: Props["form"] }) {
  const { control, register, setValue, getValues } = form;
  const format = getValues(`groupScores.${index}.format`);
  const capped = useWatch({ control, name: `groupScores.${index}.capped` }) ?? false;
  const { errors } = useFormState({ control, name: `groupScores.${index}` });
  const invalid = (box: ScoreBox) => errors.groupScores?.[index]?.[box] != null || undefined;

  // A finish time reads back as a duration when the box is left ("8" is eight
  // minutes, "8:32.5" stays) — the same readback the set boxes give.
  const readBackFinishTime = () => {
    const text = getValues(`groupScores.${index}.finishTime`);
    if (!text.trim()) return;
    const seconds = parseDuration(text);
    if (seconds === null) return;
    const shown = formatDuration(seconds);
    if (shown !== text) {
      setValue(`groupScores.${index}.finishTime`, shown, { shouldDirty: true });
    }
  };

  const box = (key: ScoreBox, placeholder: string, onBlur?: () => void) => (
    <label className="flex items-center gap-2 text-[12px] text-[#5a7d82]">
      {SCORE_BOX_LABELS[key]}
      <Input
        {...register(`groupScores.${index}.${key}`, onBlur ? { onBlur } : undefined)}
        type="text"
        inputMode={key === "finishTime" ? "text" : "numeric"}
        placeholder={placeholder}
        aria-label={`${name} ${SCORE_BOX_LABELS[key].toLowerCase()}`}
        aria-invalid={invalid(key)}
        data-testid={`score-${key}-${index}`}
        className={SCORE_INPUT_CLASS}
      />
    </label>
  );

  return (
    <div
      data-testid={`group-score-${index}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-2"
    >
      <span className="text-[12px] font-semibold text-[#0c1a1e]">Score</span>
      {scoreTakesRounds({ format, capped }) ? (
        <>
          {box("rounds", "0")}
          {box("reps", "0")}
          {format === "for_time" && (
            <button
              type="button"
              onClick={() => setValue(`groupScores.${index}.capped`, false, { shouldDirty: true })}
              data-testid={`score-finished-${index}`}
              className={LINK_CLASS}
            >
              Finished
            </button>
          )}
        </>
      ) : (
        <>
          {box("finishTime", "m:ss", readBackFinishTime)}
          <button
            type="button"
            onClick={() => setValue(`groupScores.${index}.capped`, true, { shouldDirty: true })}
            data-testid={`score-capped-${index}`}
            className={LINK_CLASS}
          >
            Didn&apos;t finish
          </button>
        </>
      )}
    </div>
  );
}
