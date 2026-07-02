"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { ProgramDraftProvider } from "@/components/clients/training/program-builder/program-draft-provider";

// Hosts the builder's shared draft state ABOVE the route level so the page
// (children) and the create-session slide-over (@modal, intercepted route)
// mutate one working tree. key= is load-bearing: a dynamic-segment layout
// does not remount when the param changes, so without it plan A's draft
// would leak into plan B (the guarantee key={savedPlanId} on the page used
// to provide).
export default function BuilderScopeLayout({
  children,
  modal,
}: {
  children: ReactNode;
  modal: ReactNode;
}) {
  const { savedPlanId } = useParams<{ savedPlanId: string }>();

  return (
    <ProgramDraftProvider
      key={savedPlanId}
      savedPlanId={savedPlanId}
      target="library"
    >
      {children}
      {modal}
    </ProgramDraftProvider>
  );
}
