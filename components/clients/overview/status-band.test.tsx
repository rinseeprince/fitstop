import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StatusBand } from "./status-band";
import type { EffectiveGoal } from "@/lib/goals/resolve-effective-goal";
import type { Client } from "@/types/check-in";

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
  startDate: "2026-08-12",
};

const goalOf = (overrides: Partial<EffectiveGoal>): EffectiveGoal => ({
  ...NO_GOAL,
  ...overrides,
});

// The band renders whatever chart it is handed; the chart's own behaviour is
// pinned by progression-chart.test.tsx.
const PROPS = { goal: NO_GOAL, chart: <div data-testid="chart" />, onOpenMetrics: vi.fn() };

beforeEach(() => cleanup());

describe("StatusBand — goal chips", () => {
  it("gap: reports the distance still to travel", () => {
    render(
      <StatusBand
        client={{ ...BASE, startingWeight: 90, currentWeight: 86 }}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );

    expect(screen.getByText("4.0 kg to go")).toBeInTheDocument();
  });

  it("reached: says so once the client lands on the goal", () => {
    render(
      <StatusBand
        client={{ ...BASE, startingWeight: 90, currentWeight: 82 }}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );

    expect(screen.getByText("Goal reached")).toBeInTheDocument();
  });

  it("beyond a loss goal reads 'under goal', beyond a gain goal 'over goal'", () => {
    const { rerender } = render(
      <StatusBand
        client={{ ...BASE, startingWeight: 90, currentWeight: 80 }}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 82 })}
      />
    );
    expect(screen.getByText("2.0 kg under goal")).toBeInTheDocument();

    rerender(
      <StatusBand
        client={{ ...BASE, startingWeight: 70, currentWeight: 78 }}
        {...PROPS}
        goal={goalOf({ goalWeightKg: 76 })}
      />
    );
    expect(screen.getByText("2.0 kg over goal")).toBeInTheDocument();
  });

  it("body fat uses percent rather than the weight unit", () => {
    render(
      <StatusBand
        client={{ ...BASE, startingBodyFatPercentage: 24, currentBodyFatPercentage: 20 }}
        {...PROPS}
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
          startingWeight: 90,
          currentWeight: 86,
          // What a stale/failed dual-write leaves behind. Nothing may read it.
          goalWeight: 99,
          goalBodyFatPercentage: 30,
        }}
        {...PROPS}
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
        client={{ ...BASE, startingWeight: 90, currentWeight: 86, goalWeight: 99 }}
        {...PROPS}
      />
    );

    expect(screen.queryByText("99.0")).not.toBeInTheDocument();
    expect(screen.queryByText(/to go|goal reached/i)).not.toBeInTheDocument();
    // Goal weight, goal body fat and the deadline are all unset here.
    expect(screen.getAllByText("Not set")).toHaveLength(3);
  });
});

describe("StatusBand — the chart/cells split", () => {
  it("mounts the chart beside the cells rather than owning its read", () => {
    render(<StatusBand client={{ ...BASE, bmr: 1786 }} {...PROPS} />);

    // The band is presentational: the tab fetches the series and passes the
    // chart in, so the band never grows a data dependency of its own.
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
});

describe("StatusBand — footer", () => {
  it("labels the lifetime delta 'Since start', because the rail above it is windowed", () => {
    render(
      <StatusBand
        client={{
          ...BASE,
          startingWeight: 90,
          currentWeight: 86,
          startingBodyFatPercentage: 24,
          currentBodyFatPercentage: 21.5,
        }}
        {...PROPS}
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
