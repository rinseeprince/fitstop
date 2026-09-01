"use client";

import { ProgramBuilder } from "@/components/clients/training/program-builder/program-builder";

// Full-page Program builder route. State (working tree, mode, save pipeline)
// lives in ProgramDraftProvider in this segment's layout — keyed per plan
// there, shared with the create-session slide-over's @modal slot.
export default function ProgramBuilderPage() {
  return <ProgramBuilder />;
}
