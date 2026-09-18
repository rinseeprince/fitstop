import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { ExerciseCard } from "./exercise-card";
import type { DropLineEdge } from "./drop-line";
import { applySetSpecEdit, type SetSpecEdit } from "@/utils/set-spec-edits";
import type { ExerciseDraft } from "./program-builder-types";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars. Any
// test rendering a component that calls useUnits() must stub this module.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


function makeExercise(overrides: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return {
    uid: "ex-1",
    exerciseId: null,
    name: "Bench Press",
    setSpecs: null,
    sets: 4,
    repsMin: 8,
    repsMax: 12,
    repsTarget: null,
    rpeTarget: 8,
    percentage1rm: null,
    tempo: null,
    restSeconds: 120,
    isWarmup: false,
    notes: null,
    videoUrl: null,
    prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
    ...overrides,
  };
}

function Wrapper({
  exercise,
  mode = "edit",
  defaultExpanded,
  onRemove = () => undefined,
  roundsAreRows = false,
  pick = null,
  dropLine = null,
}: {
  exercise: ExerciseDraft;
  mode?: "view" | "edit";
  defaultExpanded?: boolean;
  onRemove?: () => void;
  roundsAreRows?: boolean;
  pick?: { picked: boolean; onToggle: () => void } | null;
  dropLine?: DropLineEdge | null;
}) {
  // Stateful harness standing in for the draft: applies spec edits through
  // the real kernel so the test exercises the re-projection round-trip.
  const [current, setCurrent] = useState(exercise);
  // Expansion is controlled by the parent now (one open at a time), so the
  // harness owns it.
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const handleSpecEdit = (edit: SetSpecEdit) => {
    const result = applySetSpecEdit(current, edit);
    if (result.ok) setCurrent(result.exercise);
  };
  return (
    <DndContext>
      <ExerciseCard
        exercise={current}
        ordinal={1}
        mode={mode}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((v) => !v)}
        roundsAreRows={roundsAreRows}
        drop={{ id: `item:grp-${current.uid}`, data: { type: "item", index: 0, linked: false } }}
        dropLine={dropLine}
        pick={pick}
        onEdit={(patch) => setCurrent((e) => ({ ...e, ...patch }))}
        onSpecEdit={handleSpecEdit}
        onRemove={onRemove}
      />
    </DndContext>
  );
}

describe("ExerciseCard", () => {
  beforeEach(() => cleanup());

  it("compact row shows the projected summary; legacy superset/warm-up fields render nothing", () => {
    // Fixture carries isWarmup — retired from the builder UI (warm-ups are a
    // per-set type) — and the old "SS A" superset chip must not render either.
    render(<Wrapper exercise={makeExercise({ isWarmup: true, videoUrl: "https://x.io/v" })} />);
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("4×8-12")).toBeInTheDocument();
    expect(screen.queryByText("SS A")).toBeNull();
    expect(screen.queryByText("Warm-up")).toBeNull();
    // Sets are hidden until expanded.
    expect(screen.queryByLabelText("Set 1 type")).toBeNull();
  });

  it("the expanded editor exposes no superset or warm-up controls", () => {
    render(<Wrapper exercise={makeExercise()} defaultExpanded />);
    expect(screen.queryByText("Superset group")).toBeNull();
    expect(screen.queryByText("Counts as warm-up work")).toBeNull();
    // The remaining exercise-level fields survive.
    // Both live behind the "Video & note" text action now.
    expect(screen.queryByText("Video URL")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Video & note/ }));
    expect(screen.getByText("Video URL")).toBeInTheDocument();
    expect(screen.getByText("Coach note")).toBeInTheDocument();
  });

  it("expanding a compact-only exercise synthesizes per-set rows (expand-on-read)", () => {
    render(<Wrapper exercise={makeExercise()} />);
    fireEvent.click(screen.getByLabelText("Expand sets"));
    // 4 compact sets → 4 working rows.
    expect(screen.getByLabelText("Set 1 type")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 4 type")).toBeInTheDocument();
    expect(screen.queryByLabelText("Set 5 type")).toBeNull();
  });

  it("add-set re-projects the compact summary (5 × after adding to 4 working sets)", () => {
    render(<Wrapper exercise={makeExercise()} />);
    fireEvent.click(screen.getByLabelText("Expand sets"));
    fireEvent.click(screen.getByText("Add set"));
    expect(screen.getByLabelText("Set 5 type")).toBeInTheDocument();
    expect(screen.getByText("5×8-12")).toBeInTheDocument();
  });

  it("removing a set re-projects the compact summary down", () => {
    render(<Wrapper exercise={makeExercise()} />);
    fireEvent.click(screen.getByLabelText("Expand sets"));
    fireEvent.click(screen.getByLabelText("Remove set 4"));
    expect(screen.getByText("3×8-12")).toBeInTheDocument();
  });

  it("wires remove; view mode hides all editing affordances", () => {
    const onRemove = vi.fn();
    render(<Wrapper exercise={makeExercise()} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Remove Bench Press"));
    expect(onRemove).toHaveBeenCalled();

    cleanup();
    render(<Wrapper exercise={makeExercise()} mode="view" />);
    expect(screen.queryByLabelText("Remove Bench Press")).toBeNull();
    expect(screen.queryByLabelText("Drag Bench Press")).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand sets"));
    expect(screen.queryByText("Add set")).toBeNull();
    expect(screen.queryByLabelText("Duplicate set 1")).toBeNull();
  });

  it("defaultExpanded opens straight into per-set authoring", () => {
    render(<Wrapper exercise={makeExercise()} defaultExpanded />);
    // No expand click — the set rows are already there.
    expect(screen.getByLabelText("Set 1 type")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 4 type")).toBeInTheDocument();
  });

  it("duplicate-set clones the row in place (values included) and renumbers", () => {
    render(
      <Wrapper
        exercise={makeExercise({
          sets: 2,
          repsMin: 5,
          repsMax: 10,
          rpeTarget: null,
          setSpecs: [
            { set_number: 1, set_type: "working", reps_min: 5, reps_max: 5 },
            { set_number: 2, set_type: "working", reps_min: 8, reps_max: 10 },
          ],
        })}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByLabelText("Duplicate set 1"));
    // Row 2 is the clone of row 1; the old row 2 renumbered to 3.
    // Set 1 is 5..5, which the single input collapses to "5"; its clone shows
    // the same. The old row 2 keeps its real range.
    expect(screen.getByLabelText("Set 2 reps")).toHaveValue("5");
    expect(screen.getByLabelText("Set 3 reps")).toHaveValue("8-10");
    // Compact summary re-projected across the 3 working sets.
    expect(screen.getByText("3×5-10")).toBeInTheDocument();
  });
});

describe("ExerciseCard — prescription columns (migration 149)", () => {
  beforeEach(() => cleanup());

  const openMenu = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByLabelText(/^Columns for /));

  it("shows every column by default, because null means all five", () => {
    render(<Wrapper exercise={makeExercise({ prescribedFields: ["set_type", "reps", "load", "rpe", "rest"] })} defaultExpanded />);
    for (const label of ["Type", "Reps", "Load", "RPE", "Rest s"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders only the prescribed columns", () => {
    render(
      <Wrapper
        exercise={makeExercise({ prescribedFields: ["reps", "rest"] })}
        defaultExpanded
      />,
    );
    expect(screen.getByText("Reps")).toBeInTheDocument();
    expect(screen.getByText("Rest s")).toBeInTheDocument();
    expect(screen.queryByText("Load")).toBeNull();
    expect(screen.queryByText("RPE")).toBeNull();
    // The set-type select goes with its column.
    expect(screen.queryByLabelText("Set 1 type")).toBeNull();
    // …and the load inputs with theirs.
    expect(screen.queryByLabelText("Set 1 load type")).toBeNull();
  });

  it("unticking a column removes it without touching the values behind it", async () => {
    const user = userEvent.setup();
    // The spec keeps its RPE; only the prescription's SHAPE changes, so
    // re-ticking brings the number back rather than a blank.
    const exercise = makeExercise({
      setSpecs: [
        { set_number: 1, set_type: "working", reps_min: 8, reps_max: 10, rpe_min: 9, rpe_max: 9 },
      ],
      sets: 1,
      prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
    });
    render(<Wrapper exercise={exercise} defaultExpanded />);
    expect(screen.getByLabelText("Set 1 RPE")).toHaveValue("9");

    await openMenu(user);
    await user.click(screen.getByRole("menuitemcheckbox", { name: "RPE" }));
    expect(screen.queryByLabelText("Set 1 RPE")).toBeNull();

    // Re-tick: the 9 is still there.
    await user.click(screen.getByRole("menuitemcheckbox", { name: "RPE" }));
    expect(screen.getByLabelText("Set 1 RPE")).toHaveValue("9");
  });

  it("refuses to untick the last remaining column", async () => {
    const user = userEvent.setup();
    render(
      <Wrapper exercise={makeExercise({ prescribedFields: ["reps"] })} defaultExpanded />,
    );
    await openMenu(user);
    expect(screen.getByRole("menuitemcheckbox", { name: "Reps" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Reps" }));
    // Assert on the inputs, not the header text — the menu is still open and
    // carries a "Reps" label of its own.
    expect(screen.getByLabelText("Set 1 reps")).toBeInTheDocument();
  });

  it("the Strength preset restores today's five columns", async () => {
    const user = userEvent.setup();
    render(
      <Wrapper exercise={makeExercise({ prescribedFields: ["reps"] })} defaultExpanded />,
    );
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Strength" }));
    for (const label of [
      "Set 1 type",
      "Set 1 reps",
      "Set 1 load type",
      "Set 1 RPE",
      "Set 1 rest seconds",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("the Endurance preset swaps the grid to its columns, each with its own box", async () => {
    const user = userEvent.setup();
    render(<Wrapper exercise={makeExercise()} defaultExpanded />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Endurance" }));
    await user.keyboard("{Escape}");
    for (const label of ["Set 1 type", "Set 1 distance", "Set 1 duration", "Set 1 pace", "Set 1 HR zone", "Set 1 rest seconds"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Set 1 reps")).toBeNull();
    expect(screen.queryByLabelText("Set 1 load type")).toBeNull();
    expect(screen.queryByLabelText("Set 1 RPE")).toBeNull();
    // The header names them, in the grid's order.
    const header = screen.getByText("Distance").parentElement!;
    expect([...header.querySelectorAll("span")].map((span) => span.textContent)).toEqual([
      "#", "Type", "Distance", "Duration", "Pace", "HR zone", "Rest s", "",
    ]);
  });

  it("every chosen column edits its own target: a range in the viewer's units, a tempo, a zone", async () => {
    const user = userEvent.setup();
    const onSpecEdit = vi.fn();
    const exercise = makeExercise({
      sets: 1,
      setSpecs: [
        {
          set_number: 1, set_type: "working",
          distance_meters_min: 5000, distance_meters_max: 5000,
          duration_seconds_min: 1500, duration_seconds_max: 1500,
          pace_seconds_per_km_min: 285, pace_seconds_per_km_max: 285,
          tempo: "3-1-X-0",
        },
      ],
      prescribedFields: ["set_type", "distance", "duration", "pace", "tempo", "heart_rate_zone", "rest"],
    });
    // Records every edit AND applies it through the kernel, as the draft
    // does, so a box re-seeds from what it committed and a later blur on it
    // is the focus-through the guard exists for.
    function Harness() {
      const [current, setCurrent] = useState(exercise);
      return (
        <DndContext>
          <ExerciseCard
            exercise={current}
            ordinal={1}
            mode="edit"
            expanded
            onToggleExpanded={() => undefined}
            roundsAreRows={false}
            drop={{ id: "item:grp-ex-1", data: { type: "item", index: 0, linked: false } }}
            dropLine={null}
            pick={null}
            onEdit={() => undefined}
            onSpecEdit={(edit) => {
              onSpecEdit(edit);
              const result = applySetSpecEdit(current, edit);
              if (result.ok) setCurrent(result.exercise);
            }}
            onRemove={() => undefined}
          />
        </DndContext>
      );
    }
    render(<Harness />);
    expect(screen.getByLabelText("Set 1 distance")).toHaveValue("5 km");
    expect(screen.getByLabelText("Set 1 duration")).toHaveValue("25:00");
    expect(screen.getByLabelText("Set 1 pace")).toHaveValue("4:45 /km");
    expect(screen.getByLabelText("Set 1 tempo")).toHaveValue("3-1-X-0");

    const distance = screen.getByLabelText("Set 1 distance");
    await user.clear(distance);
    await user.type(distance, "400-800 m");
    await user.tab();
    expect(onSpecEdit).toHaveBeenLastCalledWith({
      kind: "update-set", index: 0, patch: { distance_meters_min: 400, distance_meters_max: 800 },
    });
    expect(distance).toHaveValue("400-800 m");

    const zone = screen.getByLabelText("Set 1 HR zone");
    await user.type(zone, "2-3");
    await user.tab();
    expect(onSpecEdit).toHaveBeenLastCalledWith({
      kind: "update-set", index: 0, patch: { heart_rate_zone_min: 2, heart_rate_zone_max: 3 },
    });
    expect(zone).toHaveValue("Z2-Z3");

    const tempo = screen.getByLabelText("Set 1 tempo");
    await user.clear(tempo);
    await user.type(tempo, "2-0-x-1");
    await user.tab();
    expect(onSpecEdit).toHaveBeenLastCalledWith({ kind: "update-set", index: 0, patch: { tempo: "2-0-X-1" } });
    expect(tempo).toHaveValue("2-0-X-1");

    // A typo reverts and writes nothing.
    onSpecEdit.mockClear();
    const pace = screen.getByLabelText("Set 1 pace");
    await user.clear(pace);
    await user.type(pace, "fast");
    await user.tab();
    expect(onSpecEdit).not.toHaveBeenCalled();
    expect(pace).toHaveValue("4:45 /km");
  });

  it("hides the picker in view mode — a locked session prescribes nothing new", () => {
    render(
      <Wrapper exercise={makeExercise()} mode="view" defaultExpanded />,
    );
    expect(screen.queryByLabelText(/^Columns for /)).toBeNull();
  });
});

describe("ExerciseCard — in a superset or circuit (rows are rounds)", () => {
  beforeEach(() => cleanup());

  const scheme = () =>
    makeExercise({
      sets: 3,
      restSeconds: 60,
      setSpecs: [
        { set_number: 1, set_type: "working", reps_min: 21, reps_max: 21, rest_seconds: 60 },
        { set_number: 2, set_type: "working", reps_min: 15, reps_max: 15, rest_seconds: 60 },
        { set_number: 3, set_type: "working", reps_min: 9, reps_max: 9, rest_seconds: 60 },
      ],
    });

  it("reads its reps round by round, as the client sees them", () => {
    render(<Wrapper exercise={scheme()} roundsAreRows />);
    expect(screen.getByText("21-15-9 reps")).toBeInTheDocument();
    expect(screen.queryByText("3×9-21")).toBeNull();
  });

  it("heads its rows Round, with no Rest column and no way to add or remove a row", async () => {
    const user = userEvent.setup();
    render(<Wrapper exercise={scheme()} roundsAreRows defaultExpanded />);
    expect(screen.getByText("Round")).toBeInTheDocument();
    expect(screen.queryByText("#")).toBeNull();
    expect(screen.queryByText("Rest s")).toBeNull();
    expect(screen.queryByLabelText("Set 1 rest seconds")).toBeNull();
    expect(screen.queryByText("Add set")).toBeNull();
    expect(screen.queryByLabelText("Duplicate set 1")).toBeNull();
    expect(screen.queryByLabelText("Remove set 1")).toBeNull();
    // Each round keeps its own targets.
    expect(screen.getByLabelText("Set 2 reps")).toHaveValue("15");

    await user.click(screen.getByLabelText(/^Columns for /));
    expect(screen.queryByRole("menuitemcheckbox", { name: "Rest" })).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: "Reps" })).toBeInTheDocument();
  });

  it("widens the number column to fit Round, for the heading and every round alike", () => {
    const template = (el: HTMLElement) =>
      el.closest<HTMLElement>('[style*="grid-template-columns"]')!.style.gridTemplateColumns;

    render(<Wrapper exercise={scheme()} roundsAreRows defaultExpanded />);
    const rounds = template(screen.getByText("Round"));
    expect(rounds.split(" ")[0]).toBe("44px");
    for (const n of [1, 2, 3]) {
      expect(template(screen.getByLabelText(`Set ${n} reps`))).toBe(rounds);
    }

    cleanup();
    render(<Wrapper exercise={scheme()} roundsAreRows={false} defaultExpanded />);
    const sets = template(screen.getByText("#"));
    expect(sets.split(" ")[0]).toBe("20px");
    expect(template(screen.getByLabelText("Set 1 reps"))).toBe(sets);
  });

  it("unticking a column there keeps the stored Rest choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Harness() {
      const [exercise, setExercise] = useState(scheme());
      return (
        <DndContext>
          <ExerciseCard
            exercise={exercise}
            ordinal={1}
            mode="edit"
            expanded
            onToggleExpanded={() => undefined}
            roundsAreRows
            drop={{ id: "member:ex-1", data: { type: "member", groupUid: "grp-c", index: 0 } }}
            dropLine={null}
            pick={null}
            onEdit={(patch) => {
              onChange(patch);
              setExercise((e) => ({ ...e, ...patch }));
            }}
            onSpecEdit={() => undefined}
            onRemove={() => undefined}
          />
        </DndContext>
      );
    }
    render(<Harness />);
    await user.click(screen.getByLabelText(/^Columns for /));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "RPE" }));
    expect(onChange).toHaveBeenCalledWith({ prescribedFields: ["set_type", "reps", "load", "rest"] });
  });
});

describe("ExerciseCard — picking exercises to link", () => {
  beforeEach(() => cleanup());

  it("makes the whole row a checkbox that toggles the pick, with no grip, remove or expand", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <Wrapper exercise={makeExercise()} pick={{ picked: false, onToggle }} />,
    );
    const row = screen.getByRole("checkbox", { name: "Bench Press" });
    expect(row).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByLabelText("Drag Bench Press")).toBeNull();
    expect(screen.queryByLabelText("Remove Bench Press")).toBeNull();
    expect(screen.queryByLabelText("Expand sets")).toBeNull();
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<Wrapper exercise={makeExercise()} pick={{ picked: true, onToggle }} />);
    expect(screen.getByRole("checkbox", { name: "Bench Press" })).toHaveAttribute("aria-checked", "true");
    // The number gives way to a tick.
    expect(screen.queryByText("1")).toBeNull();
  });

  it("RPE takes one value or a range, clamped to 1–10, and a load range writes both ends", async () => {
    const user = userEvent.setup();
    const exercise = makeExercise({
      setSpecs: [
        { set_number: 1, set_type: "working", reps_min: 8, reps_max: 10, load_type: "absolute", load_min: 100, load_max: 100, rpe_min: 8, rpe_max: 8 },
      ],
      sets: 1,
    });
    render(<Wrapper exercise={exercise} defaultExpanded />);

    const rpe = screen.getByLabelText("Set 1 RPE");
    expect(rpe).toHaveValue("8");
    await user.clear(rpe);
    await user.type(rpe, "7-8");
    await user.tab();
    expect(rpe).toHaveValue("7-8");

    // A typed 0 becomes 1: RPE is 1–10 everywhere.
    await user.clear(rpe);
    await user.type(rpe, "0");
    await user.tab();
    expect(rpe).toHaveValue("1");

    // Junk reverts to what was there rather than blanking the prescription.
    await user.clear(rpe);
    await user.type(rpe, "hard");
    await user.tab();
    expect(rpe).toHaveValue("1");

    const load = screen.getByLabelText("Set 1 load");
    expect(load).toHaveValue("100");
    await user.clear(load);
    await user.type(load, "100-105");
    await user.tab();
    expect(load).toHaveValue("100-105");
  });

  it("draws a drop line only when told where one goes", () => {
    render(<Wrapper exercise={makeExercise()} />);
    expect(screen.queryByTestId("drop-line")).toBeNull();
    cleanup();
    render(<Wrapper exercise={makeExercise()} dropLine="item-bottom" />);
    expect(screen.getByTestId("drop-line")).toBeInTheDocument();
  });

  it("keeps Video & note open through collapsing and re-expanding", () => {
    render(<Wrapper exercise={makeExercise()} defaultExpanded />);
    fireEvent.click(screen.getByRole("button", { name: /Video & note/ }));
    expect(screen.getByText("Video URL")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Collapse sets"));
    fireEvent.click(screen.getByLabelText("Expand sets"));
    expect(screen.getByText("Video URL")).toBeInTheDocument();
  });
});
