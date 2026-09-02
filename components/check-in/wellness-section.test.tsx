import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WellnessSection } from "./wellness-section";
import type { DailyLog } from "@/types/daily-log";
import type { CheckInComparison } from "@/types/check-in";

const START = new Date("2026-08-24T00:00:00");
const END = new Date("2026-08-30T00:00:00"); // seven days

function log(date: string, values: Partial<DailyLog>): DailyLog {
  return { date, ...values } as DailyLog;
}

function renderWeek(
  logs: DailyLog[],
  changes: CheckInComparison["changes"] | null = null,
) {
  return render(
    <WellnessSection
      dailyLogs={logs}
      contextStartDate={START}
      contextEndDate={END}
      changes={changes}
    />,
  );
}

afterEach(cleanup);

describe("the wellness averages", () => {
  it("is the mean of the days LOGGED, not of the calendar week", () => {
    // Two entries at 6 and 7 average 6.5. Divided by the seven calendar days
    // they read 1.9 — "relaxed" for a client who is not — which is what this
    // card showed until the denominator was fixed.
    renderWeek([
      log("2026-08-24", { stress: 6 }),
      log("2026-08-25", { stress: 7 }),
    ]);

    expect(screen.getByText("6.5")).toBeInTheDocument();
    expect(screen.queryByText("1.9")).not.toBeInTheDocument();
  });

  it("counts each metric over its OWN logged days", () => {
    // Stress logged twice, mood three times: one shared day count would be
    // wrong for at least one of them.
    renderWeek([
      log("2026-08-24", { stress: 6, mood: 3 }),
      log("2026-08-25", { stress: 8, mood: 3 }),
      log("2026-08-26", { mood: 3 }),
    ]);

    expect(screen.getByText("7.0")).toBeInTheDocument(); // stress: (6+8)/2
    expect(screen.getByText("3.0")).toBeInTheDocument(); // mood: 9/3
  });

  it("shows a dash for a metric with no entries at all", () => {
    renderWeek([log("2026-08-24", { stress: 6 })]);

    // Mood, energy, sleep and soreness were never logged.
    expect(screen.getAllByText("--")).toHaveLength(4);
  });

  it("renders nothing when the week has no wellness data", () => {
    const { container } = renderWeek([log("2026-08-24", {})]);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the week-over-week deltas", () => {
  it("signs the change and reads good/bad by metric direction", () => {
    // Stress and soreness are INVERTED: down is good. Sleep is not.
    renderWeek(
      [log("2026-08-24", { stress: 6, sleep: 7 })],
      { stress: 2, sleep: -1 },
    );

    const up = screen.getByText("+2");
    expect(up).toBeInTheDocument();
    expect(up.className).toContain("#d97706"); // stress rising = attention

    const down = screen.getByText("-1");
    expect(down).toBeInTheDocument();
    expect(down.className).toContain("#d97706"); // sleep falling = attention
  });

  it("colours a change the size of the number shown — there is no 0.5 cut-off", () => {
    // Four distinct moves, each under the 0.5 that used to read as "stable"
    // and grey. Sleep and mood: up is good. Stress and soreness: down is good.
    renderWeek(
      [log("2026-08-24", { sleep: 7, mood: 3, stress: 6, soreness: 4 })],
      { sleep: 0.1, mood: -0.2, stress: 0.3, soreness: -0.4 },
    );

    expect(screen.getByText("+0.1").className).toContain("#0d9488"); // sleep up = good
    expect(screen.getByText("-0.2").className).toContain("#d97706"); // mood down = attention
    expect(screen.getByText("+0.3").className).toContain("#d97706"); // stress up = attention
    expect(screen.getByText("-0.4").className).toContain("#0d9488"); // soreness down = good
  });

  it("prints one decimal, like the average above it, and is neutral only at 0.0", () => {
    // The stored change carries two decimals; 0.43 reads +0.4 beside a 7.0
    // average, and 0.04 rounds to nothing, which is the one grey case.
    renderWeek(
      [log("2026-08-24", { energy: 7, stress: 6 })],
      { energy: 0.43, stress: 0.04 },
    );

    expect(screen.getByText("+0.4")).toBeInTheDocument();
    expect(screen.queryByText("+0.43")).not.toBeInTheDocument();
    expect(screen.getByText("0").className).toContain("#93b0b4");
  });

  it("shows no delta when there is nothing to compare against", () => {
    // A first check-in: nothing to measure against, so `changes` is empty.
    renderWeek(
      [log("2026-08-24", { stress: 6 })],
      {},
    );

    expect(screen.getByText("6.0")).toBeInTheDocument();
    // A signed number, not the "--" placeholders the unlogged metrics render.
    expect(screen.queryByText(/^[+-]\d/)).not.toBeInTheDocument();
  });

  it("renders the averages with no comparison data at all", () => {
    // The comparison read is a separate request and can fail on its own; the
    // section still has everything it needs for the values.
    renderWeek([log("2026-08-24", { stress: 6 })], null);

    expect(screen.getByText("6.0")).toBeInTheDocument();
  });
});
