import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WellnessCards } from "./wellness-cards";
import type { AlertSeverity, AlertType, AttentionAlert } from "@/types/attention-feed";
import type { DailyLog } from "@/types/daily-log";

const DATES = [
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
  "2026-07-23",
  "2026-07-24",
  "2026-07-25",
  "2026-07-26",
];

function log(date: string, values: Partial<DailyLog>): DailyLog {
  return {
    id: `log-${date}`,
    clientId: "client-1",
    date,
    createdAt: `${date}T00:00:00Z`,
    updatedAt: `${date}T00:00:00Z`,
    ...values,
  };
}

function alert(type: AlertType, days: string[], severity: AlertSeverity = "medium"): AttentionAlert {
  return { type, severity, message: "…", affectedDays: days, metricData: [] };
}

const LOGS: DailyLog[] = [
  log("2026-07-24", { mood: 3, energy: 5, sleep: 6, stress: 8, soreness: 7 }),
  log("2026-07-25", { mood: 4, energy: 6, sleep: 7, stress: 7, soreness: 6 }),
  log("2026-07-26", { mood: 5, energy: 8, sleep: 9, stress: 2, soreness: 3 }),
];

const PROPS = { dates: DATES, isLoading: false, onOpenWellness: vi.fn() };

beforeEach(() => cleanup());

describe("WellnessCards", () => {
  it("renders five cards, soreness included", () => {
    render(<WellnessCards logs={LOGS} attentionAlerts={[]} {...PROPS} />);

    for (const name of ["Mood", "Energy", "Sleep quality", "Stress", "Soreness"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("leads with the latest value and its scale", () => {
    render(<WellnessCards logs={LOGS} attentionAlerts={[]} {...PROPS} />);

    expect(screen.getByText("/5")).toBeInTheDocument();
    expect(screen.getAllByText("/10")).toHaveLength(4);
    // Latest mood is 5; latest stress is 2.
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("summarises min/avg/max over the logged days", () => {
    render(<WellnessCards logs={LOGS} attentionAlerts={[]} {...PROPS} />);

    // Mood: 3, 4, 5 → avg 4.0
    expect(screen.getByText(/min 3 · avg 4\.0 · max 5/)).toBeInTheDocument();
  });

  it("flags low metrics with the drop trigger's affected-day count", () => {
    render(
      <WellnessCards
        logs={LOGS}
        attentionAlerts={[alert("mood_drop", ["2026-07-24", "2026-07-25", "2026-07-26"])]}
        {...PROPS}
      />
    );

    expect(screen.getByText(/Low/)).toBeInTheDocument();
    expect(screen.getByText("3 days")).toBeInTheDocument();
  });

  it("flags stress and soreness as High — the inverted metrics", () => {
    render(
      <WellnessCards
        logs={LOGS}
        attentionAlerts={[
          alert("high_stress", ["2026-07-24", "2026-07-25"]),
          alert("high_soreness", ["2026-07-24"]),
        ]}
        {...PROPS}
      />
    );

    expect(screen.getAllByText(/High/)).toHaveLength(2);
    expect(screen.getByText("2 days")).toBeInTheDocument();
    expect(screen.getByText("1 day")).toBeInTheDocument();
  });

  it("counts the flagged metrics in the section header", () => {
    render(
      <WellnessCards
        logs={LOGS}
        attentionAlerts={[alert("energy_drop", ["2026-07-25"]), alert("high_stress", ["2026-07-25"])]}
        {...PROPS}
      />
    );

    // Scoped to the divider row — a metric value could also read "2".
    const header = screen.getByText("Daily wellness").parentElement as HTMLElement;
    expect(within(header).getByText("2")).toBeInTheDocument();
  });

  it("never flags sleep — no trigger evaluates it", () => {
    render(
      <WellnessCards
        logs={LOGS}
        // Every wellness trigger that exists, fired at once.
        attentionAlerts={[
          alert("mood_drop", ["2026-07-26"]),
          alert("energy_drop", ["2026-07-26"]),
          alert("high_stress", ["2026-07-26"]),
          alert("high_soreness", ["2026-07-26"]),
          alert("no_log_gap", ["2026-07-26"], "high"),
        ]}
        {...PROPS}
      />
    );

    // Four flag chips, one per flaggable metric — sleep is not among them.
    expect(screen.getAllByText(/Low|High/)).toHaveLength(4);
  });

  it("shows an unlogged metric as an em-dash rather than a zero", () => {
    render(<WellnessCards logs={[]} attentionAlerts={[]} {...PROPS} />);

    expect(screen.getAllByText("—")).toHaveLength(5);
    expect(screen.getAllByText("Not logged in this window")).toHaveLength(5);
  });

  it("sends the coach to the wellness tab", async () => {
    const user = userEvent.setup();
    const onOpenWellness = vi.fn();
    render(
      <WellnessCards
        logs={LOGS}
        attentionAlerts={[]}
        dates={DATES}
        isLoading={false}
        onOpenWellness={onOpenWellness}
      />
    );

    await user.click(screen.getAllByRole("button")[0]);
    expect(onOpenWellness).toHaveBeenCalledTimes(1);
  });
});
