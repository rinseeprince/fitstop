import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditPhaseDialog } from "./edit-phase-dialog";
import type { Phase } from "@/types/roadmap";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function makePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: "phase-1",
    roadmapId: "roadmap-1",
    clientId: "client-1",
    name: "Hypertrophy Block",
    orderIndex: 0,
    status: "planned",
    milestones: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderDialog(phase: Phase) {
  return render(
    <EditPhaseDialog
      phase={phase}
      clientId="client-1"
      weightUnit="lbs"
      open
      onOpenChange={vi.fn()}
      onSuccess={vi.fn()}
    />
  );
}

describe("EditPhaseDialog goal-edit lock", () => {
  it("enables goal inputs for a planned phase", () => {
    renderDialog(makePhase({ status: "planned" }));
    expect(screen.getByLabelText(/Goal Weight/i)).not.toBeDisabled();
  });

  it("enables goal inputs for an active phase", () => {
    renderDialog(makePhase({ status: "active" }));
    expect(screen.getByLabelText(/Goal Weight/i)).not.toBeDisabled();
  });

  it("disables goal inputs and shows the lock message for a completed phase", () => {
    renderDialog(makePhase({ status: "completed" }));
    expect(screen.getByLabelText(/Goal Weight/i)).toBeDisabled();
    expect(
      screen.getByText(/locked once a phase is completed or skipped/i)
    ).toBeInTheDocument();
  });

  it("disables goal inputs for a skipped phase", () => {
    renderDialog(makePhase({ status: "skipped" }));
    expect(screen.getByLabelText(/Goal Weight/i)).toBeDisabled();
  });

  it("shows no active-phase warning until a goal field changes", () => {
    renderDialog(makePhase({ status: "active" }));
    expect(
      screen.queryByText(/automatically recalculate the nutrition plan/i)
    ).not.toBeInTheDocument();
  });

  it("warns when a goal is changed on an active phase", async () => {
    const user = userEvent.setup();
    renderDialog(makePhase({ status: "active" }));

    await user.type(screen.getByLabelText(/Goal Weight/i), "170");

    expect(
      screen.getByText(/automatically recalculate the nutrition plan/i)
    ).toBeInTheDocument();
  });
});
