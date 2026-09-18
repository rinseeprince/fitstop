import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

import { TrainingSessionRow } from "./training-session-row";
import type {
  ClientTrainingExercise,
  ClientTrainingSessionEntry,
} from "@/types/client-training-plan";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";

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
    groups: [
      {
        id: "grp-1",
        orderIndex: 0,
        ...STRAIGHT_SETS,
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
            setSpecs: null,
            videoUrl: null,
            prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
          },
        ],
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
      groups: [],
    });

    render(<TrainingSessionRow session={session} />);

    expect(screen.getByText("Rest")).toBeInTheDocument();
    expect(screen.queryByText("Recovery Day")).toBeNull();

    fireEvent.click(screen.getByRole("button"));
    expect(
      screen.getByText("Rest day - no training prescribed."),
    ).toBeInTheDocument();
  });

  describe("groups", () => {
    const exercise = (
      id: string,
      name: string,
      over: Partial<ClientTrainingExercise> = {},
    ): ClientTrainingExercise => ({
      id,
      name,
      orderIndex: 0,
      sets: 3,
      repsMin: 10,
      repsMax: 10,
      repsTarget: null,
      rpeTarget: null,
      tempo: null,
      restSeconds: 60,
      isWarmup: false,
      setSpecs: null,
      videoUrl: null,
      prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
      ...over,
    });
    const reps = (counts: number[]) =>
      counts.map((r, i) => ({
        set_number: i + 1,
        set_type: "working" as const,
        reps_min: r,
        reps_max: r,
      }));

    function groupedSession() {
      return makeSession({
        groups: [
          {
            id: "grp-squat",
            orderIndex: 0,
            ...STRAIGHT_SETS,
            exercises: [exercise("ex-squat", "Back Squat", { sets: 2, repsMin: 5, repsMax: 5, restSeconds: 120 })],
          },
          {
            id: "grp-superset",
            orderIndex: 1,
            ...STRAIGHT_SETS,
            format: "circuit",
            rounds: 3,
            restBetweenExercisesSeconds: 0,
            restBetweenRoundsSeconds: 90,
            notes: "Back to back",
            exercises: [
              exercise("ex-bench", "Bench Press", { repsMin: 8, repsMax: 10, rpeTarget: 8 }),
              exercise("ex-thruster", "Thruster", { setSpecs: reps([21, 15, 9]) }),
            ],
          },
        ],
      });
    }

    it("lists a linked group under its heading and a lone exercise as before", () => {
      render(<TrainingSessionRow session={groupedSession()} />);
      fireEvent.click(screen.getByRole("button"));

      // Still counts exercises: a superset of two is two.
      expect(screen.getByText("3 exercises")).toBeInTheDocument();

      const superset = screen.getByRole("listitem", { name: "Superset · 3 rounds" });
      expect(within(superset).getByText("Superset · 3 rounds")).toBeInTheDocument();
      expect(
        within(superset).getByText("No rest between exercises · 1m 30s rest between rounds"),
      ).toBeInTheDocument();
      expect(within(superset).getByText("Back to back")).toBeInTheDocument();
      expect(within(superset).getByText("Bench Press")).toBeInTheDocument();
      expect(within(superset).getByText("Thruster")).toBeInTheDocument();

      // The lone squat sits outside any group, exactly as before.
      const squat = screen.getByText("Back Squat").closest("li");
      expect(squat).not.toBeNull();
      expect(superset.contains(squat)).toBe(false);
      expect(within(squat!).getByText("2 x 5")).toBeInTheDocument();
      expect(within(squat!).getByText("Rest 120s")).toBeInTheDocument();
    });

    it("reads a superset or circuit exercise's reps round by round, with no rest of its own", () => {
      render(<TrainingSessionRow session={groupedSession()} />);
      fireEvent.click(screen.getByRole("button"));

      const superset = screen.getByRole("listitem", { name: "Superset · 3 rounds" });
      expect(within(superset).getByText("8-10 reps @ RPE 8")).toBeInTheDocument();
      expect(within(superset).getByText("21-15-9 reps")).toBeInTheDocument();
      expect(within(superset).queryByText(/^Rest /)).toBeNull();
      expect(within(superset).queryByText(/3 x/)).toBeNull();
    });
  });
});
