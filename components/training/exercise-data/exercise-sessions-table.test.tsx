import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseSessionsTable } from "./exercise-sessions-table";
import { aggregateSessionMarkers, type MarkerSet } from "@/utils/exercise-session-markers";
import { emptyLoggedActuals } from "@/utils/set-log-measures";
import type { ExercisePR, ExerciseProgressionPoint } from "@/types/training";

// The Sessions table beneath every exercise's chart: one row per logged session
// in the window, newest first — the working sets in shorthand, the type's
// figures, a star on a session holding a record, a click opening the workout —
// sorted from its headings and paged by the rail's arrows.

const units = vi.hoisted(() => ({ preference: "metric" as "metric" | "imperial" }));
// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: units.preference, isLoading: false, error: null }),
}));

/** A session as the kernel makes it from its sets. */
function session(day: number, sets: Partial<MarkerSet>[]): ExerciseProgressionPoint {
  const { tempo: _tempo, ...measures } = emptyLoggedActuals();
  const date = `2026-08-${String(day).padStart(2, "0")}T00:00:00+00:00`;
  return {
    date,
    sessionLogId: `sl-${day}`,
    eventId: `ev-${day}`,
    ...aggregateSessionMarkers(sets.map((s) => ({ setType: "working", ...measures, ...s }))),
    prescribedSets: 3,
    prescribedRepsMin: null,
    prescribedRepsMax: null,
  };
}

/** Bench sessions oldest first, as the read returns them; the load climbs then drops. */
const LOADS = [80, 82.5, 85, 87.5, 90, 92.5, 95, 97.5, 100, 102.5, 105, 60];
const benchSessions = () =>
  LOADS.map((weight, i) => session(i + 1, [{ reps: 5, weight, rpe: 8 }, { reps: 5, weight, rpe: 8.5 }]));

const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

const bodyRows = () => screen.getAllByRole("row").slice(1);

const rowDates = () => bodyRows().map((row) => cellsOf(row)[0]);

const headings = () => screen.getAllByRole("columnheader").map((th) => th.textContent);

/** A heading's sort state, as a screen reader hears it. */
const sortOf = (name: string) => screen.getByRole("columnheader", { name }).getAttribute("aria-sort");

function renderTable(overrides: Partial<Parameters<typeof ExerciseSessionsTable>[0]> = {}) {
  const props = {
    points: benchSessions(),
    exerciseType: "strength" as const,
    records: [] as ExercisePR[],
    recordsLoading: false,
    isError: false,
    onRetry: vi.fn(),
    windowKey: "12",
    audience: "coach" as const,
    onOpenSession: vi.fn(),
    canOpenSession: () => true,
    ...overrides,
  };
  const view = render(<ExerciseSessionsTable {...props} />);
  return { ...view, props };
}

describe("ExerciseSessionsTable", () => {
  beforeEach(() => {
    cleanup();
    units.preference = "metric";
  });

  it("reads a lift's sessions newest first: the sets, then e1RM, the top set, volume and RPE — each cell its number alone", () => {
    renderTable();
    expect(headings()).toEqual(["Date", "Sets (kg)", "e1RM (kg)", "Top set (kg)", "Volume (kg)", "RPE"]);
    expect(rowDates()).toEqual([
      "Aug 12, 2026", "Aug 11, 2026", "Aug 10, 2026", "Aug 9, 2026", "Aug 8, 2026",
      "Aug 7, 2026", "Aug 6, 2026", "Aug 5, 2026", "Aug 4, 2026", "Aug 3, 2026",
    ]);
    // 105 × 5: Epley 122.5. Two equal sets: the top set is the first, and its RPE the row's
    expect(cellsOf(bodyRows()[1])).toEqual(["Aug 11, 2026", "105 × 5 · 105 × 5", "122.5", "105 × 5", "1,050", "8"]);
    expect(cellsOf(bodyRows()[0])).toEqual(["Aug 12, 2026", "60 × 5 · 60 × 5", "70", "60 × 5", "600", "8"]);
  });

  it("reads a bodyweight exercise's reps and a run's time over its distance", () => {
    renderTable({
      exerciseType: "bodyweight",
      points: [session(1, [{ reps: 8 }, { reps: 7 }]), session(2, [{ reps: 12, rpe: 9 }, { reps: 11 }, { reps: 10 }])],
    });
    expect(headings()).toEqual(["Date", "Sets", "Best set", "Total reps", "RPE"]);
    expect(cellsOf(bodyRows()[0])).toEqual(["Aug 2, 2026", "12 · 11 · 10", "12", "33", "9"]);
    cleanup();

    units.preference = "imperial";
    renderTable({
      exerciseType: "endurance",
      points: [session(1, [{ distanceMeters: 5000, durationSeconds: 1570, paceSecondsPerKm: 314, heartRateZone: 3 }])],
    });
    expect(headings()).toEqual(["Date", "Sets", "Pace", "Distance", "Time", "HR zone"]);
    expect(cellsOf(bodyRows()[0])).toEqual(["Aug 1, 2026", "3.11 mi", "8:25 /mi", "3.11 mi", "26:10", "Z3"]);
  });

  it("reads a run's session as a whole: its shape, then the average pace over the total", () => {
    renderTable({
      exerciseType: "endurance",
      points: [
        session(1, [{ distanceMeters: 5000, durationSeconds: 1500, paceSecondsPerKm: 300 }]),
        session(8, [172, 170, 168].map((durationSeconds) => ({ distanceMeters: 800, durationSeconds, paceSecondsPerKm: 213 }))),
        session(15, [{ distanceMeters: 5000, durationSeconds: 1450, paceSecondsPerKm: 290 }]),
      ],
    });
    expect(cellsOf(bodyRows()[0])).toEqual(["Aug 15, 2026", "5 km", "4:50 /km", "5 km", "24:10", "—"]);
    expect(cellsOf(bodyRows()[1])).toEqual([
      "Aug 8, 2026", "3 × 800 m", "3:33 /km", "2.4 km", "8:30", "—",
    ]);
  });

  it("reads a session whose sets logged nothing the shorthand reads as a dash", () => {
    renderTable({ points: [session(1, [{ rir: 2 }, { rir: 1 }])] });
    expect(cellsOf(bodyRows()[0])).toEqual(["Aug 1, 2026", "—", "—", "—", "—", "—"]);
  });

  it("stars the session each record names, naming the record", () => {
    renderTable({
      records: [
        { kind: "rep_max", reps: 5, weight: 105, date: "2026-08-11T00:00:00+00:00", sessionLogId: "sl-11", isRecent: true },
        // Set by a session outside the window: no row to star
        { kind: "rep_max", reps: 1, weight: 120, date: "2026-07-01T00:00:00+00:00", sessionLogId: "sl-old", isRecent: false },
      ],
    });
    const star = screen.getByRole("img", { name: "Personal record: 5 Rep Max · 105 kg" });
    expect(within(bodyRows()[1]).getByRole("img")).toBe(star);
    expect(star).toHaveAttribute("title", "5 Rep Max · 105 kg");
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("stars a session holding a race record, naming the race", () => {
    renderTable({
      points: [session(3, [{ distanceMeters: 5020, durationSeconds: 1205 }])],
      exerciseType: "endurance",
      records: [
        {
          kind: "best_time",
          distanceMeters: 5000,
          durationSeconds: 1205,
          race: "5k",
          date: "2026-08-03T00:00:00+00:00",
          sessionLogId: "sl-3",
          isRecent: true,
        },
      ],
    });
    expect(within(bodyRows()[0]).getByRole("img", { name: "Personal record: 5 km · 20:05" })).toBeInTheDocument();
  });

  it("opens a session's workout from its row, and leaves a row with no workout still", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    renderTable({ onOpenSession, canOpenSession: (point) => point.sessionLogId !== "sl-11" });
    await user.click(screen.getByText("Aug 12, 2026"));
    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession.mock.calls[0][0].sessionLogId).toBe("sl-12");
    await user.click(screen.getByText("Aug 11, 2026"));
    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(bodyRows()[1]).not.toHaveClass("cursor-pointer");
  });

  it("claims nothing until the sessions, the exercise's type and its records have all landed", () => {
    for (const pending of [{ points: undefined }, { exerciseType: undefined }, { recordsLoading: true }]) {
      renderTable(pending);
      expect(screen.queryByRole("columnheader", { name: "Date" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
      cleanup();
    }
    // A failed records read leaves the rows without stars
    renderTable({ records: undefined });
    expect(bodyRows()).toHaveLength(10);
  });

  it("pages ten sessions at a time with the rail's arrows, and never counts them there", async () => {
    const user = userEvent.setup();
    renderTable();
    expect(screen.queryByText(/Showing/)).toBeNull();
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(rowDates()).toEqual(["Aug 2, 2026", "Aug 1, 2026"]);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("sorts from a figure's heading — the first click the way it leads, a second the other way — back to page 1 in one click", async () => {
    const user = userEvent.setup();
    renderTable();
    expect(sortOf("Date")).toBe("descending");
    expect(sortOf("e1RM (kg)")).toBe("none");
    // The sets are what was done, not a number to sort
    expect(screen.queryByRole("button", { name: "Sets (kg)" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await user.click(screen.getByRole("button", { name: "e1RM (kg)" }));
    // One click: the rows, the heading's arrow and the page land together
    expect(sortOf("e1RM (kg)")).toBe("descending");
    expect(sortOf("Date")).toBe("none");
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(rowDates().slice(0, 2)).toEqual(["Aug 11, 2026", "Aug 10, 2026"]);

    await user.click(screen.getByRole("button", { name: "e1RM (kg)" }));
    expect(sortOf("e1RM (kg)")).toBe("ascending");
    expect(rowDates()[0]).toBe("Aug 12, 2026");
  });

  it("says in each heading's title what a click will do, and sorts a pace fastest first", async () => {
    const user = userEvent.setup();
    renderTable();
    expect(screen.getByRole("button", { name: "e1RM (kg)" })).toHaveAttribute("title", "Highest e1RM first");
    expect(screen.getByRole("button", { name: "Date" })).toHaveAttribute("title", "Oldest first");
    cleanup();

    renderTable({
      exerciseType: "endurance",
      points: [
        session(1, [{ distanceMeters: 5000, durationSeconds: 1570, paceSecondsPerKm: 314 }]),
        session(2, [{ distanceMeters: 5000, durationSeconds: 1505, paceSecondsPerKm: 301 }]),
        session(3, [{ distanceMeters: 5000, durationSeconds: 1540, paceSecondsPerKm: 308 }]),
      ],
    });
    await user.click(screen.getByRole("button", { name: "Pace" }));
    expect(sortOf("Pace")).toBe("ascending");
    expect(rowDates()).toEqual(["Aug 2, 2026", "Aug 3, 2026", "Aug 1, 2026"]);
  });

  it("starts a new window on page 1, keeping its sort — through the new window's load", async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderTable();
    await user.click(screen.getByRole("button", { name: "Date" }));
    expect(sortOf("Date")).toBe("ascending");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(bodyRows()).toHaveLength(2);

    rerender(<ExerciseSessionsTable {...props} points={undefined} windowKey="24" />);
    expect(screen.queryByRole("columnheader", { name: "Date" })).toBeNull();

    const more = [...benchSessions(), session(20, [{ reps: 5, weight: 110 }])];
    rerender(<ExerciseSessionsTable {...props} points={more} windowKey="24" />);
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(sortOf("Date")).toBe("ascending");
    expect(rowDates()[0]).toBe("Aug 1, 2026");
  });

  it("says a failed read failed, with Try again", async () => {
    const user = userEvent.setup();
    const { props } = renderTable({ points: undefined, isError: true });
    expect(screen.getByText("Couldn't load the sessions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("says when no session was logged", () => {
    renderTable({ points: [] });
    expect(screen.getByText("No sessions logged yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("shows the client the same table under a heading like Personal Records, with no Columns menu", () => {
    renderTable({ audience: "client" });
    expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Columns/ })).toBeNull();
    expect(headings()).toEqual(["Date", "Sets (kg)", "e1RM (kg)", "Top set (kg)", "Volume (kg)", "RPE"]);
    expect(sortOf("Date")).toBe("descending");
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  });
});
