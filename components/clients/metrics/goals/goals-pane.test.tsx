import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { GoalsPane } from "./goals-pane";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";
import { swrFetcher } from "@/lib/swr-fetcher";
import { toast } from "sonner";
import type { GoalHistoryRow } from "@/types/client-goals";

// Real SWR over a mocked fetcher: what the pane shows from its three reads, and
// what a delete does to the table on screen — SWR's own behaviour, which a
// mocked hook cannot show.

vi.mock("@/lib/swr-fetcher", () => ({ swrFetcher: vi.fn() }));
// units-context imports auth-context, which constructs the browser Supabase
// client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const CLIENT_ID = "client-4";
const HISTORY_KEY = `/api/clients/${CLIENT_ID}/goals/history`;

const base = {
  clientId: CLIENT_ID,
  targetBodyFatPercentage: null,
  description: null,
  source: "coach" as const,
  setBy: null,
  createdAt: "2026-05-04T08:00:00Z",
  updatedAt: "2026-05-04T08:00:00Z",
};

const LEAN_OUT: GoalHistoryRow = {
  ...base,
  id: "goal-lean",
  name: "Lean out",
  type: "lose_weight",
  targetWeight: 81.5,
  startsOn: "2026-10-19",
  deadline: "2026-12-11",
  endsOn: null,
  status: "planned",
  lines: [],
};
const BUILD: GoalHistoryRow = {
  ...base,
  id: "goal-build",
  name: "Build",
  type: "build_muscle",
  targetWeight: 84.6,
  startsOn: "2026-06-29",
  deadline: "2026-10-09",
  endsOn: "2026-10-18",
  status: "current",
  lines: [],
};
const CUT: GoalHistoryRow = {
  ...base,
  id: "goal-cut",
  name: "Cut",
  type: "lose_weight",
  targetWeight: 79.4,
  startsOn: "2026-05-04",
  deadline: "2026-06-26",
  endsOn: "2026-06-28",
  status: "ended",
  lines: [
    {
      kind: "nutrition",
      on: "2026-04-20",
      until: "2026-05-31",
      calories: 2380,
      builtFor: { goalWeightKg: 79.4, deadline: "2026-06-26" },
    },
    { kind: "program", on: "2026-05-18", change: "replaces", name: "Strength", replaced: "Base" },
  ],
};

const point = (date: string, value: number, id: string) => ({
  date,
  value,
  source: "coach_entry" as const,
  note: null,
  id,
  recordedAt: `${date}T08:00:00Z`,
});
const SERIES = {
  weight: [
    point("2026-04-30", 83.2, "m-1"),
    point("2026-06-10", 79.3, "m-2"),
    point("2026-06-25", 80.3, "m-3"),
    point("2026-09-20", 83.7, "m-4"),
  ],
  bodyFat: [],
  waist: [],
  hips: [],
  chest: [],
  arms: [],
  thighs: [],
  baseline: {},
  startDate: "2026-04-01",
  readings: [],
};
const OVERVIEW = {
  current: { ...BUILD, startReadings: { weight: 80.1, bodyFat: null } },
  planned: [LEAN_OUT],
  clientToday: "2026-09-23",
};

let requested: string[] = [];
let answers: Record<string, () => Promise<unknown>> = {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tree = () => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <GoalsPane clientId={CLIENT_ID} />
  </SWRConfig>
);

/** The table's row for a goal, by its name. */
const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) }).closest("tr")!;

beforeEach(() => {
  // A date in another year carries its year, so today is pinned.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00"));
  requested = [];
  answers = {
    [HISTORY_KEY]: () => Promise.resolve({ success: true, data: [LEAN_OUT, BUILD, CUT] }),
    [`/api/clients/${CLIENT_ID}/goals`]: () => Promise.resolve({ success: true, data: OVERVIEW }),
    [`/api/clients/${CLIENT_ID}/measurement-series`]: () => Promise.resolve({ success: true, data: SERIES }),
  };
  vi.mocked(swrFetcher).mockImplementation((url: string) => {
    requested.push(url);
    return answers[url]() as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GoalsPane — the table", () => {
  it("lists every goal, planned first, with its dates, deadline, targets and result", async () => {
    render(tree());
    await waitFor(() => expect(screen.getByText("Reached 10 June")).toBeInTheDocument());

    const names = screen.getAllByRole("button", { expanded: false }).map((b) => b.textContent);
    // Each name, "Current" on today's goal, and the type where the name does not say it
    expect(names).toEqual(["Lean outLose weight", "BuildCurrentBuild muscle", "CutLose weight"]);

    expect(within(rowOf("Lean out")).getByText("From")).toBeInTheDocument();
    expect(within(rowOf("Lean out")).getByText("19 Oct")).toBeInTheDocument();
    expect(within(rowOf("Lean out")).getByText("Planned")).toBeInTheDocument();
    // Today's goal reads the goal card's chip: from its start reading to the newest
    expect(within(rowOf("Build")).getByText("29 June – 18 Oct")).toBeInTheDocument();
    expect(within(rowOf("Build")).getByText("9 Oct")).toBeInTheDocument();
    expect(within(rowOf("Build")).getByText("84.6 kg")).toBeInTheDocument();
    expect(within(rowOf("Build")).getByText("0.9 kg to go")).toBeInTheDocument();
    // An ended goal: reached, on the first day a reading met it
    expect(within(rowOf("Cut")).getByText("4 May – 28 June")).toBeInTheDocument();
    expect(within(rowOf("Cut")).getByText("Reached 10 June")).toBeInTheDocument();
  });

  it("claims no result until the readings it is worked out from land", async () => {
    const series = deferred<unknown>();
    answers[`/api/clients/${CLIENT_ID}/measurement-series`] = () => series.promise;
    render(tree());
    await waitFor(() => expect(screen.getByText("Cut")).toBeInTheDocument());

    expect(within(rowOf("Lean out")).getByText("Planned")).toBeInTheDocument();
    expect(screen.queryByText("Reached 10 June")).toBeNull();
    expect(screen.queryByText("0.9 kg to go")).toBeNull();
    expect(screen.queryByText("No reading")).toBeNull();

    await act(async () => {
      series.resolve({ success: true, data: SERIES });
      await series.promise;
    });
    await waitFor(() => expect(screen.getByText("Reached 10 June")).toBeInTheDocument());
  });

  it("gives today's goal the card's chip from the goals read's start reading, and waits for it", async () => {
    // Event prep sets no direction: the start reading decides it, so a chip
    // from any other start would read the other way
    const meet = { ...BUILD, id: "goal-meet", name: "Meet", type: "event_prep" as const, targetWeight: 82.0, endsOn: null };
    const goalsRead = deferred<unknown>();
    answers[HISTORY_KEY] = () => Promise.resolve({ success: true, data: [meet] });
    answers[`/api/clients/${CLIENT_ID}/goals`] = () => goalsRead.promise;
    render(tree());
    await waitFor(() => expect(screen.getByText("Meet")).toBeInTheDocument());
    // No goal follows it: it runs on from its start
    expect(within(rowOf("Meet")).getByText("Since")).toBeInTheDocument();
    expect(within(rowOf("Meet")).queryByText(/goal|to go/)).toBeNull();

    await act(async () => {
      goalsRead.resolve({
        success: true,
        data: { current: { ...meet, startReadings: { weight: 85.0, bodyFat: null } }, planned: [], clientToday: "2026-09-23" },
      });
      await goalsRead.promise;
    });
    await waitFor(() => expect(within(rowOf("Meet")).getByText("1.7 kg to go")).toBeInTheDocument());
  });

  it("opens a row onto what happened during the goal, in date order, and closes it again", async () => {
    const user = userEvent.setup();
    render(tree());
    await waitFor(() => expect(screen.getByText("Cut")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^Cut/ }));
    expect(screen.getByRole("button", { name: /^Cut/ })).toHaveAttribute("aria-expanded", "true");
    const lines = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual([
      "20 Apr – 31 MayNutrition2,380 kcal, built for 79.4 kg by 26 June",
      "18 MayProgramStrength replaces Base",
    ]);

    await user.click(screen.getByRole("button", { name: /^Cut/ }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("sets a deadline change's dates in mono and its missing side in sans", async () => {
    const user = userEvent.setup();
    const dated = { ...CUT, lines: [{ kind: "deadline" as const, on: "2026-06-01", from: null, to: "2026-06-26" }] };
    answers[HISTORY_KEY] = () => Promise.resolve({ success: true, data: [dated] });
    render(tree());
    await waitFor(() => expect(screen.getByText("Cut")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^Cut/ }));

    const [line] = screen.getAllByRole("listitem");
    expect(line.textContent).toBe("1 JuneDeadlinenone → 26 June");
    expect(within(line).getByText("none").className).not.toContain(MONO);
    expect(within(line).getByText("26 June").className).toContain(MONO);
  });

  it("says a goal with nothing during it has nothing", async () => {
    const user = userEvent.setup();
    render(tree());
    await waitFor(() => expect(screen.getByText("Build")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^Build/ }));
    expect(screen.getByText("No deadline changes, nutrition or programs.")).toBeInTheDocument();
  });

  it("says so when the client has no goals, and only once the read has landed", async () => {
    const history = deferred<unknown>();
    answers[HISTORY_KEY] = () => history.promise;
    render(tree());
    expect(screen.queryByText("No goals yet")).toBeNull();
    await act(async () => {
      history.resolve({ success: true, data: [] });
      await history.promise;
    });
    await waitFor(() => expect(screen.getByText("No goals yet")).toBeInTheDocument());
  });

  it("says a failed read failed, never that there are no goals, and tries again", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    answers[HISTORY_KEY] = () => Promise.reject(new Error("timeout"));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
        <GoalsPane clientId={CLIENT_ID} />
      </SWRConfig>
    );
    await waitFor(() => expect(screen.getByText("Couldn't load the goals")).toBeInTheDocument());
    expect(screen.queryByText("No goals yet")).toBeNull();

    answers[HISTORY_KEY] = () => Promise.resolve({ success: true, data: [CUT] });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Cut")).toBeInTheDocument());
  });
});

describe("GoalsPane — deleting a goal from its row", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: OVERVIEW }), { status: 200 })
    );
  });

  it("asks with the sheet's confirm: an ended goal by its days, at a click; today's typed", async () => {
    const user = userEvent.setup();
    render(tree());
    await waitFor(() => expect(screen.getByText("Cut")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Delete Cut" }));
    expect(screen.getByRole("heading", { name: "Delete Cut?" })).toBeInTheDocument();
    expect(screen.getByText("Deletes Cut, 4 May – 28 June.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Type DELETE to confirm")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Delete Build" }));
    expect(screen.getByLabelText("Type DELETE to confirm")).toBeInTheDocument();
  });

  it("keeps the confirm open until the table no longer holds the goal, then closes onto it", async () => {
    const user = userEvent.setup();
    render(tree());
    await waitFor(() => expect(screen.getByText("Cut")).toBeInTheDocument());

    const refetch = deferred<unknown>();
    answers[HISTORY_KEY] = () => refetch.promise;
    await user.click(screen.getByRole("button", { name: "Delete Cut" }));
    await user.click(screen.getByRole("button", { name: "Delete goal" }));

    expect(globalThis.fetch).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/goals/goal-cut`, expect.objectContaining({ method: "DELETE" }));
    // The delete has landed and the table is refetching: its rows stay, and
    // the confirm stays open on its spinner
    await waitFor(() => expect(requested.filter((url) => url === HISTORY_KEY)).toHaveLength(2));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Cut/, hidden: true })).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => {
      refetch.resolve({ success: true, data: [LEAN_OUT, BUILD] });
      await refetch.promise;
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: /^Cut/ })).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("Goal deleted");
  });
});
