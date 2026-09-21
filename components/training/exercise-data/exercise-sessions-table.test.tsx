import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseSessionsTable } from "./exercise-sessions-table";
import { aggregateSessionMarkers, type MarkerSet } from "@/utils/exercise-session-markers";
import { emptyLoggedActuals } from "@/utils/set-log-measures";
import type { ExerciseProgressionPoint } from "@/types/training";

// The Sessions table beneath every exercise's chart: one row per logged session
// in the window, newest first, a column per measure recorded, the coach's
// Columns menu, the sort on the rail's dropdown and the history tables' pager.

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
    ...aggregateSessionMarkers(sets.map((s) => ({ setType: "working", ...measures, ...s }))),
    prescribedSets: 3,
    prescribedRepsMin: null,
    prescribedRepsMax: null,
  };
}

/** Bench sessions oldest first, as the read returns them; the load climbs then drops. */
const LOADS = [80, 82.5, 85, 87.5, 90, 92.5, 95, 97.5, 100, 102.5, 105, 60];
const benchSessions = () =>
  LOADS.map((weight, i) => session(i + 1, [{ reps: 5, weight, rpe: 8, rir: i === 0 ? 2 : null }]));

// A modal menu hides the page from assistive tech while it is open (Radix), so
// the table is read with hidden elements included: what a sighted coach sees.
const ALL = { hidden: true } as const;

const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell", ALL).map((c) => c.textContent);

const bodyRows = () => screen.getAllByRole("row", ALL).slice(1);

const rowDates = () => bodyRows().map((row) => cellsOf(row)[0]);

const headings = () => screen.getAllByRole("columnheader", ALL).map((th) => th.textContent);

/** A heading's sort state, as a screen reader hears it. */
const sortOf = (name: string) => screen.getByRole("columnheader", { name, ...ALL }).getAttribute("aria-sort");

function renderTable(overrides: Partial<Parameters<typeof ExerciseSessionsTable>[0]> = {}) {
  const props = {
    points: benchSessions(),
    isError: false,
    onRetry: vi.fn(),
    windowKey: "12",
    audience: "coach" as const,
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

  it("lists the window's sessions newest first, Date then every column recorded", () => {
    renderTable();
    expect(headings()).toEqual(["Date", "Load (kg)", "Reps", "RPE", "RIR", "e1RM (kg)", "Volume (kg)", "Sets"]);
    expect(rowDates()).toEqual([
      "Aug 12, 2026", "Aug 11, 2026", "Aug 10, 2026", "Aug 9, 2026", "Aug 8, 2026",
      "Aug 7, 2026", "Aug 6, 2026", "Aug 5, 2026", "Aug 4, 2026", "Aug 3, 2026",
    ]);
    // A session that recorded nothing in a column reads a dash
    expect(cellsOf(bodyRows()[0])).toEqual([
      "Aug 12, 2026", "60", "5", "8", "—", "70", "300", "1/3",
    ]);
  });

  it("pages ten sessions at a time with the rail's arrows, and never counts them there", async () => {
    const user = userEvent.setup();
    renderTable();
    // The session window on the rail above already says how many (owner, 2026-09-21)
    expect(screen.queryByText(/Showing/)).toBeNull();
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(rowDates()).toEqual(["Aug 2, 2026", "Aug 1, 2026"]);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("keeps the arrows, greyed, when every session fits on one page", () => {
    renderTable({ points: benchSessions().slice(0, 8) });
    expect(bodyRows()).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("sorts from any heading — the first click the way the column leads, a second click the other way — back to page 1", async () => {
    const user = userEvent.setup();
    renderTable();
    // No sort picker on the rail: the headings sort
    expect(screen.queryByRole("button", { name: /Newest first/ })).toBeNull();
    expect(sortOf("Date")).toBe("descending");
    expect(sortOf("Load (kg)")).toBe("none");
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await user.click(screen.getByRole("button", { name: "Load (kg)" }));
    // One click: the rows, the heading's arrow and the page land together
    expect(sortOf("Load (kg)")).toBe("descending");
    expect(sortOf("Date")).toBe("none");
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(bodyRows().slice(0, 3).map((row) => cellsOf(row)[1])).toEqual(["105", "102.5", "100"]);

    await user.click(screen.getByRole("button", { name: "Load (kg)" }));
    expect(sortOf("Load (kg)")).toBe("ascending");
    expect(bodyRows().slice(0, 2).map((row) => cellsOf(row)[1])).toEqual(["60", "80"]);

    await user.click(screen.getByRole("button", { name: "Date" }));
    expect(sortOf("Date")).toBe("descending");
    expect(rowDates()[0]).toBe("Aug 12, 2026");
    await user.click(screen.getByRole("button", { name: "Date" }));
    expect(sortOf("Date")).toBe("ascending");
    expect(rowDates()[0]).toBe("Aug 1, 2026");
  });

  it("says in each heading's title what a click will do", async () => {
    const user = userEvent.setup();
    renderTable();
    expect(screen.getByRole("button", { name: "Load (kg)" })).toHaveAttribute("title", "Heaviest load first");
    expect(screen.getByRole("button", { name: "Date" })).toHaveAttribute("title", "Oldest first");
    await user.click(screen.getByRole("button", { name: "Load (kg)" }));
    expect(screen.getByRole("button", { name: "Load (kg)" })).toHaveAttribute("title", "Lightest load first");
    expect(screen.getByRole("button", { name: "Date" })).toHaveAttribute("title", "Newest first");
  });

  it("sorts a pace fastest first on its first click", async () => {
    const user = userEvent.setup();
    renderTable({
      points: [
        session(1, [{ distanceMeters: 5000, paceSecondsPerKm: 314 }]),
        session(2, [{ distanceMeters: 5000, paceSecondsPerKm: 301 }]),
        session(3, [{ distanceMeters: 5000, paceSecondsPerKm: 308 }]),
      ],
    });
    await user.click(screen.getByRole("button", { name: "Pace" }));
    expect(sortOf("Pace")).toBe("ascending");
    expect(bodyRows().map((row) => cellsOf(row)[2])).toEqual(["5:01 /km", "5:08 /km", "5:14 /km"]);
  });

  it("ticks a column off from the Columns menu at once, the menu staying open", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Columns for the sessions table" }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("group").map((g) => g.firstElementChild?.textContent)).toEqual([
      "Strength",
      "Framework",
    ]);
    expect(within(menu).getAllByRole("menuitemcheckbox").map((o) => o.textContent)).toEqual([
      "Load", "Reps", "RPE", "RIR", "e1RM", "Volume", "Sets",
    ]);

    await user.click(screen.getByRole("menuitemcheckbox", { name: "RIR" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "RIR" })).toHaveAttribute("aria-checked", "false");
    expect(headings()).not.toContain("RIR");
    expect(headings()).toContain("Load (kg)");
  });

  it("falls back to Newest first when the sorted column is ticked off, and returns to it when ticked back on", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Load (kg)" }));
    await user.click(screen.getByRole("button", { name: "Load (kg)" }));
    expect(rowDates()[0]).toBe("Aug 12, 2026"); // 60 kg, lightest first

    await user.click(screen.getByRole("button", { name: "Columns for the sessions table" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Load" }));
    // In the same render as the tick, the menu still open
    expect(sortOf("Date")).toBe("descending");
    expect(rowDates()[1]).toBe("Aug 11, 2026");

    await user.click(screen.getByRole("menuitemcheckbox", { name: "Load" }));
    expect(sortOf("Load (kg)")).toBe("ascending");
    expect(sortOf("Date")).toBe("none");
  });

  it("starts a new window on page 1, keeping its columns and its sort", async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderTable();
    await user.click(screen.getByRole("button", { name: "Date" }));
    expect(sortOf("Date")).toBe("ascending");
    await user.click(screen.getByRole("button", { name: "Columns for the sessions table" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Volume" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(bodyRows()).toHaveLength(2);

    const more = [...benchSessions(), session(20, [{ reps: 5, weight: 110 }])];
    rerender(<ExerciseSessionsTable {...props} points={more} windowKey="24" />);
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(sortOf("Date")).toBe("ascending");
    expect(headings()).not.toContain("Volume (kg)");
    expect(rowDates()[0]).toBe("Aug 1, 2026");
  });

  it("keeps the picked sort through a new window's load", async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderTable();
    await user.click(screen.getByRole("button", { name: "Load (kg)" }));

    rerender(<ExerciseSessionsTable {...props} points={undefined} windowKey="24" />);
    expect(screen.queryByRole("columnheader", { name: "Date" })).toBeNull();
    // No arrows until there are rows to page
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();

    rerender(<ExerciseSessionsTable {...props} windowKey="24" />);
    expect(sortOf("Load (kg)")).toBe("descending");
    expect(bodyRows().slice(0, 1).map((row) => cellsOf(row)[1])).toEqual(["105"]);
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
    expect(screen.getByRole("button", { name: "Columns for the sessions table" })).toBeDisabled();
  });

  it("reads each column in the viewer's units — a run's time with its distance", () => {
    units.preference = "imperial";
    renderTable({
      points: [session(1, [{ distanceMeters: 5000, durationSeconds: 1570, paceSecondsPerKm: 314, heartRateZone: 3, rpe: 7 }])],
    });
    expect(headings()).toEqual(["Date", "RPE", "Distance", "Time", "Pace", "HR zone", "Sets"]);
    expect(cellsOf(bodyRows()[0])).toEqual([
      "Aug 1, 2026", "7", "3.11 mi", "26:103.11 mi", "8:25 /mi", "Z3", "1/3",
    ]);
  });

  it("shows the client every column recorded, with no Columns menu, under a heading like Personal Records", () => {
    renderTable({ audience: "client" });
    expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Columns for the sessions table" })).toBeNull();
    expect(headings()).toEqual(["Date", "Load (kg)", "Reps", "RPE", "RIR", "e1RM (kg)", "Volume (kg)", "Sets"]);
    // The same heading sort as the coach's
    expect(sortOf("Date")).toBe("descending");
    expect(screen.getByRole("button", { name: "Reps" })).toHaveAttribute("title", "Most reps first");
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });
});
