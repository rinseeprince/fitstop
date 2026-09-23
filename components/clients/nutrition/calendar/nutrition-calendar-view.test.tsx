import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NutritionEvent } from "@/types/check-in";
import type { ResolvedSelectedDay, RangeEditPayload } from "@/utils/nutrition-range-edit-model";
import { NutritionCalendarView } from "./nutrition-calendar-view";

// The Edit-targets dialog's shape (CONVENTIONS §7 → "No frame disagrees", rule
// 5). Radix re-renders a closing card from live props through its exit
// animation, which jsdom never plays, so the fading frame is asserted as the
// props the card receives: its days are a subject the opening click sets, a
// close — Cancel, or a successful apply that also clears the selection and
// refetches the events — leaves them, and the next open replaces them.

const mocks = vi.hoisted(() => ({
  /** One "open|days" entry per render of the stubbed dialog. */
  frames: [] as string[],
  events: new Map<string, unknown>(),
  invalidate: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({
  useNutritionCalendarEvents: () => ({ eventsByDate: mocks.events, isLoading: false }),
  useInvalidateNutritionCalendar: () => mocks.invalidate,
}));
vi.mock("@/hooks/use-client-overview", () => ({ useClearClientOverview: () => vi.fn() }));
vi.mock("@/hooks/use-attention-feed", () => ({ useClearAttentionFeed: () => vi.fn() }));
vi.mock("./nutrition-calendar-toolbar", () => ({ NutritionCalendarToolbar: () => null }));
// The row is under its own tests: here it is a toggle per day, carrying the
// calories the grid was last rendered with, and the rail's "Edit this week".
vi.mock("./nutrition-calendar-week-row", () => ({
  NutritionCalendarWeekRow: ({
    days,
    eventsByDate,
    onToggle,
    onWeekAction,
  }: {
    days: string[];
    eventsByDate: Map<string, NutritionEvent>;
    onToggle?: (date: string) => void;
    onWeekAction: (dates: string[], action: "edit_week" | "reset_week") => void;
  }) => (
    <div>
      {days.map((d) => (
        <button key={d} data-kcal={eventsByDate.get(d)?.baselineCalories} onClick={() => onToggle?.(d)}>
          {`Toggle ${d}`}
        </button>
      ))}
      <button onClick={() => onWeekAction(days, "edit_week")}>
        {`Edit week of ${days[0]}`}
      </button>
    </div>
  ),
}));
vi.mock("./nutrition-selection-bar", () => ({
  NutritionSelectionBar: ({ count, onEditTargets }: { count: number; onEditTargets: () => void }) => (
    <button data-count={count} onClick={onEditTargets}>
      Edit targets
    </button>
  ),
}));
vi.mock("./nutrition-edit-targets-dialog", () => ({
  NutritionEditTargetsDialog: ({
    open,
    days,
    onOpenChange,
    onApply,
  }: {
    open: boolean;
    days: ResolvedSelectedDay[];
    onOpenChange: (open: boolean) => void;
    onApply: (payload: RangeEditPayload) => void;
  }) => {
    const dates = days.map((d) => d.date).join(",");
    mocks.frames.push(`${open}|${dates}`);
    return (
      <div
        data-testid="editor"
        data-open={String(open)}
        data-days={dates}
        // The values the card's range line and seed read.
        data-kcal={days.map((d) => d.target.calories).join(",")}
      >
        <button onClick={() => onOpenChange(false)}>Cancel</button>
        <button onClick={() => onApply({ mode: "absolute", calories: 1800, proteinG: 150, carbG: 180, fatG: 52 })}>
          Apply
        </button>
      </div>
    );
  },
}));

function ev(date: string, overrides: Partial<NutritionEvent> = {}): NutritionEvent {
  return {
    id: date,
    clientId: "c1",
    nutritionPlanId: "np-1",
    date,
    dayOfWeek: "monday",
    baselineCalories: 2000,
    trainingBurnCalories: 0,
    proteinG: 150,
    carbG: 200,
    fatG: 60,
    dietType: "balanced",
    isTrainingDay: false,
    calorieSurplusPercentage: null,
    includeActivityBurn: true,
    surplusAsCarbs: false,
    isModified: false,
    note: null,
    coachNote: null,
    status: "scheduled",
    ...overrides,
  };
}

// June 2026: the grid opens on Mon 1 June.
const DATES = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-08", "2026-06-09", "2026-06-10"];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
  mocks.frames.length = 0;
  mocks.events = new Map(DATES.map((d) => [d, ev(d)]));
  mocks.invalidate.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ updated: 2 }) }))
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const view = () => (
  <NutritionCalendarView clientId="c1" onUpdate={vi.fn()} />
);
const renderView = () => render(view());

const editor = () => screen.getByTestId("editor");
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const gridDay = (date: string) => screen.getByRole("button", { name: `Toggle ${date}` });

/** Every dialog frame rendered since `mark`, so a click's frames can be held
 * to its settled one. */
const framesSince = (mark: number) => mocks.frames.slice(mark);

describe("NutritionCalendarView — the Edit-targets dialog's days are its own subject", () => {
  it("a successful apply clears the selection, refetches and closes the dialog, and every closing frame keeps the days it opened on", async () => {
    mocks.events.set("2026-06-02", ev("2026-06-02", { baselineCalories: 2200 }));
    // The refetch after the write: both days now read the applied target.
    mocks.invalidate.mockImplementationOnce(() => {
      mocks.events = new Map(mocks.events)
        .set("2026-06-01", ev("2026-06-01", { baselineCalories: 1800, isModified: true }))
        .set("2026-06-02", ev("2026-06-02", { baselineCalories: 1800, isModified: true }));
      return Promise.resolve();
    });
    renderView();
    click("Toggle 2026-06-01");
    click("Toggle 2026-06-02");

    const opening = mocks.frames.length;
    click("Edit targets");
    expect(editor()).toHaveAttribute("data-open", "true");
    expect(editor()).toHaveAttribute("data-days", "2026-06-01,2026-06-02");
    expect(editor()).toHaveAttribute("data-kcal", "2000,2200");
    // One click, one commit: no frame opens on the previous subject.
    expect(framesSince(opening)).toEqual(["true|2026-06-01,2026-06-02"]);

    const applying = mocks.frames.length;
    click("Apply");
    // Settled: the write ran and its refetch reached the grid.
    await waitFor(() => expect(gridDay("2026-06-02")).toHaveAttribute("data-kcal", "1800"));
    expect(editor()).toHaveAttribute("data-open", "false");
    // The apply wrote the days the dialog showed, and cleared the selection.
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string).dates).toEqual([
      "2026-06-01",
      "2026-06-02",
    ]);
    expect(screen.getByRole("button", { name: "Edit targets" })).toHaveAttribute("data-count", "0");
    // Neither the cleared selection nor the refetch reached the dialog: open
    // or closing, it reads the two days, at the values it opened on.
    expect(framesSince(applying).every((f) => f.endsWith("|2026-06-01,2026-06-02"))).toBe(true);
    expect(framesSince(applying)).toContain("false|2026-06-01,2026-06-02");
    expect(editor()).toHaveAttribute("data-kcal", "2000,2200");
  });

  it("Cancel flips open and leaves the days; the selection moving afterwards does not reach the dialog; the next open replaces them", () => {
    renderView();
    click("Toggle 2026-06-01");
    click("Edit targets");
    expect(editor()).toHaveAttribute("data-days", "2026-06-01");

    click("Cancel");
    expect(editor()).toHaveAttribute("data-open", "false");
    expect(editor()).toHaveAttribute("data-days", "2026-06-01");

    click("Toggle 2026-06-03");
    expect(editor()).toHaveAttribute("data-days", "2026-06-01");

    const reopening = mocks.frames.length;
    click("Edit targets");
    expect(editor()).toHaveAttribute("data-open", "true");
    expect(editor()).toHaveAttribute("data-days", "2026-06-01,2026-06-03");
    expect(framesSince(reopening)).toEqual(["true|2026-06-01,2026-06-03"]);
  });

  it("the body renders the subject the open set, not the live selection: a refetch while the dialog is open does not reach its days", () => {
    const { rerender } = renderView();
    click("Toggle 2026-06-01");
    click("Toggle 2026-06-02");
    click("Edit targets");
    expect(editor()).toHaveAttribute("data-kcal", "2000,2000");

    // A revalidation lands mid-edit and moves one selected day's calories.
    mocks.events = new Map(mocks.events).set("2026-06-02", ev("2026-06-02", { baselineCalories: 2400 }));
    rerender(view());
    expect(gridDay("2026-06-02")).toHaveAttribute("data-kcal", "2400");
    expect(editor()).toHaveAttribute("data-open", "true");
    expect(editor()).toHaveAttribute("data-kcal", "2000,2000");
  });

  it("an Apply writes the days the dialog shows, even after a refetch moved the selection's resolution", async () => {
    const { rerender } = renderView();
    click("Toggle 2026-06-01");
    click("Toggle 2026-06-02");
    click("Edit targets");
    expect(editor()).toHaveAttribute("data-days", "2026-06-01,2026-06-02");

    // A revalidation lands mid-edit and no longer resolves one selected day.
    const refetched = new Map(mocks.events);
    refetched.delete("2026-06-02");
    mocks.events = refetched;
    rerender(view());
    expect(editor()).toHaveAttribute("data-days", "2026-06-01,2026-06-02");

    click("Apply");
    await waitFor(() => expect(editor()).toHaveAttribute("data-open", "false"));
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string).dates).toEqual([
      "2026-06-01",
      "2026-06-02",
    ]);
  });

  it("the week rail's Edit this week opens the dialog on that week's days in the same commit, and its Cancel leaves them", () => {
    renderView();
    click("Toggle 2026-06-01");
    click("Edit targets");
    click("Cancel");

    const opening = mocks.frames.length;
    click("Edit week of 2026-06-08");
    expect(editor()).toHaveAttribute("data-open", "true");
    expect(editor()).toHaveAttribute("data-days", "2026-06-08,2026-06-09,2026-06-10");
    expect(framesSince(opening)).toEqual(["true|2026-06-08,2026-06-09,2026-06-10"]);

    click("Cancel");
    expect(editor()).toHaveAttribute("data-open", "false");
    expect(editor()).toHaveAttribute("data-days", "2026-06-08,2026-06-09,2026-06-10");
  });
});
