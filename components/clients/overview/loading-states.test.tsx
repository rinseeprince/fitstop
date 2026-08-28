import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { CoachNotesCard } from "./coach-notes-card";
import { IdentityRow } from "./identity-row";
import type { Client } from "@/types/check-in";
import type { CheckInTiming } from "@/types/coach-brief";
import type { ClientNote } from "@/types/coach-overview";


// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


// Both surfaces receive `null`-shaped data both while loading AND when the
// client genuinely has none. Without an explicit loading flag they render a
// confident empty state first and contradict it a moment later — which is what
// these tests exist to prevent.

const CLIENT: Client = {
  id: "client-1",
  coachId: "coach-1",
  name: "Alex Kim",
  email: "alex@example.com",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  includeActivityBurn: false,
  surplusAsCarbs: false,
  timezone: "Australia/Sydney",
};

const TIMING: CheckInTiming = {
  frequency: "weekly",
  lastSubmittedAt: "2026-07-25T09:00:00Z",
  nextDueDate: "2026-08-01",
  daysUntilDue: -6,
  isOverdue: false,
};

const NOTE: ClientNote = {
  id: "note-1",
  body: "Knee niggle",
  isPinned: false,
  createdAt: "2026-07-26T10:00:00Z",
};

const NOTE_PROPS = {
  onAddNote: vi.fn(),
  onTogglePin: vi.fn(),
  onDeleteNote: vi.fn(),
  onOpenNotes: vi.fn(),
};

beforeEach(() => cleanup());

describe("CoachNotesCard", () => {
  it("shows notes that arrived even while a background revalidation runs", () => {
    render(<CoachNotesCard notes={[NOTE]} isLoading {...NOTE_PROPS} />);

    expect(screen.getByText("Knee niggle")).toBeInTheDocument();
  });
});

// The identity row's check-in cluster carries the same trap the schedule card
// it replaced did: `checkInTiming` is null both while the brief is in flight
// AND when the client genuinely has no schedule. It must not offer "Set a
// schedule" to a coach whose client already has one and simply hasn't loaded.
describe("IdentityRow check-in cluster loading state", () => {
  it("does not offer a schedule before the brief resolves", () => {
    render(
      <IdentityRow
        client={CLIENT}
        checkInTiming={null}
        isTimingLoading
        onOpenDetails={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Set a schedule" })).not.toBeInTheDocument();
    expect(screen.queryByText("Not scheduled")).not.toBeInTheDocument();
  });

  it("states the no-schedule case once the brief resolves without timing", () => {
    render(
      <IdentityRow
        client={CLIENT}
        checkInTiming={null}
        isTimingLoading={false}
        onOpenDetails={vi.fn()}
      />
    );

    expect(screen.getByText("Not scheduled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set a schedule" })).toBeInTheDocument();
  });

  it("renders the due date once timing arrives", () => {
    render(
      <IdentityRow
        client={CLIENT}
        checkInTiming={TIMING}
        isTimingLoading={false}
        onOpenDetails={vi.fn()}
      />
    );

    expect(screen.getByText("Next check-in")).toBeInTheDocument();
    expect(screen.getByText("Sat, 1 Aug")).toBeInTheDocument();
    expect(screen.queryByText("Not scheduled")).not.toBeInTheDocument();
  });

  it("drops 'Last submitted' — the check-ins tab owns that history (Q4)", () => {
    render(
      <IdentityRow
        client={CLIENT}
        checkInTiming={TIMING}
        isTimingLoading={false}
        onOpenDetails={vi.fn()}
      />
    );

    expect(screen.queryByText(/Last submitted/)).not.toBeInTheDocument();
  });
});
