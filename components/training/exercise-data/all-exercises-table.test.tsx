import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllExercisesTable } from "./all-exercises-table";
import type { ExerciseBestsRow } from "@/types/training";

// The All exercises table: one row per exercise the client has logged — its
// type, sessions and last day, then its bests — sorted from its headings,
// paged ten at a time with the count, a row opening that exercise.

const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

const row = (overrides: Partial<ExerciseBestsRow>): ExerciseBestsRow => ({
  exerciseId: null,
  name: "Exercise",
  exerciseType: "strength",
  sessionCount: 1,
  lastLoggedDate: "2026-09-01T00:00:00+00:00",
  heaviestLoad: null,
  bestEstimatedOneRepMax: null,
  bestSetReps: null,
  bestTime: null,
  heaviestCarry: null,
  longestHoldSeconds: null,
  ...overrides,
});

const BENCH = row({
  exerciseId: "bench",
  name: "Barbell Bench Press",
  sessionCount: 18,
  lastLoggedDate: "2026-09-20T00:00:00+00:00",
  heaviestLoad: 110,
  bestEstimatedOneRepMax: 150,
});
const RUNNING = row({
  exerciseId: "run",
  name: "Running",
  exerciseType: "endurance",
  sessionCount: 13,
  lastLoggedDate: "2026-09-21T00:00:00+00:00",
  bestTime: { race: "5k", durationSeconds: 1505 },
});
const CARRY = row({
  exerciseId: "carry",
  name: "Farmer Carry",
  exerciseType: "carry_sled",
  sessionCount: 4,
  heaviestCarry: { weight: 70, distanceMeters: 40 },
});

/** Twelve exercises: two pages of ten. */
const many = () =>
  Array.from({ length: 12 }, (_, i) =>
    row({ exerciseId: `ex-${i}`, name: `Exercise ${String(i + 1).padStart(2, "0")}`, sessionCount: 20 - i }),
  );

const cellsOf = (tr: HTMLElement) => within(tr).getAllByRole("cell").map((c) => c.textContent);
const bodyRows = () => screen.getAllByRole("row").slice(1);
const names = () => bodyRows().map((tr) => cellsOf(tr)[0]);
const headings = () => screen.getAllByRole("columnheader").map((th) => th.textContent);
const sortOf = (name: string) => screen.getByRole("columnheader", { name }).getAttribute("aria-sort");

function renderTable(overrides: Partial<Parameters<typeof AllExercisesTable>[0]> = {}) {
  const props = {
    rows: [CARRY, RUNNING, BENCH],
    isError: false,
    onRetry: vi.fn(),
    audience: "coach" as const,
    onOpenExercise: vi.fn(),
    ...overrides,
  };
  const view = render(<AllExercisesTable {...props} />);
  return { ...view, props };
}

describe("AllExercisesTable", () => {
  beforeEach(() => {
    cleanup();
    units.preference = "metric";
  });

  it("reads every exercise's type, sessions, last day and bests, most sessions first, a dash where it has none", () => {
    renderTable();
    expect(headings()).toEqual([
      "Exercise",
      "Type",
      "Sessions",
      "Last logged",
      "Heaviest load (kg)",
      "Best e1RM (kg)",
      "Most reps",
      "Best time",
      "Heaviest carry (kg)",
      "Longest hold",
    ]);
    expect(names()).toEqual(["Barbell Bench Press", "Running", "Farmer Carry"]);
    expect(cellsOf(bodyRows()[0])).toEqual([
      "Barbell Bench Press", "Strength", "18", "Sep 20, 2026", "110", "150", "—", "—", "—", "—",
    ]);
    expect(cellsOf(bodyRows()[1])).toEqual([
      "Running", "Endurance", "13", "Sep 21, 2026", "—", "—", "—", "5 km · 25:05", "—", "—",
    ]);
    expect(cellsOf(bodyRows()[2])).toEqual([
      "Farmer Carry", "Carry & sled", "4", "Sep 1, 2026", "—", "—", "—", "—", "70 × 40 m", "—",
    ]);
    expect(sortOf("Sessions")).toBe("descending");
  });

  it("reads loads and distances in the viewer's units, a race's name the same for everyone", () => {
    units.preference = "imperial";
    renderTable();
    expect(headings()).toContain("Heaviest load (lbs)");
    expect(cellsOf(bodyRows()[0])[4]).toBe("242.5");
    expect(cellsOf(bodyRows()[1])[7]).toBe("5 km · 25:05");
    expect(cellsOf(bodyRows()[2])[8]).toBe("155 × 44 yd");
  });

  it("sorts from a heading the way the column leads, then the other way, blanks last", async () => {
    const user = userEvent.setup();
    renderTable();
    const heading = screen.getByRole("button", { name: "Heaviest load (kg)" });
    expect(heading).toHaveAttribute("title", "Heaviest load first");

    await user.click(heading);
    expect(names()).toEqual(["Barbell Bench Press", "Farmer Carry", "Running"]);
    expect(sortOf("Heaviest load (kg)")).toBe("descending");
    expect(sortOf("Sessions")).toBe("none");
    expect(heading).toHaveAttribute("title", "Lightest load first");

    await user.click(screen.getByRole("button", { name: "Exercise" }));
    expect(names()).toEqual(["Barbell Bench Press", "Farmer Carry", "Running"]);
    expect(sortOf("Exercise")).toBe("ascending");
    await user.click(screen.getByRole("button", { name: "Exercise" }));
    expect(names()).toEqual(["Running", "Farmer Carry", "Barbell Bench Press"]);

    // The fastest time first; the exercises with none follow, by name
    await user.click(screen.getByRole("button", { name: "Best time" }));
    expect(names()).toEqual(["Running", "Barbell Bench Press", "Farmer Carry"]);
  });

  it("pages ten exercises at a time with the count, and a sort returns to the first page", async () => {
    const user = userEvent.setup();
    renderTable({ rows: many() });
    expect(screen.getByText("Showing 10 of 12 exercises")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(10);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Showing 2 of 12 exercises")).toBeInTheDocument();
    expect(names()).toEqual(["Exercise 11", "Exercise 12"]);

    await user.click(screen.getByRole("button", { name: "Sessions" }));
    expect(screen.getByText("Showing 10 of 12 exercises")).toBeInTheDocument();
    expect(names()[0]).toBe("Exercise 12");
  });

  it("opens an exercise from its row", async () => {
    const user = userEvent.setup();
    const { props } = renderTable();
    await user.click(screen.getByText("Running"));
    expect(props.onOpenExercise).toHaveBeenCalledWith(RUNNING);
  });

  it("claims nothing while the read is in flight, and says a failed read failed", async () => {
    const user = userEvent.setup();
    renderTable({ rows: undefined });
    // A page of skeleton rows, hidden from a screen reader: the shape, nothing claimed
    expect(screen.queryAllByRole("row")).toHaveLength(0);
    expect(screen.getAllByRole("row", { hidden: true }).length).toBeGreaterThan(1);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    expect(screen.queryByText("No exercises logged yet")).not.toBeInTheDocument();
    cleanup();

    const { props } = renderTable({ rows: undefined, isError: true });
    expect(screen.getByText("Couldn't load the exercises")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onRetry).toHaveBeenCalled();
    expect(screen.queryByText("No exercises logged yet")).not.toBeInTheDocument();
  });

  it("says when no exercise has been logged, with no pager", () => {
    renderTable({ rows: [] });
    expect(screen.getByText("No exercises logged yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });

  it("heads the client's view like its Personal Records", () => {
    renderTable({ audience: "client" });
    expect(screen.getByRole("heading", { level: 2, name: "Exercises" })).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3 exercises")).toBeInTheDocument();
  });
});
