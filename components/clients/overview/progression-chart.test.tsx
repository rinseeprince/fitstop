import { cloneElement, isValidElement, type ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProgressionChart } from "./progression-chart";
import { addDaysToDate } from "@/utils/metric-points";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { MeasurementSeries, MeasurementSeriesPoint } from "@/types/coach-overview";

const unitPreference = { value: "metric" as "metric" | "imperial" };

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: unitPreference.value, isLoading: false, error: null }),
}));

// recharts measures its container, and jsdom reports every element as 0x0, so
// ResponsiveContainer hands its child a width of zero and the chart renders
// nothing. Passing a real size lets the chart's own SVG mount, so these assert
// against a real render rather than a stub.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, {
            width: 560,
            height: 104,
          })
        : null,
  };
});

const NO_GOAL: EffectiveGoal = {
  goalWeightKg: null,
  goalBodyFatPercentage: null,
  deadline: null,
  startDate: "2026-07-01",
};

/** One day-value of the measurement log, as the series carries it. */
function point(
  date: string,
  value: number,
  extra: Partial<MeasurementSeriesPoint> = {}
): MeasurementSeriesPoint {
  return {
    date,
    value,
    source: "check_in",
    note: null,
    id: `m-${date}`,
    recordedAt: `${date}T08:00:00+00:00`,
    ...extra,
  };
}

/** The full payload: seven metrics, the baseline per metric, the start date. */
function series(overrides: Partial<MeasurementSeries> = {}): MeasurementSeries {
  return {
    weight: [],
    bodyFat: [],
    waist: [],
    hips: [],
    chest: [],
    arms: [],
    thighs: [],
    baseline: {},
    startDate: null,
    ...overrides,
  };
}

/** A weekly weigh-in series — what a real client actually produces. */
const WEEKLY = series({
  weight: [
    point("2026-07-06", 90),
    point("2026-07-13", 89.4),
    point("2026-07-20", 88.9),
    point("2026-07-27", 88.2),
  ],
  bodyFat: [point("2026-07-06", 24), point("2026-07-27", 22.6)],
  startDate: "2026-03-01",
});

const PROPS = {
  series: WEEKLY,
  isLoading: false,
  metric: "weight" as const,
  onMetricChange: vi.fn(),
  goal: NO_GOAL,
  startDate: "2026-03-01",
  timezone: "UTC",
};

/** The drawn dots. recharts mounts an empty symbol layer for a null point, so
 *  count the symbol paths rather than the layers. */
const dots = (container: HTMLElement) =>
  container.querySelectorAll(".recharts-scatter-symbol .recharts-symbols");

beforeEach(() => {
  cleanup();
  unitPreference.value = "metric";
});

describe("ProgressionChart", () => {
  it("leads with the latest reading and its unit", () => {
    render(<ProgressionChart {...PROPS} />);

    expect(screen.getByText("88.2")).toBeInTheDocument();
    expect(screen.getByText("kg")).toBeInTheDocument();
  });

  it("states the rate per week from the smoothed series", () => {
    render(<ProgressionChart {...PROPS} />);

    expect(screen.getByText(/kg\/wk/)).toBeInTheDocument();
  });

  it("refuses a rate under two points, rather than extrapolating one", () => {
    render(
      <ProgressionChart {...PROPS} series={series({ weight: [point("2026-07-27", 88.2)] })} />
    );

    expect(screen.getByText("88.2")).toBeInTheDocument();
    expect(screen.getByText("Not enough logged to state a rate")).toBeInTheDocument();
  });

  it("refuses a rate under a week of span — two readings a day apart are not a trend", () => {
    render(
      <ProgressionChart
        {...PROPS}
        series={series({ weight: [point("2026-07-26", 90), point("2026-07-27", 88.2)] })}
      />
    );

    expect(screen.getByText("Not enough logged to state a rate")).toBeInTheDocument();
  });

  it("says the window is empty rather than showing a zero", () => {
    render(<ProgressionChart {...PROPS} series={series()} />);

    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByText("No measurements in this window")).toBeInTheDocument();
  });

  it("still shows where the goal is when the client has logged nothing", () => {
    render(
      <ProgressionChart {...PROPS} series={series()} goal={{ ...NO_GOAL, goalWeightKg: 85 }} />
    );

    // The target is a fact about the client, not about the window's contents.
    expect(screen.getByText("goal 85")).toBeInTheDocument();
  });

  it("draws no goal line for a maintenance client", () => {
    const { container } = render(<ProgressionChart {...PROPS} />);

    expect(container.querySelector(".recharts-reference-line")).toBeNull();
    expect(screen.queryByText(/^goal /)).not.toBeInTheDocument();
  });

  it("switches the readout with the metric lens", async () => {
    const user = userEvent.setup();
    const onMetricChange = vi.fn();
    const { rerender } = render(
      <ProgressionChart {...PROPS} onMetricChange={onMetricChange} />
    );

    await user.click(screen.getByRole("button", { name: "Body fat" }));
    expect(onMetricChange).toHaveBeenCalledWith("bodyFat");

    rerender(<ProgressionChart {...PROPS} metric="bodyFat" onMetricChange={onMetricChange} />);
    expect(screen.getByText("22.6")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
  });

  it("converts the series for an imperial coach, to ONE decimal", () => {
    unitPreference.value = "imperial";
    render(<ProgressionChart {...PROPS} />);

    // 88.2 kg = 194.4451… lbs. Rendering the raw float is what put fifteen
    // decimal places on the metrics hero once.
    expect(screen.getByText("194.4")).toBeInTheDocument();
    expect(screen.getByText("lbs")).toBeInTheDocument();
  });

  it("converts the GOAL the same way, so the line and the value are comparable", () => {
    unitPreference.value = "imperial";
    const { container } = render(
      <ProgressionChart {...PROPS} goal={{ ...NO_GOAL, goalWeightKg: 85 }} />
    );

    expect(container.textContent).toContain("goal 187.4");
  });

  it("shows a skeleton on the first load, not an empty chart", () => {
    const { container } = render(<ProgressionChart {...PROPS} series={null} isLoading />);

    expect(container.querySelector(".recharts-surface")).toBeNull();
    expect(screen.queryByText("No measurements in this window")).not.toBeInTheDocument();
  });
});

// The axis runs [start date, today] rather than [first reading, last reading],
// so these need a pinned clock. userEvent and fake timers do not mix, which is
// why the interaction cases stay above on the real one.
describe("ProgressionChart — the journey axis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("labels the axis with the journey's ends — the start date and today", () => {
    render(<ProgressionChart {...PROPS} />);

    // NOT the first and last readings. Those two coincide for a client who
    // logs; the difference is the whole point for one who stopped in July.
    expect(screen.getByText("1 Mar")).toBeInTheDocument();
    expect(screen.getByText("28 Aug")).toBeInTheDocument();
    expect(screen.queryByText("6 Jul")).not.toBeInTheDocument();
  });

  it("anchors 'today' on the CLIENT's day, not the device's", () => {
    render(<ProgressionChart {...PROPS} timezone="Pacific/Auckland" />);

    // 2026-08-28T12:00Z is already the 29th in Auckland.
    expect(screen.getByText("29 Aug")).toBeInTheDocument();
  });

  it("falls back to the first reading when the client has no start date yet", () => {
    render(<ProgressionChart {...PROPS} startDate={null} />);

    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("28 Aug")).toBeInTheDocument();
  });

  it("drops the raw dots once a journey is long enough for them to merge", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      point(addDaysToDate("2026-06-01", i), 90 - i * 0.05)
    );

    const { container } = render(
      <ProgressionChart {...PROPS} series={series({ weight: many })} />
    );

    // The trend line survives; only its markers go.
    expect(container.querySelector(".recharts-area")).not.toBeNull();
    expect(dots(container)).toHaveLength(0);
  });

  it("keeps the raw dots on a short journey", () => {
    const { container } = render(<ProgressionChart {...PROPS} />);

    expect(dots(container)).toHaveLength(4);
  });
});

// Three rules from the measurement log (docs/MEASUREMENT-LOG-PLAN.md D4): the
// big number is "now" whatever its date; the line begins at the BASELINE, drawn
// at the start date; a start date still ahead reads `Starts …` in place of a
// line. Pinned clock, as above.
describe("ProgressionChart — the start date and the baseline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  /** The reading as of the start date — here an intake taken nine days before it. */
  const BASELINE = { value: 92, date: "2026-02-20", source: "intake" as const, id: "m-0" };

  it("reads `Starts …` and draws no line while the start date is ahead", () => {
    const { container } = render(<ProgressionChart {...PROPS} startDate="2026-10-15" />);

    expect(screen.getByText("Starts 15 Oct")).toBeInTheDocument();
    expect(container.querySelector(".recharts-surface")).toBeNull();
    expect(screen.queryByText("No measurements in this window")).not.toBeInTheDocument();
    // The readout is still "now": the newest reading never waits for the start.
    expect(screen.getByText("88.2")).toBeInTheDocument();
  });

  it("begins the line at the baseline, drawn AT the start date and named with its own date", () => {
    const { container } = render(
      <ProgressionChart {...PROPS} series={series({ ...WEEKLY, baseline: { weight: BASELINE } })} />
    );

    // The footer's left end: the start date, the baseline's value, and — the
    // reading having been taken before the start — where and when it came from.
    expect(screen.getByText("1 Mar · 92 kg (intake, 20 Feb)")).toBeInTheDocument();
    // Prepended at 1 Mar, not 20 Feb: the rate spans 148 days to 27 Jul, so
    // -3.8 kg reads -0.18/wk (it would be -0.17 from 20 Feb, -0.60 without it).
    expect(screen.getByText("-0.18 kg/wk")).toBeInTheDocument();
    // Four readings and the one baseline marker.
    expect(dots(container)).toHaveLength(5);
  });

  it("names only the value when the baseline was taken on the start date itself", () => {
    render(
      <ProgressionChart
        {...PROPS}
        series={series({ ...WEEKLY, baseline: { weight: { ...BASELINE, date: "2026-03-01" } } })}
      />
    );

    expect(screen.getByText("1 Mar · 92 kg")).toBeInTheDocument();
  });

  it("leads with the newest reading even when it is dated before the start", () => {
    render(
      <ProgressionChart {...PROPS} series={series({ weight: [point("2026-02-20", 92)] })} />
    );

    expect(screen.getByText("92.0")).toBeInTheDocument();
    // Not a point of the journey, so there is nothing to draw or to rate.
    expect(screen.getByText("No measurements in this window")).toBeInTheDocument();
  });
});
