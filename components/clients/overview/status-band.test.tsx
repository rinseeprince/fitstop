import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StatusBand } from "./status-band";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { Client } from "@/types/check-in";
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
  includeActivityBurn: false,
  surplusAsCarbs: false,
  timezone: "UTC",
};

// Both targets arrive resolved from `client_goals`. The band is presentational
// about them: the tab runs resolveEffectiveGoal and hands the result down.
const NO_GOAL: EffectiveGoal = {
  goalWeightKg: null,
  goalBodyFatPercentage: null,
  deadline: null,
};

const goalOf = (overrides: Partial<EffectiveGoal>): EffectiveGoal => ({
  ...NO_GOAL,
  ...overrides,
});

const point = (date: string, value: number): MeasurementSeriesPoint => ({
  date,
  value,
  source: "check_in",
  note: null,
  id: `m-${date}`,
  recordedAt: `${date}T08:00:00+00:00`,
});

type Pair = { start?: number; current?: number };

/**
 * The series payload the band reads its four reading figures from: the
 * newest point is "now", the baseline is the start. Everything else empty.
 */
function seriesOf(readings: { weight?: Pair; bodyFat?: Pair } = {}): MeasurementSeries {
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
    if (pair?.start != null) {
      series.baseline[key] = { value: pair.start, date: "2026-03-01", source: "intake", id: `${key}-0` };
    }
    if (pair?.current != null) {
      // An older point first: the band must take the NEWEST, not the first.
      series[key] = [point("2026-03-08", pair.start ?? pair.current), point("2026-08-20", pair.current)];
    }
  }
  return series;
}

// The band renders whatever chart it is handed; the chart's own behaviour is
// pinned by progression-chart.test.tsx.
const PROPS = {
  goal: NO_GOAL,
  chart: <div data-testid="chart" />,
  onOpenMetrics: vi.fn(),
  series: seriesOf(),
};

beforeEach(() => cleanup());

describe("StatusBand — goal chips", () => {
  it("gap: reports the distance still to travel", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { start: 90, current: 86 } })}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );

    expect(screen.getByText("4.0 kg to go")).toBeInTheDocument();
  });

  it("reached: says so once the client lands on the goal", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { start: 90, current: 82 } })}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );

    expect(screen.getByText("Goal reached")).toBeInTheDocument();
  });

  it("beyond a loss goal reads 'under goal', beyond a gain goal 'over goal'", () => {
    const { rerender } = render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { start: 90, current: 80 } })}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );
    expect(screen.getByText("2.0 kg under goal")).toBeInTheDocument();

    rerender(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ weight: { start: 70, current: 78 } })}
        goal={goalOf({ goalWeightKg: 76 })}
      />
    );
    expect(screen.getByText("2.0 kg over goal")).toBeInTheDocument();
  });

  it("body fat uses percent rather than the weight unit", () => {
    render(
      <StatusBand
        client={BASE}
        {...PROPS}
        series={seriesOf({ bodyFat: { start: 24, current: 20 } })}
        goal={goalOf({ goalBodyFatPercentage: 18 })}
      />
    );

    expect(screen.getByText("2.0% to go")).toBeInTheDocument();
  });
});

// The regression this inherits from the status card it replaces: that card used
// to read `clients.goal_weight` — the denormalized mirror — and was the last
// coach surface rendering a goal nobody had resolved (invariant 16).
describe("StatusBand — targets come from client_goals, not the mirror", () => {
  it("a diverged mirror cannot win: the resolved goal is what renders", () => {
    render(
      <StatusBand
        client={{
          ...BASE,
          // What a stale/failed dual-write leaves behind. Nothing may read it.
          goalWeight: 99,
          goalBodyFatPercentage: 30,
        }}
        {...PROPS}
        series={seriesOf({ weight: { start: 90, current: 86 } })}
        goal={goalOf({ goalWeightKg: 82, goalBodyFatPercentage: 18 })}
      />
    );

    expect(screen.getByText("82.0")).toBeInTheDocument();
    expect(screen.getByText("18.0")).toBeInTheDocument();
    expect(screen.queryByText("99.0")).not.toBeInTheDocument();
    expect(screen.queryByText("30.0")).not.toBeInTheDocument();
  });

  it("maintenance (no weight target) reads as Not set, whatever the mirror holds", () => {
    render(
      <StatusBand
        client={{ ...BASE, goalWeight: 99 }}
        {...PROPS}
        series={seriesOf({ weight: { start: 90, current: 86 } })}
      />
    );

    expect(screen.queryByText("99.0")).not.toBeInTheDocument();
    expect(screen.queryByText(/to go|goal reached/i)).not.toBeInTheDocument();
    // Goal weight, goal body fat and the deadline are all unset here.
    expect(screen.getAllByText("Not set")).toHaveLength(3);
  });
});

// The two smoke findings of docs/MEASUREMENT-LOG-PLAN.md commit 4: the pill and
// the chips read the page-level client record — fetched once, revalidated only
// by coach-side writes — while the chart beside them read the series, so a
// check-in the client submitted reached the chart on the next visit and the
// pill only on a reload. One read for the four figures.
describe("StatusBand — every reading figure comes from the series", () => {
  it("ignores the client record's readings: the series is what renders", () => {
    render(
      <StatusBand
        client={{
          ...BASE,
          startingWeight: 99,
          currentWeight: 99,
          startingBodyFatPercentage: 40,
          currentBodyFatPercentage: 40,
        }}
        {...PROPS}
        series={seriesOf({ weight: { start: 90, current: 86 }, bodyFat: { start: 24, current: 21.5 } })}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );

    expect(screen.getByText("4.0 kg to go")).toBeInTheDocument();
    expect(screen.getByText("-4.0kg · -2.5%")).toBeInTheDocument();
  });

  it("takes 'now' from the NEWEST point, whatever its date, and the start from the baseline", () => {
    const series = seriesOf({ weight: { start: 90, current: 86 } });
    // A backdated reading appended later still sits before the newest day.
    series.weight = [point("2026-08-20", 86), point("2026-02-01", 95)].sort((a, b) =>
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
        goal={goalOf({ goalWeightKg: 82 })}
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
    expect(screen.getByText("Goal weight")).toBeInTheDocument();
    expect(screen.getByText("Deadline")).toBeInTheDocument();
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
        series={seriesOf({ weight: { start: 90, current: 86 }, bodyFat: { start: 24, current: 21.5 } })}
      />
    );

    expect(screen.getByText(/Since start:/)).toBeInTheDocument();
    expect(screen.getByText("-4.0kg · -2.5%")).toBeInTheDocument();
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
        series={seriesOf({ weight: { start: 90, current: 86 } })}
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
        series={seriesOf({ weight: { start: 90, current: 86 } })}
      />
    );

    expect(screen.getByText(/Since start:/)).toBeInTheDocument();
    expect(screen.queryByText(/^Starts/)).not.toBeInTheDocument();
  });
});
