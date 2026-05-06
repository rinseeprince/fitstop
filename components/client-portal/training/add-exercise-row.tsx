"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExerciseSearchInput } from "./exercise-search-input";
import type { ExerciseFormValues } from "./log-form-types";
import { emptySet } from "./log-form-types";

type AddExerciseRowProps = {
  weightUnit: "lbs" | "kg";
  onAdd: (exercise: ExerciseFormValues) => void;
};

const DEFAULT_SETS = 3;
const MIN_SETS = 1;
const MAX_SETS = 10;

export function AddExerciseRow({ weightUnit, onAdd }: AddExerciseRowProps) {
  const [name, setName] = useState("");
  const [exerciseId, setExerciseId] = useState<string | undefined>(undefined);
  const [sets, setSets] = useState(String(DEFAULT_SETS));

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const parsed = Number(sets);
    const setsCount =
      Number.isFinite(parsed) && parsed >= MIN_SETS && parsed <= MAX_SETS
        ? Math.floor(parsed)
        : DEFAULT_SETS;
    onAdd({
      trainingExerciseId: "",
      exerciseId,
      exerciseName: trimmed,
      prescribedName: undefined,
      isSwapped: false,
      weightUnit,
      skipped: false,
      notes: "",
      sets: Array.from({ length: setsCount }, () => emptySet()),
      isUnplanned: true,
    });
    setName("");
    setExerciseId(undefined);
    setSets(String(DEFAULT_SETS));
  };

  return (
    <div
      data-testid="add-exercise-row"
      className="rounded-[6px] border border-dashed border-[rgba(13,148,136,0.2)] bg-white p-4"
    >
      <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#5a7d82]">
        Add unplanned exercise
      </div>
      <div className="mt-2 grid grid-cols-12 gap-2">
        <div className="col-span-7">
          <ExerciseSearchInput
            value={name}
            onChange={(next) => {
              setName(next.name);
              setExerciseId(next.exerciseId);
            }}
            placeholder="Exercise name"
            ariaLabel="Unplanned exercise name"
            testId="add-exercise-name"
          />
        </div>
        <div className="col-span-2">
          <Input
            value={sets}
            onChange={(e) => setSets(e.target.value)}
            inputMode="numeric"
            type="text"
            placeholder="Sets"
            aria-label="Number of sets"
            data-testid="add-exercise-sets"
            className="text-center"
          />
        </div>
        <div className="col-span-3">
          <Button
            type="button"
            variant="secondary"
            onClick={handleAdd}
            disabled={!name.trim()}
            data-testid="add-exercise-submit"
            className="w-full"
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
