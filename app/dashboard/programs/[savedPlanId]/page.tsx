"use client";

import { useParams } from "next/navigation";
import { AppLayout } from "@/components/app-layout";
import { ProgramBuilder } from "@/components/clients/training/program-builder/program-builder";

// Full-page Program builder route. key= remounts the builder per plan so the
// working tree can never leak across programs (draft-editor pattern).
export default function ProgramBuilderPage() {
  const { savedPlanId } = useParams<{ savedPlanId: string }>();

  return (
    <AppLayout>
      <ProgramBuilder
        key={savedPlanId}
        savedPlanId={savedPlanId}
        target="library"
      />
    </AppLayout>
  );
}
