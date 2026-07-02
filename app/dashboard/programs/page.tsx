"use client";

import { ProgramsStatBand } from "@/components/programs/programs-stat-band";
import { ProgramsTable } from "@/components/programs/programs-table";

// The Programs library page (absorbs the old /dashboard/training-library).
// Browse + duplicate + delete only — creation lives in the section topbar
// ("New program"), a program is edited on its own builder page, and
// assignment to a client happens from that client's training planner
// (Phase 5), so there is no apply-to-client affordance on this surface.
// Drafts are shown with a Draft badge (fixes the invisible-orphan liability).
export default function ProgramsPage() {
  return (
    <div className="space-y-5">
      <ProgramsStatBand />
      <ProgramsTable />
    </div>
  );
}
