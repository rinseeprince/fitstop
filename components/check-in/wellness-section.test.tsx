import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WellnessSection } from "./wellness-section";
import type { DailyLog } from "@/types/daily-log";

const START = new Date("2026-08-24T00:00:00");
const END = new Date("2026-08-30T00:00:00"); // seven days

function log(date: string, values: Partial<DailyLog>): DailyLog {
  return { date, ...values } as DailyLog;
}

function renderWeek(logs: DailyLog[]) {
  return render(
    <WellnessSection dailyLogs={logs} contextStartDate={START} contextEndDate={END} />,
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
