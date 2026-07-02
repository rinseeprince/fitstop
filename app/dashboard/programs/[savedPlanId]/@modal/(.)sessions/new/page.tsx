"use client";

import { Suspense } from "react";
import { CreateSessionSlideOver } from "@/components/clients/training/program-builder/create-session-slide-over";

// Intercepted route: soft-navigating to /dashboard/programs/[id]/sessions/new
// from the builder renders the slide-over here while the children slot keeps
// the builder page mounted (working tree intact underneath). Hard loads hit
// the real sessions/new route instead, which redirects to the builder root.
export default function CreateSessionModalPage() {
  return (
    <Suspense fallback={null}>
      <CreateSessionSlideOver />
    </Suspense>
  );
}
