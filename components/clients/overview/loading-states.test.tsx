import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { CoachNotesCard } from "./coach-notes-card";
import { ClientScheduleCard } from "./client-schedule-card";
import type { Client } from "@/types/check-in";
import type { CheckInTiming } from "@/types/coach-brief";
import type { ClientNote } from "@/types/coach-overview";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


// Both cards receive `null`-shaped data both while loading AND when the client
// genuinely has none. Without an explicit loading flag they render a confident
// empty state first and contradict it a moment later — which is what these
// tests exist to prevent.

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
  expectedCheckInDay: "monday",
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

describe("CoachNotesCard loading state", () => {
  it("does not claim the client has no notes before the fetch resolves", () => {
    render(<CoachNotesCard notes={[]} isLoading {...NOTE_PROPS} />);

    expect(screen.queryByText("No notes about this client yet")).not.toBeInTheDocument();
  });

  it("states the empty case once the fetch resolves empty", () => {
    render(<CoachNotesCard notes={[]} isLoading={false} {...NOTE_PROPS} />);

    expect(screen.getByText("No notes about this client yet")).toBeInTheDocument();
  });

  it("shows notes that arrived even while a background revalidation runs", () => {
    render(<CoachNotesCard notes={[NOTE]} isLoading {...NOTE_PROPS} />);

    expect(screen.getByText("Knee niggle")).toBeInTheDocument();
    expect(screen.queryByText("No notes about this client yet")).not.toBeInTheDocument();
  });
});

describe("ClientScheduleCard check-in strip loading state", () => {
  it("does not claim the client is never asked to check in before the brief resolves", () => {
    render(
      <ClientScheduleCard
        client={CLIENT}
        checkInTiming={null}
        isTimingLoading
        onOpenSettings={vi.fn()}
      />
    );

    expect(screen.queryByText(/never asked to check in/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No check-in schedule")).not.toBeInTheDocument();
  });

  it("states the no-schedule case once the brief resolves without timing", () => {
    render(
      <ClientScheduleCard
        client={CLIENT}
        checkInTiming={null}
        isTimingLoading={false}
        onOpenSettings={vi.fn()}
      />
    );

    expect(screen.getByText("No check-in schedule")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set a schedule" })).toBeInTheDocument();
  });

  it("renders the real strip once timing arrives", () => {
    render(
      <ClientScheduleCard
        client={CLIENT}
        checkInTiming={TIMING}
        isTimingLoading={false}
        onOpenSettings={vi.fn()}
      />
    );

    expect(screen.getByText(/Next check-in due/)).toBeInTheDocument();
    expect(screen.queryByText("No check-in schedule")).not.toBeInTheDocument();
  });
});
