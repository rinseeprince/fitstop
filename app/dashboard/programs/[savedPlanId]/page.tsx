"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { ProgramBuilder } from "@/components/clients/training/program-builder/program-builder";
import { LAST_PLAN_STORAGE_KEY } from "@/lib/programs-nav";

// Full-page Program builder route. key= remounts the builder per plan so the
// working tree can never leak across programs (draft-editor pattern).
export default function ProgramBuilderPage() {
  const { savedPlanId } = useParams<{ savedPlanId: string }>();

  // The sub-sidebar's Builder item returns to the last opened program.
  // (Moves into ProgramDraftProvider when the R5 state lift lands.)
  useEffect(() => {
    if (savedPlanId) {
      sessionStorage.setItem(LAST_PLAN_STORAGE_KEY, savedPlanId);
    }
  }, [savedPlanId]);

  return (
    <ProgramBuilder
      key={savedPlanId}
      savedPlanId={savedPlanId}
      target="library"
    />
  );
}
