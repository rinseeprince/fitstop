import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ExercisesTable } from "./exercises-table";
import type { Exercise } from "@/types/training";

const mockMutate = vi.fn();
let mockExercises: Exercise[] = [];
vi.mock("@/hooks/use-exercise-catalog", () => ({
  useExerciseCatalog: () => ({
    exercises: mockExercises,
    isLoading: false,
    mutate: mockMutate,
  }),
}));

let mockUsageMap = new Map<string, number>();
vi.mock("@/hooks/use-exercise-usage", () => ({
  useExerciseUsage: () => ({
    usage: { perExercise: [], sessionsWithLinks: 0 },
    usageByExercise: mockUsageMap,
    isLoading: false,
  }),
}));

function makeExercise(overrides: Partial<Exercise>): Exercise {
  return {
    id: "ex-1",
    coachId: null,
    name: "Barbell Back Squat",
    muscleGroup: "legs",
    equipment: "barbell",
    category: "compound",
    aliases: [],
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as Exercise;
}

describe("ExercisesTable", () => {
  const onEditExercise = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockExercises = [
      makeExercise({ id: "ex-1", name: "Barbell Back Squat" }),
      makeExercise({
        id: "ex-2",
        name: "Cable Fly",
        muscleGroup: "chest",
        equipment: "cable",
        category: "isolation",
      }),
      makeExercise({
        id: "ex-3",
        name: "Hanging Leg Raise",
        coachId: "coach-1",
        muscleGroup: "core",
        equipment: null,
        category: null,
        aliases: ["hlr"],
      }),
    ];
    mockUsageMap = new Map([
      ["ex-1", 9],
      ["ex-2", 3],
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders usage counts, custom chip, and dashes for missing tags", () => {
    render(<ExercisesTable onEditExercise={onEditExercise} />);
    expect(screen.getByText("9 sessions")).toBeDefined();
    expect(screen.getByText("custom")).toBeDefined(); // only the coach-owned row
    expect(screen.getByText("Showing 3 of 3 exercises")).toBeDefined();
  });

  it("shows row actions only on coach-owned rows", () => {
    render(<ExercisesTable onEditExercise={onEditExercise} />);
    // One coach-owned row → exactly one Edit and one Delete action.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  it("opens the edit dialog callback for a custom exercise", () => {
    render(<ExercisesTable onEditExercise={onEditExercise} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEditExercise).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ex-3" }),
    );
  });

  it("filters by muscle chips and search across aliases", () => {
    render(<ExercisesTable onEditExercise={onEditExercise} />);

    fireEvent.click(screen.getByRole("button", { name: "chest" }));
    expect(screen.queryByText("Barbell Back Squat")).toBeNull();
    expect(screen.getByText("Cable Fly")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByPlaceholderText("Search exercises"), {
      target: { value: "hlr" },
    });
    expect(screen.getByText("Hanging Leg Raise")).toBeDefined();
    expect(screen.queryByText("Cable Fly")).toBeNull();
  });

  it("divider + fires onCreate; hidden without the prop", () => {
    const onCreate = vi.fn();
    render(<ExercisesTable onEditExercise={onEditExercise} onCreate={onCreate} />);
    fireEvent.click(screen.getByLabelText("New exercise"));
    expect(onCreate).toHaveBeenCalledTimes(1);

    cleanup();
    render(<ExercisesTable onEditExercise={onEditExercise} />);
    expect(screen.queryByLabelText("New exercise")).toBeNull();
  });
});
