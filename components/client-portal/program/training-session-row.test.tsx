import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { TrainingSessionRow } from "./training-session-row";
import type { ClientTrainingSessionEntry } from "@/types/client-training-plan";

function makeSession(
  overrides: Partial<ClientTrainingSessionEntry> = {},
): ClientTrainingSessionEntry {
  return {
    id: "s-1",
    name: "Push",
    focus: "Chest",
    orderIndex: 0,
    isRest: false,
    estimatedDurationMinutes: 60,
    exercises: [
      {
        id: "ex-1",
        name: "Bench Press",
        orderIndex: 0,
        sets: 4,
        repsMin: 8,
        repsMax: 10,
        repsTarget: null,
        rpeTarget: 8,
        tempo: "3-1-1",
        restSeconds: 120,
        isWarmup: false,
        supersetGroup: null,
        setSpecs: null,
        videoUrl: null,
        prescribedFields: null,
      },
    ],
    ...overrides,
  };
}

describe("TrainingSessionRow", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the session name and chevron, with exercises hidden when collapsed", () => {
    render(<TrainingSessionRow session={makeSession()} />);

    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.queryByText("Bench Press")).toBeNull();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles aria-expanded and reveals exercises on click", () => {
    render(<TrainingSessionRow session={makeSession()} />);

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });

  it("renders sets/reps/RPE on a font-mono-display line when expanded", () => {
    render(<TrainingSessionRow session={makeSession()} />);

    fireEvent.click(screen.getByRole("button"));

    const prescription = screen.getByText("4 x 8-10 @ RPE 8");
    expect(prescription).toBeInTheDocument();
    expect(prescription.className).toContain("font-mono-display");
  });

  it("renders the rest-day message when isRest is true", () => {
    const session = makeSession({
      id: "rest-2",
      name: "Recovery Day",
      isRest: true,
      focus: null,
      estimatedDurationMinutes: null,
      exercises: [],
    });

    render(<TrainingSessionRow session={session} />);

    expect(screen.getByText("Rest")).toBeInTheDocument();
    expect(screen.queryByText("Recovery Day")).toBeNull();

    fireEvent.click(screen.getByRole("button"));
    expect(
      screen.getByText("Rest day - no training prescribed."),
    ).toBeInTheDocument();
  });
});
