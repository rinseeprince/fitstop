import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { SessionEditorBody } from "./session-editor-body";
import { useProgramBuilderState } from "./use-program-builder-state";
import { useSetSpecMutations } from "./use-set-spec-mutations";
import { makeStandaloneDraft } from "@/components/programs/use-standalone-session-editor";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";
import type { ExerciseDraft, ExerciseGroupDraft, SessionDraft } from "./program-builder-types";

// The picker stub hands back one catalog pick, or a name the catalog doesn't
// have, so the add path from the popover down is the real one.
vi.mock("./exercise-picker", () => ({
  ExercisePicker: ({
    onPick,
    onCreate,
  }: {
    onPick: (pick: { name: string; exerciseId: string; exerciseType: "strength" }) => void;
    onCreate: (name: string) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() => onPick({ name: "Bench Press", exerciseId: "e-bench", exerciseType: "strength" })}
      >
        Pick Bench Press
      </button>
      <button type="button" onClick={() => onCreate("Zone 2 Run")}>
        Use Zone 2 Run
      </button>
    </>
  ),
}));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// The settings popover's Format is a Radix Select, which reaches for pointer
// capture and scrollIntoView; jsdom has neither.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const exercise = (uid: string, name: string, sets = 3): ExerciseDraft => ({
  uid,
  exerciseId: null,
  name,
  setSpecs: null,
  sets,
  repsMin: 10,
  repsMax: 10,
  repsTarget: null,
  rpeTarget: null,
  percentage1rm: null,
  tempo: null,
  restSeconds: null,
  isWarmup: false,
  notes: null,
  videoUrl: null,
  prescribedFields: ["set_type", "reps", "load", "rpe", "rest"],
});

const lone = (ex: ExerciseDraft): ExerciseGroupDraft => ({ uid: `grp-${ex.uid}`, ...STRAIGHT_SETS, exercises: [ex] });

const SQUAT = exercise("ex-squat", "Back Squat");
const BENCH = exercise("ex-bench", "Bench Press");
const ROW = exercise("ex-row", "Pendlay Row");
const CRUNCH = exercise("ex-crunch", "Cable Crunch", 2);

const superset = (): ExerciseGroupDraft => ({
  uid: "grp-ss",
  ...STRAIGHT_SETS,
  format: "circuit",
  rounds: 3,
  restBetweenExercisesSeconds: 30,
  restBetweenRoundsSeconds: 90,
  notes: "Pair these back to back.",
  exercises: [BENCH, ROW],
});

const session = (groups: ExerciseGroupDraft[]): SessionDraft => ({
  uid: "sess-1",
  name: "Full body A",
  focus: null,
  estimatedDurationMinutes: null,
  calorieSurplusPercentage: null,
  notes: null,
  sessionType: "training",
  groups,
});

// The real draft pipeline behind the editor, as the standalone editor and the
// tray host it: every click edits the draft and the list reads it back.
function Host({ groups, mode = "edit" }: { groups: ExerciseGroupDraft[]; mode?: "view" | "edit" }) {
  const builder = useProgramBuilderState();
  const editSetSpec = useSetSpecMutations(builder.updateExercise);
  const { seed } = builder;
  // Seeded once, as the hosts do.
  const [initial] = useState(() => makeStandaloneDraft(session(groups)));
  useEffect(() => seed(initial), [seed, initial]);
  const current = builder.draft?.weeks[0].days[0].sessions[0];
  if (!current) return null;
  return (
    <SessionEditorBody
      session={current}
      mode={mode}
      defaultSurplusPercentage={null}
      onUpdateSession={builder.updateSession}
      onAddExercise={builder.addExercise}
      onRemoveExercise={builder.removeExercise}
      onEditExercise={builder.updateExercise}
      onLinkExercises={builder.linkExercises}
      onUnlinkGroup={builder.unlinkGroup}
      onMoveExercise={builder.moveExercise}
      onMoveGroup={builder.moveGroup}
      onUpdateGroup={builder.updateGroup}
      onSpecEdit={editSetSpec}
    />
  );
}

const ordinals = () =>
  screen
    .getAllByRole("button", { name: /^Expand sets$/ })
    .map((button) => button.closest(".group\\/ex")?.querySelector(".rounded-full")?.textContent);

describe("Session editor — groups", () => {
  beforeEach(() => cleanup());

  it("shows a lone exercise as a plain card and a superset under its heading, numbered straight through", () => {
    render(<Host groups={[lone(SQUAT), superset(), lone(CRUNCH)]} />);
    const heading = screen.getByRole("region", { name: "Superset · 3 rounds" });
    expect(heading).toHaveTextContent("30s rest between exercises");
    expect(heading).toHaveTextContent("1m 30s rest between rounds");
    expect(heading).toHaveTextContent("Pair these back to back.");
    expect(within(heading).getByText("Bench Press")).toBeInTheDocument();
    expect(within(heading).getByText("Pendlay Row")).toBeInTheDocument();
    expect(within(heading).queryByText("Back Squat")).toBeNull();
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(ordinals()).toEqual(["1", "2", "3", "4"]);
    // A superset exercise reads its reps round by round; a lone one its sets.
    expect(within(heading).getAllByText("10 reps")).toHaveLength(2);
    expect(screen.getByText("2×10")).toBeInTheDocument();
  });

  it("links picked exercises into a superset where the first of them was", () => {
    render(<Host groups={[lone(SQUAT), lone(BENCH), lone(ROW), lone(CRUNCH)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Link exercises" }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    const make = screen.getByRole("button", { name: "Superset" });
    expect(make).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Cable Crunch" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bench Press" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Bench Press" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Superset" }));

    const group = screen.getByRole("region", { name: "Superset · 3 rounds" });
    expect(within(group).getByText("Bench Press")).toBeInTheDocument();
    expect(within(group).getByText("Cable Crunch")).toBeInTheDocument();
    // Picking has ended; the rail counts exercises again.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/selected$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Link exercises" })).toBeInTheDocument();
    // Crunch had 2 sets and took the superset's 3 rounds.
    expect(within(group).getAllByText("10 reps")).toHaveLength(2);
    const cards = screen.getAllByRole("button", { name: /^Expand sets$/ });
    expect(cards).toHaveLength(4);
  });

  it("names three or more picks a circuit, and Cancel changes nothing", () => {
    render(<Host groups={[lone(SQUAT), lone(BENCH), lone(ROW)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Link exercises" }));
    for (const name of ["Back Squat", "Bench Press", "Pendlay Row"]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }
    expect(screen.getByRole("button", { name: "Circuit" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("links one exercise as a timed group — an AMRAP of one, under its heading with a 10-minute cap — and nothing with none", () => {
    render(<Host groups={[lone(SQUAT), lone(CRUNCH)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Link exercises" }));
    // The timed formats take one pick; a superset still needs two.
    for (const name of ["AMRAP", "EMOM", "For time"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("checkbox", { name: "Back Squat" }));
    expect(screen.getByRole("button", { name: "Superset" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AMRAP" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "AMRAP" }));

    const group = screen.getByRole("region", { name: "AMRAP · 10m" });
    expect(within(group).getByText("Back Squat")).toBeInTheDocument();
    // Its one row is the work of a round.
    expect(within(group).getByText("10 reps")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(ordinals()).toEqual(["1", "2"]);
    expect(screen.getByRole("button", { name: "AMRAP settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlink amrap" })).toBeInTheDocument();

    cleanup();
    render(<Host groups={[]} />);
    expect(screen.getByRole("button", { name: "Link exercises" })).toBeDisabled();
  });

  it("an EMOM of one takes the rounds of its sets at every minute, and Unlink makes it plain again", () => {
    render(<Host groups={[lone(SQUAT)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Link exercises" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Back Squat" }));
    fireEvent.click(screen.getByRole("button", { name: "EMOM" }));
    expect(screen.getByRole("region", { name: "EMOM · 3 rounds · every 1m" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlink emom" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByText("3×10")).toBeInTheDocument();
  });

  it("unlinks a superset into plain exercises in the same place", () => {
    render(<Host groups={[lone(SQUAT), superset(), lone(CRUNCH)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Unlink superset" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(ordinals()).toEqual(["1", "2", "3", "4"]);
    expect(screen.getAllByText("3×10")).toHaveLength(3);
  });

  it("removing one of a superset's two exercises leaves a plain exercise", () => {
    render(<Host groups={[superset()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Pendlay Row" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });

  it("changes rounds, rests and format from the settings, and every exercise's rows follow the rounds", async () => {
    const user = userEvent.setup();
    render(<Host groups={[superset()]} />);
    await user.click(screen.getByRole("button", { name: "Superset settings" }));

    const rounds = screen.getByRole("spinbutton", { name: "Rounds" });
    expect(rounds).toHaveValue(3);
    fireEvent.change(rounds, { target: { value: "4" } });
    fireEvent.blur(rounds);
    expect(screen.getByRole("region", { name: "Superset · 4 rounds" })).toBeInTheDocument();

    const rest = screen.getByRole("spinbutton", { name: "Rest between exercises in seconds" });
    fireEvent.change(rest, { target: { value: "0" } });
    fireEvent.blur(rest);
    expect(screen.getByRole("region", { name: "Superset · 4 rounds" })).toHaveTextContent(
      "No rest between exercises",
    );

    // The superset's first card, opened: four rounds.
    fireEvent.click(screen.getAllByRole("button", { name: "Expand sets" })[0]);
    expect(screen.getByText("Round")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 4 reps")).toBeInTheDocument();
    expect(screen.queryByLabelText("Set 5 reps")).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "Format" }));
    await user.click(screen.getByRole("option", { name: "Straight sets" }));
    const straight = screen.getByRole("region", { name: "Straight sets" });
    expect(straight).not.toHaveTextContent("between rounds");
    expect(screen.queryByRole("spinbutton", { name: "Rounds" })).toBeNull();
    // Straight sets: the rows are sets again.
    expect(screen.getByText("#")).toBeInTheDocument();
  });

  it("switching the format to AMRAP swaps the settings to its cap, fits every row and reads the cap as typed", async () => {
    const user = userEvent.setup();
    render(<Host groups={[superset()]} />);
    await user.click(screen.getByRole("button", { name: "Superset settings" }));
    await user.click(screen.getByRole("combobox", { name: "Format" }));
    await user.click(screen.getByRole("option", { name: "AMRAP" }));

    // One edit: the heading, the rows and the popover's fields change together.
    expect(screen.getByRole("region", { name: "AMRAP · 10m" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Rounds" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "Rest between exercises in seconds" })).toBeNull();
    const cap = screen.getByRole("textbox", { name: "Time cap in minutes and seconds" });
    expect(cap).toHaveValue("10:00");

    // Typed as minutes, read back as m:ss, and the heading follows.
    fireEvent.change(cap, { target: { value: "12" } });
    fireEvent.blur(cap);
    expect(screen.getByRole("region", { name: "AMRAP · 12m" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Time cap in minutes and seconds" })).toHaveValue("12:00");
    // An AMRAP's cap is what it is: an emptied box is put back.
    const capAgain = screen.getByRole("textbox", { name: "Time cap in minutes and seconds" });
    fireEvent.change(capAgain, { target: { value: "" } });
    fireEvent.blur(capAgain);
    expect(screen.getByRole("textbox", { name: "Time cap in minutes and seconds" })).toHaveValue("12:00");
    // A typo is reverted, without a refusal.
    fireEvent.change(capAgain, { target: { value: "soon" } });
    fireEvent.blur(capAgain);
    expect(screen.getByRole("textbox", { name: "Time cap in minutes and seconds" })).toHaveValue("12:00");

    // Every exercise has one row, the work of a round.
    fireEvent.click(screen.getAllByRole("button", { name: "Expand sets" })[0]);
    expect(screen.getByText("Round")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 1 reps")).toBeInTheDocument();
    expect(screen.queryByLabelText("Set 2 reps")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add set/ })).toBeNull();
  });

  it("the settings card stays open while focus moves inside it after a commit, and closes on a click outside", async () => {
    const user = userEvent.setup();
    render(<Host groups={[superset()]} />);
    await user.click(screen.getByRole("button", { name: "Superset settings" }));

    // Typing rounds and clicking the next box commits the rounds — the box
    // remounts and the grid behind re-lays — and the card stays.
    const rounds = screen.getByRole("spinbutton", { name: "Rounds" });
    await user.click(rounds);
    await user.clear(rounds);
    await user.type(rounds, "4");
    await user.click(screen.getByRole("spinbutton", { name: "Rest between exercises in seconds" }));
    expect(screen.getByRole("region", { name: "Superset · 4 rounds" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Rounds" })).toHaveValue(4);
    expect(screen.getByRole("spinbutton", { name: "Rest between exercises in seconds" })).toHaveFocus();

    // Notes commit the same way, and the card is still there.
    const notes = screen.getByRole("textbox", { name: "Notes" });
    await user.click(notes);
    await user.type(notes, " Fast.");
    await user.click(screen.getByRole("spinbutton", { name: "Rounds" }));
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("Pair these back to back. Fast.");

    // A click outside the card closes it.
    await user.click(document.body);
    expect(screen.queryByRole("spinbutton", { name: "Rounds" })).toBeNull();
    expect(screen.getByRole("region", { name: "Superset · 4 rounds" })).toHaveTextContent("Fast.");
  });

  it("switching to EMOM offers its interval and rounds, typed as m:ss", async () => {
    const user = userEvent.setup();
    render(<Host groups={[superset()]} />);
    await user.click(screen.getByRole("button", { name: "Superset settings" }));
    await user.click(screen.getByRole("combobox", { name: "Format" }));
    await user.click(screen.getByRole("option", { name: "EMOM" }));
    expect(screen.getByRole("region", { name: "EMOM · 3 rounds · every 1m" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Rounds" })).toHaveValue(3);
    expect(screen.queryByRole("spinbutton", { name: /Rest between/ })).toBeNull();
    const interval = screen.getByRole("textbox", { name: "Interval in minutes and seconds" });
    expect(interval).toHaveValue("1:00");
    fireEvent.change(interval, { target: { value: "1:30" } });
    fireEvent.blur(interval);
    expect(screen.getByRole("region", { name: "EMOM · 3 rounds · every 1m 30s" })).toBeInTheDocument();
  });

  it("a blank rounds entry puts back the rounds the draft holds, without a refusal", () => {
    vi.mocked(toast.error).mockClear();
    render(<Host groups={[superset()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Superset settings" }));
    const rounds = screen.getByRole("spinbutton", { name: "Rounds" });
    fireEvent.change(rounds, { target: { value: "" } });
    fireEvent.blur(rounds);
    expect(screen.getByRole("spinbutton", { name: "Rounds" })).toHaveValue(3);
    expect(screen.getByRole("region", { name: "Superset · 3 rounds" })).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a refused rounds change toasts why and leaves the rounds as they were", () => {
    vi.mocked(toast.error).mockClear();
    const warmupsFirst: ExerciseDraft = {
      ...BENCH,
      setSpecs: [
        { set_number: 1, set_type: "warmup" },
        { set_number: 2, set_type: "working" },
        { set_number: 3, set_type: "working" },
      ],
    };
    render(<Host groups={[{ ...superset(), exercises: [warmupsFirst, ROW] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Superset settings" }));
    const rounds = screen.getByRole("spinbutton", { name: "Rounds" });
    fireEvent.change(rounds, { target: { value: "1" } });
    fireEvent.blur(rounds);
    expect(toast.error).toHaveBeenCalledWith("Bench Press: At least one working set is required");
    expect(screen.getByRole("spinbutton", { name: "Rounds" })).toHaveValue(3);
    expect(screen.getByRole("region", { name: "Superset · 3 rounds" })).toBeInTheDocument();
  });

  it("view mode shows the heading with no link, settings, unlink or grips", () => {
    render(<Host groups={[lone(SQUAT), superset()]} mode="view" />);
    expect(screen.getByRole("region", { name: "Superset · 3 rounds" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link exercises" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Superset settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlink superset" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Drag / })).toBeNull();
  });
});

describe("Session editor — dragging", () => {
  // jsdom lays nothing out, so each exercise card stands 100px below the last
  // and 90px tall, in document order, for the pointer to land on.
  beforeEach(() => {
    cleanup();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const index = [...document.querySelectorAll(".group\\/ex")].indexOf(this);
      const top = Math.max(index, 0) * 100;
      const height = index === -1 ? 0 : 90;
      return { x: 0, y: top, left: 0, top, width: 500, height, right: 500, bottom: top + height, toJSON: () => ({}) };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const grip = (name: string) => screen.getByRole("button", { name: `Drag ${name}` });
  const dragOrder = () =>
    screen.getAllByRole("button", { name: /^Drag / }).map((button) => button.getAttribute("aria-label"));
  // Past the 4px it takes to start a drag.
  const pickUp = (button: HTMLElement, y: number) => {
    fireEvent.pointerDown(button, { button: 0, isPrimary: true, clientX: 10, clientY: y });
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 10, clientY: y + 10 });
  };
  /** What follows the pointer: portaled to <body>, outside the editor. */
  const dragCopy = (container: HTMLElement) =>
    [...document.body.children].find(
      (node) => node !== container && node.textContent !== "" && !node.id.startsWith("DndDescribedBy"),
    ) as HTMLElement | undefined;

  it("keeps a dragged exercise in its place, dimmed, while a copy of its top line follows the pointer", () => {
    const { container } = render(<Host groups={[lone(SQUAT), lone(BENCH), lone(CRUNCH)]} />);
    const card = grip("Bench Press").closest<HTMLElement>(".group\\/ex")!;
    pickUp(grip("Bench Press"), 140);
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 10, clientY: 260 });

    expect(card.style.transform).toBe("");
    expect(card).toHaveClass("opacity-40");
    expect(dragCopy(container)?.textContent).toBe("Bench Press3×10");
    expect(dragOrder()).toEqual(["Drag Back Squat", "Drag Bench Press", "Drag Cable Crunch"]);
  });

  it("dropping moves the exercise and puts the copy away in the same update", () => {
    const { container } = render(<Host groups={[lone(SQUAT), lone(BENCH), lone(CRUNCH)]} />);
    pickUp(grip("Back Squat"), 40);
    // The lower half of Cable Crunch: after it.
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 10, clientY: 260 });
    expect(dragCopy(container)?.textContent).toBe("Back Squat3×10");

    fireEvent.pointerUp(document, { isPrimary: true, clientX: 10, clientY: 260 });
    expect(dragCopy(container)).toBeUndefined();
    expect(dragOrder()).toEqual(["Drag Bench Press", "Drag Cable Crunch", "Drag Back Squat"]);
  });

  it("Escape puts the copy away and moves nothing", () => {
    const { container } = render(<Host groups={[lone(SQUAT), lone(BENCH), lone(CRUNCH)]} />);
    pickUp(grip("Back Squat"), 40);
    fireEvent.pointerMove(document, { isPrimary: true, clientX: 10, clientY: 260 });

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(dragCopy(container)).toBeUndefined();
    expect(grip("Back Squat").closest(".group\\/ex")).not.toHaveClass("opacity-40");
    expect(dragOrder()).toEqual(["Drag Back Squat", "Drag Bench Press", "Drag Cable Crunch"]);
  });

  it("keeps a dragged superset in its place, dimmed, while its heading line follows the pointer", () => {
    const { container } = render(<Host groups={[lone(SQUAT), superset(), lone(CRUNCH)]} />);
    const block = screen.getByRole("region", { name: "Superset · 3 rounds" });
    pickUp(grip("superset"), 140);

    expect(block.style.transform).toBe("");
    expect(block).toHaveClass("opacity-40");
    expect(dragCopy(container)?.textContent).toBe("Superset·3 rounds");
  });
});

describe("Session editor — a column preset for a whole group", () => {
  beforeEach(() => cleanup());

  it("the heading's Columns menu sets every exercise in the superset in one edit", async () => {
    const user = userEvent.setup();
    render(<Host groups={[lone(SQUAT), superset()]} />);
    await user.click(screen.getByRole("button", { name: "Columns for the superset" }));
    // Both exercises start on the strength columns, so Strength is ticked.
    expect(screen.getByRole("menuitemcheckbox", { name: "Strength" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Circuit" }));
    // The cards are collapsed, so the tick moving IS the confirmation.
    expect(screen.getByRole("menuitemcheckbox", { name: "Circuit" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Strength" })).toHaveAttribute("aria-checked", "false");
    await user.keyboard("{Escape}");

    const heading = screen.getByRole("region", { name: "Superset · 3 rounds" });
    for (const name of ["Bench Press", "Pendlay Row"]) {
      const card = within(heading).getByText(name).closest<HTMLElement>(".group\\/ex")!;
      fireEvent.click(within(card).getByRole("button", { name: "Expand sets" }));
      const header = within(card).getByText("Round").parentElement!;
      expect([...header.querySelectorAll("span")].map((span) => span.textContent)).toEqual([
        "Round", "Reps", "Load", "",
      ]);
    }
    // The lone exercise outside the group is untouched.
    const squat = screen.getByText("Back Squat").closest<HTMLElement>(".group\\/ex")!;
    fireEvent.click(within(squat).getByRole("button", { name: "Expand sets" }));
    expect(within(squat).getByText("RPE")).toBeInTheDocument();
  });
});

describe("Session editor — adding an exercise from the popover", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(toast.success).mockClear();
  });

  it("a pick adds the card, toasts the exercise's name, and keeps the popover open for the next pick", async () => {
    render(<Host groups={[lone(SQUAT)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pick Bench Press" }));

    expect(toast.success).toHaveBeenCalledWith("Exercise added", { description: "Bench Press" });
    // The new card opens expanded, so it reads Collapse where the others read Expand.
    expect(screen.getAllByRole("button", { name: /^(Expand|Collapse) sets$/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Collapse sets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick Bench Press" })).toBeInTheDocument();
  });

  // A name the catalog doesn't have ("Use …") opens New exercise on it: the
  // popover closes and the form opens in one click, and the exercise the form
  // creates joins the session like any pick, on its type's columns.
  it("Use … opens New exercise on the typed name, and the exercise it creates is added to the session", async () => {
    const created = {
      id: "ex-zone2",
      coachId: "coach-1",
      name: "Zone 2 Run",
      muscleGroup: null,
      equipment: null,
      category: null,
      exerciseType: "endurance",
      aliases: [],
      createdAt: "2026-09-22T00:00:00Z",
      updatedAt: "2026-09-22T00:00:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ success: true, exercise: created }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<Host groups={[lone(SQUAT)]} />);
      fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
      fireEvent.click(await screen.findByRole("button", { name: "Use Zone 2 Run" }));

      // One commit: the popover is gone and the form is open on the name.
      expect(screen.queryByRole("button", { name: "Pick Bench Press" })).toBeNull();
      const form = screen.getByRole("dialog", { name: "New exercise" });
      expect(within(form).getByLabelText("Name")).toHaveValue("Zone 2 Run");

      fireEvent.click(within(form).getByRole("button", { name: "Create exercise" }));
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Exercise added", { description: "Zone 2 Run" }),
      );
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/training/exercises");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toMatchObject({ name: "Zone 2 Run" });

      // The form closed; the one confirmation is the add, and the new card
      // opens on the endurance columns its type starts on.
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "New exercise" })).toBeNull());
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Zone 2 Run")).toBeInTheDocument();
      expect(screen.getByText("Distance")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closing New exercise without creating adds nothing", async () => {
    render(<Host groups={[lone(SQUAT)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add exercise" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Zone 2 Run" }));

    const form = screen.getByRole("dialog", { name: "New exercise" });
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New exercise" })).toBeNull());
    expect(screen.queryByText("Zone 2 Run")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^(Expand|Collapse) sets$/ })).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
