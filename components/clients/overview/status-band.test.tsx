import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StatusBand } from "./status-band";
import type { Client } from "@/types/check-in";
import type { CurrentGoal, GoalOnDay } from "@/types/client-goals";
import type { MeasurementSeries, MeasurementSeriesPoint } from "@/types/coach-overview";

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

const BASE: Client = {
  id: "client-1",
  coachId: "coach-1",
  name: "Alex Kim",
  email: "alex@example.com",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  timezone: "UTC",
};

/**
 * The goal in force as the goals read returns it: its type, its targets, its
 * deadline, and the client's readings on its start day — what the chips
 * measure from. A reading left out is one the client does not have.
 */
function goalOf(
  overrides: Partial<Omit<CurrentGoal, "startReadings">> & {
    start?: { weight?: number; bodyFat?: number };
  } = {}
): CurrentGoal {
  const { start = {}, ...fields } = overrides;
  return {
    id: "goal-in-force",
    clientId: "client-1",
    name: "Lose weight",
    type: "lose_weight",
    targetWeight: null,
    targetBodyFatPercentage: null,
    description: null,
    startsOn: "2026-06-01",
    source: "coach",
    setBy: "coach-1",
    createdAt: "2026-06-01T08:00:00Z",
    updatedAt: "2026-06-01T08:00:00Z",
    deadline: null,
    ...fields,
    startReadings: { weight: start.weight ?? null, bodyFat: start.bodyFat ?? null },
  };
}

/** A goal planned after today's. */
function plannedOf(name: string, startsOn: string): GoalOnDay {
  const { startReadings: _startReadings, ...goal } = goalOf({ id: `goal-${name}`, name, startsOn });
  return goal;
}

const point = (date: string, value: number): MeasurementSeriesPoint => ({
  date,
  value,
  source: "check_in",
  note: null,
  id: `m-${date}`,
  recordedAt: `${date}T08:00:00+00:00`,
});

/** The client's origin (the start-date reading) and the newest reading. */
type Readings = { baseline?: number; current?: number };

// An older point before every "now", holding a value no figure in this file
// shows: the band takes the NEWEST point, never the first.
const OLDER_POINT = { weight: 108.5, bodyFat: 36.5 } as const;

/**
 * The series payload the band reads "now" and the baseline from. Everything
 * else empty.
 */
function seriesOf(readings: { weight?: Readings; bodyFat?: Readings } = {}): MeasurementSeries {
  const series: MeasurementSeries = {
    weight: [],
    bodyFat: [],
    waist: [],
    hips: [],
    chest: [],
    arms: [],
    thighs: [],
    baseline: {},
    startDate: null,
    readings: [],
  };
  for (const key of ["weight", "bodyFat"] as const) {
    const pair = readings[key];
    if (pair?.baseline != null) {
      series.baseline[key] = { value: pair.baseline, date: "2026-03-01", source: "intake", id: `${key}-0` };
    }
    if (pair?.current != null) {
      series[key] = [point("2026-03-08", OLDER_POINT[key]), point("2026-08-20", pair.current)];
    }
  }
  return series;
}

// The band renders whatever chart it is handed; the chart's own behaviour is
// pinned by progression-chart.test.tsx.
const PROPS = {
  goal: null,
  nextGoal: null,
  onEditGoals: vi.fn(),
  chart: <div data-testid="chart" />,
  onOpenMetrics: vi.fn(),
  series: seriesOf(),
};

beforeEach(() => cleanup());

// The chips measure a goal from the client's reading on its start day, in the
// direction its type decides; "now" is the series' newest point.
describe("StatusBand — goal chips", () => {
  it("gap: reports the distance still to travel", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { current: 89 } })}
        goal={goalOf({ type: "lose_weight", targetWeight: 85, start: { weight: 94 } })}
      />
    );

    expect(screen.getByText("4.0 kg to go")).toBeInTheDocument();
  });

  it("reached: says so once the client lands within the tolerance of the goal", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { current: 83.03 } })}
        goal={goalOf({ type: "lose_weight", targetWeight: 83, start: { weight: 96 } })}
      />
    );

    expect(screen.getByText("Goal reached")).toBeInTheDocument();
  });

  it("a lose-weight goal started above its target reads 'under goal' once below it", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { current: 81.5 } })}
        goal={goalOf({ type: "lose_weight", targetWeight: 84, start: { weight: 97 } })}
      />
    );

    expect(screen.getByText("2.5 kg under goal")).toBeInTheDocument();
  });

  it("a build-muscle goal reads 'over goal' once above its target", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { current: 77.5 } })}
        goal={goalOf({ type: "build_muscle", targetWeight: 74, start: { weight: 68 } })}
      />
    );

    expect(screen.getByText("3.5 kg over goal")).toBeInTheDocument();
  });

  // The type decides the direction where it has one, so a goal whose start
  // day has no reading is still judged past its target.
  it("a lose-weight goal counts weight down with no start reading", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { current: 86.2 } })}
        goal={goalOf({ type: "lose_weight", targetWeight: 87 })}
      />
    );

    expect(screen.getByText("0.8 kg under goal")).toBeInTheDocument();
  });

  it("a recomp goal counts body fat down with no start reading", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ bodyFat: { current: 21.7 } })}
        goal={goalOf({ type: "recomposition", targetBodyFatPercentage: 22.5 })}
      />
    );

    expect(screen.getByText("0.8% under goal")).toBeInTheDocument();
  });

  it("with no direction — a type that decides none, no start reading — reads only to go or reached", () => {
    const goal = goalOf({ type: "general_fitness", name: "General fitness", targetWeight: 78.5 });
    const { rerender } = render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { current: 81 } })}
        goal={goal}
      />
    );
    expect(screen.getByText("2.5 kg to go")).toBeInTheDocument();

    // Below the target is not "under goal": nothing says which way is past it.
    rerender(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { current: 75.5 } })}
        goal={goal}
      />
    );
    expect(screen.getByText("3.0 kg to go")).toBeInTheDocument();

    rerender(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { current: 78.54 } })}
        goal={goal}
      />
    );
    expect(screen.getByText("Goal reached")).toBeInTheDocument();
  });

  it("body fat uses percent rather than the weight unit", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ bodyFat: { current: 20.5 } })}
        goal={goalOf({ type: "lose_weight", targetBodyFatPercentage: 18.5, start: { bodyFat: 25.5 } })}
      />
    );

    expect(screen.getByText("2.0% to go")).toBeInTheDocument();
  });

  it("with no goal in force, the three goal cells read Not set and no chip renders", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { baseline: 95.5, current: 92 } })}
      />
    );

    expect(screen.queryByText(/to go|goal reached|under goal|over goal/i)).not.toBeInTheDocument();
    // The goal, its target and the deadline.
    expect(screen.getAllByText("Not set")).toHaveLength(3);
  });
});

// Two starts, two figures: the chips measure the goal from the client's reading
// on the goal's start day; the Since-start pill measures the client from their
// origin, the baseline. Each start sits on the other side of the target from
// the other, so the chip's wording shows which one it measured from.
describe("StatusBand — the chips start at the goal's start, the pill at the baseline", () => {
  it("takes the chips' start from the goal's start reading, never the baseline", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({
          weight: { baseline: 88.5, current: 82 },
          bodyFat: { baseline: 30.5, current: 20.8 },
        })}
        goal={goalOf({ type: "general_fitness", targetWeight: 80.5, targetBodyFatPercentage: 19.5, start: { weight: 76.5, bodyFat: 17.5 } })}
      />
    );

    // Started below both targets, so above them is past them.
    expect(screen.getByText("1.5 kg over goal")).toBeInTheDocument();
    expect(screen.getByText("1.3% over goal")).toBeInTheDocument();
    // The pill, from the baseline.
    expect(screen.getByText("-6.5kg · -9.7%")).toBeInTheDocument();
  });
});

// The two smoke findings of docs/MEASUREMENT-LOG-PLAN.md commit 4: the pill and
// the chips read the page-level client record — fetched once, revalidated only
// by coach-side writes — while the chart beside them read the series, so a
// check-in the client submitted reached the chart on the next visit and the
// pill only on a reload. "Now" and the baseline come from the series.
describe("StatusBand — no reading comes from the client record", () => {
  it("ignores the client record's readings: the series is what renders", () => {
    render(
      <StatusBand
        client={{
          ...BASE,
          startingWeight: 99.5,
          currentWeight: 98.5,
          startingBodyFatPercentage: 41,
          currentBodyFatPercentage: 39,
        }}
        {...PROPS}
        series={seriesOf({
          weight: { baseline: 92.5, current: 88 },
          bodyFat: { baseline: 26.5, current: 23 },
        })}
        goal={goalOf({ type: "lose_weight", targetWeight: 86 })}
      />
    );

    expect(screen.getByText("2.0 kg to go")).toBeInTheDocument();
    expect(screen.getByText("-4.5kg · -3.5%")).toBeInTheDocument();
  });

  it("takes 'now' from the NEWEST point, whatever its date, and the pill's start from the baseline", () => {
    const series = seriesOf({ weight: { baseline: 100.5, current: 96.5 } });
    // A backdated reading appended later still sits before the newest day.
    series.weight = [point("2026-08-20", 96.5), point("2026-02-01", 107)].sort((a, b) =>
      a.date < b.date ? -1 : 1
    );
    render(<StatusBand client={BASE} {...PROPS} series={series} />);

    expect(screen.getByText("-4.0kg")).toBeInTheDocument();
  });

  it("renders the chips and the pill pending while the series loads, never as empty", () => {
    const { container } = render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={null}
        seriesPending
        goal={goalOf({ targetWeight: 79.5 })}
      />
    );

    expect(screen.queryByText(/to go|goal reached/i)).not.toBeInTheDocument();
    // Only the deadline cell, which waits for the goal alone, may settle.
    expect(screen.getAllByText("Not set")).toHaveLength(1);
    expect(screen.getByText(/Since start:/)).toBeInTheDocument();
    expect(screen.queryByText(/-?\d+\.\d+kg/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});

describe("StatusBand — the chart/cells split", () => {
  it("mounts the chart beside the cells rather than owning its read", () => {
    render(<StatusBand client={{ ...BASE, bmr: 1786 }} {...PROPS} />);

    // The band is presentational: the tab fetches the series and passes both
    // the chart and the payload in, so the band never grows a read of its own.
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText("Goal")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Deadline")).toBeInTheDocument();
  });
});

// The goal card (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d2): the goal's name,
// its type where the name does not say it, what is planned next, its targets
// and its deadline, and the pencil to the goals sheet.
describe("StatusBand — the goal card", () => {
  it("names the goal, with its type beside a name of the coach's own", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        goal={goalOf({ name: "Lean out", type: "lose_weight", targetWeight: 79.2 })}
      />
    );

    expect(screen.getByText("Lean out")).toBeInTheDocument();
    expect(screen.getByText("Lose weight")).toBeInTheDocument();
  });

  it("says the type once when the name is the type's own", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        goal={goalOf({ name: "Build muscle", type: "build_muscle", targetWeight: 91.4 })}
      />
    );

    expect(screen.getAllByText("Build muscle")).toHaveLength(1);
  });

  it("says what is planned next, with or without a goal in force", () => {
    const { rerender } = render(
      <StatusBand
        client={BASE}
        {...PROPS}
        goal={goalOf({ name: "Lean out", targetWeight: 79.2 })}
        nextGoal={plannedOf("Build", "2026-11-02")}
      />
    );
    expect(screen.getByText("Next: Build from 2 Nov")).toBeInTheDocument();

    rerender(<StatusBand client={BASE} {...PROPS} nextGoal={plannedOf("Peak", "2027-01-18")} />);
    expect(screen.getByText("Next: Peak from 18 Jan")).toBeInTheDocument();
  });

  it("reads No target for a goal that has none, and Event day for event prep", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        goal={goalOf({ name: "Race day", type: "event_prep", deadline: "2026-12-05" })}
      />
    );

    expect(screen.getByText("No target")).toBeInTheDocument();
    expect(screen.getByText("Event day")).toBeInTheDocument();
    expect(screen.queryByText("Deadline")).not.toBeInTheDocument();
  });

  it("opens the goals sheet from its pencil", async () => {
    const user = userEvent.setup();
    const onEditGoals = vi.fn();
    render(<StatusBand client={BASE} {...PROPS} onEditGoals={onEditGoals} />);

    await user.click(screen.getByRole("button", { name: "Edit goals" }));
    expect(onEditGoals).toHaveBeenCalledTimes(1);
  });

  it("says the goal could not be loaded rather than Not set when the read failed", () => {
    render(<StatusBand client={BASE} {...PROPS} goalFailed />);

    expect(screen.getByText("Couldn't load the goal")).toBeInTheDocument();
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  });

  it("renders the goal pending while its read is in flight", () => {
    const { container } = render(
      <StatusBand client={BASE} {...PROPS} goalPending nextGoal={plannedOf("Build", "2026-11-02")} />
    );

    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
    expect(screen.queryByText(/Next:/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(3);
  });
});

describe("StatusBand — energy", () => {
  it("carries TDEE as the BMR cell's sub-line", () => {
    render(<StatusBand client={{ ...BASE, bmr: 1786.4, tdee: 2143.2 }} {...PROPS} />);

    expect(screen.getByText("1786")).toBeInTheDocument();
    expect(screen.getByText("TDEE 2143")).toBeInTheDocument();
  });

  it("says the pair is unrecorded rather than 'not set' — no coach types a BMR", () => {
    render(<StatusBand client={BASE} {...PROPS} />);

    expect(screen.getByText("Not recorded")).toBeInTheDocument();
  });
});

describe("StatusBand — the deadline cell", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("floors whole weeks, so the figure never overstates the time left", () => {
    // 59 days = eight full weeks and three days.
    render(<StatusBand client={BASE} {...PROPS} goal={goalOf({ deadline: "2026-10-26" })} />);

    expect(screen.getByText("8 weeks left")).toBeInTheDocument();
  });

  it("drops to days inside the last week", () => {
    render(<StatusBand client={BASE} {...PROPS} goal={goalOf({ deadline: "2026-08-31" })} />);

    expect(screen.getByText("3 days left")).toBeInTheDocument();
  });

  it("names today and a passed deadline in words", () => {
    const { rerender } = render(
      <StatusBand client={BASE} {...PROPS} goal={goalOf({ deadline: "2026-08-28" })} />
    );
    expect(screen.getByText("Due today")).toBeInTheDocument();

    rerender(<StatusBand client={BASE} {...PROPS} goal={goalOf({ deadline: "2026-08-20" })} />);
    expect(screen.getByText("Deadline passed")).toBeInTheDocument();
  });

  it("anchors on the CLIENT's day, not the device's", () => {
    // 2026-08-28T12:00Z is already the 29th in Auckland, so the same deadline
    // is one day closer for this client than a device-day reading would say.
    render(
      <StatusBand
        client={{ ...BASE, timezone: "Pacific/Auckland" }}
        {...PROPS}
        goal={goalOf({ deadline: "2026-09-05" })}
      />
    );

    expect(screen.getByText("1 week left")).toBeInTheDocument();
  });

  it("leaves the sub-line blank when there is no deadline", () => {
    render(<StatusBand client={BASE} {...PROPS} />);

    expect(screen.queryByText(/weeks? left|days? left|Deadline passed/)).not.toBeInTheDocument();
  });

  it("waits for the goal alone — the series does not hold the deadline cell", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={null}
        seriesPending
        goal={goalOf({ deadline: "2026-08-31" })}
      />
    );

    expect(screen.getByText("3 days left")).toBeInTheDocument();
  });
});

describe("StatusBand — footer", () => {
  it("labels the lifetime delta 'Since start', because the rail above it is windowed", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({
          weight: { baseline: 102.5, current: 99 },
          bodyFat: { baseline: 29, current: 27.5 },
        })}
      />
    );

    expect(screen.getByText(/Since start:/)).toBeInTheDocument();
    expect(screen.getByText("-3.5kg · -1.5%")).toBeInTheDocument();
  });

  it("hides the chip when neither measurement pair exists", () => {
    render(<StatusBand client={BASE} {...PROPS} />);

    expect(screen.queryByText(/Since start:/)).not.toBeInTheDocument();
  });

  it("links to the Journey tab", async () => {
    const user = userEvent.setup();
    const onOpenMetrics = vi.fn();
    render(<StatusBand {...PROPS} client={BASE} onOpenMetrics={onOpenMetrics} />);

    await user.click(screen.getByRole("button", { name: /Open metrics/ }));
    expect(onOpenMetrics).toHaveBeenCalledTimes(1);
  });
});

// Every "since start" figure waits for the start date; the big numbers above
// do not — they are "now", the newest reading of any date.
describe("StatusBand — a start date still ahead", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("reads `Starts …` in place of the since-start delta", () => {
    render(
      <StatusBand
        client={{ ...BASE, startDate: "2026-10-15" }}
        {...PROPS}
        series={seriesOf({ weight: { baseline: 93.5, current: 91 } })}
      />
    );

    expect(screen.getByText(/^Starts/)).toBeInTheDocument();
    expect(screen.getByText("15 Oct")).toBeInTheDocument();
    expect(screen.queryByText(/Since start:/)).not.toBeInTheDocument();
  });

  it("anchors 'ahead' on the CLIENT's day, not the device's", () => {
    // 2026-08-28T12:00Z is already the 29th in Auckland: a start date of the
    // 29th has arrived for this client, and the delta is due.
    render(
      <StatusBand
        client={{ ...BASE, timezone: "Pacific/Auckland", startDate: "2026-08-29" }}
        {...PROPS}
        series={seriesOf({ weight: { baseline: 95, current: 90.5 } })}
      />
    );

    expect(screen.getByText(/Since start:/)).toBeInTheDocument();
    expect(screen.queryByText(/^Starts/)).not.toBeInTheDocument();
  });
});
