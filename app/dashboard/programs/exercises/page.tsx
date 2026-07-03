"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useExerciseCatalog } from "@/hooks/use-exercise-catalog";
import { ExercisesStatBand } from "@/components/programs/exercises-stat-band";
import { ExercisesTable } from "@/components/programs/exercises-table";
import { ExerciseFormDialog } from "@/components/programs/exercise-form-dialog";
import type { Exercise } from "@/types/training";

// The exercise catalog library. The section topbar's "New exercise" action
// lands here with ?new=1 — we open the form dialog and clear the param.
function ExercisesLibrary() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mutate } = useExerciseCatalog();
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Exercise | null>(null);

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setEditTarget(null);
      setFormOpen(true);
      router.replace("/dashboard/programs/exercises", { scroll: false });
    }
  }, [searchParams, router]);

  return (
    <div className="space-y-5">
      <ExercisesStatBand />
      <ExercisesTable
        onEditExercise={(exercise) => {
          setEditTarget(exercise);
          setFormOpen(true);
        }}
        onCreate={() => {
          setEditTarget(null);
          setFormOpen(true);
        }}
      />
      <ExerciseFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditTarget(null);
        }}
        exercise={editTarget}
        onSaved={() => void mutate()}
      />
    </div>
  );
}

export default function ExercisesLibraryPage() {
  // useSearchParams needs a Suspense boundary on statically-rendered routes.
  return (
    <Suspense fallback={null}>
      <ExercisesLibrary />
    </Suspense>
  );
}
