import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientStatusCard } from "./client-status-card";
import type { Client } from "@/types/check-in";
import type { OverviewPlanSummary } from "@/types/coach-overview";

const BASE: Client = {
  id: "client-1",
  coachId: "coach-1",
  name: "Alex Kim",
  email: "alex@example.com",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  weightUnit: "kg",
  includeActivityBurn: false,
  surplusAsCarbs: false,
  timezone: "Australia/Sydney",
};

const TRAINING: NonNullable<OverviewPlanSummary["training"]> = {
  planId: "plan-1",
  planName: "Hypertrophy Block A",
  splitType: "upper_lower",
  frequencyPerWeek: 4,
  programDurationWeeks: 8,
  currentWeek: 3,
  thisWeek: { completed: 2, planned: 4, missed: 1 },
  nextSession: null,
  progressionPct: null,
};

const PROPS = {
  isCalculatingBMR: false,
  onCalculateBMR: vi.fn(),
  onOpenMetrics: vi.fn(),
};

beforeEach(() => cleanup());

describe("ClientStatusCard — goal chips", () => {
  it("gap: reports the distance still to travel, in the warning tone", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 86, goalWeight: 82 }}
        training={null}
        {...PROPS}
      />
    );

    expect(screen.getByText("4.0 kg to go")).toBeInTheDocument();
  });

  it("reached: says so once the client lands on the goal", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 82, goalWeight: 82 }}
        training={null}
        {...PROPS}
      />
    );

    expect(screen.getByText("Goal reached")).toBeInTheDocument();
  });

  it("beyond a loss goal: reads 'under goal'", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 80, goalWeight: 82 }}
        training={null}
        {...PROPS}
      />
    );

    expect(screen.getByText("2.0 kg under goal")).toBeInTheDocument();
  });

  it("beyond a gain goal: reads 'over goal'", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 70, currentWeight: 78, goalWeight: 76 }}
        training={null}
        {...PROPS}
      />
    );

    expect(screen.getByText("2.0 kg over goal")).toBeInTheDocument();
  });

  it("no goal: no chip at all", () => {
    render(
      <ClientStatusCard
        client={{ ...BASE, startingWeight: 90, currentWeight: 86 }}
        training={null}
        {...PROPS}
      />
    );

    expect(screen.queryByText(/to go|goal reached|under goal|over goal/i)).not.toBeInTheDocument();
  });

  it("body fat uses percent rather than the weight unit", () => {
    render(
      <ClientStatusCard
        client={{
          ...BASE,
          startingBodyFatPercentage: 24,
          currentBodyFatPercentage: 20,
          goalBodyFatPercentage: 18,
        }}
        training={null}
        {...PROPS}
      />
    );

    expect(screen.getByText("2.0% to go")).toBeInTheDocument();
  });
});

describe("ClientStatusCard — training block chips", () => {
  it("shows the plan name, the week, and Active", () => {
    render(<ClientStatusCard client={BASE} training={TRAINING} {...PROPS} />);

    expect(screen.getByText("Hypertrophy Block A")).toBeInTheDocument();
    expect(screen.getByText("Week 3 of 8")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("reads Ended, and drops the week chip, once the window is past", () => {
    render(
      <ClientStatusCard client={BASE} training={{ ...TRAINING, currentWeek: null }} {...PROPS} />
    );

    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText(/Week \d+ of/)).not.toBeInTheDocument();
  });

  it("says No plan when nothing is placed", () => {
    render(<ClientStatusCard client={BASE} training={null} {...PROPS} />);

    expect(screen.getByText("No plan")).toBeInTheDocument();
  });
});

describe("ClientStatusCard — actions", () => {
  it("links to the Metrics tab", async () => {
    const user = userEvent.setup();
    const onOpenMetrics = vi.fn();
    render(
      <ClientStatusCard
        client={BASE}
        training={null}
        isCalculatingBMR={false}
        onCalculateBMR={vi.fn()}
        onOpenMetrics={onOpenMetrics}
      />
    );

    await user.click(screen.getByRole("button", { name: "Open Metrics" }));
    expect(onOpenMetrics).toHaveBeenCalledTimes(1);
  });

  it("names unrecorded metrics rather than showing a zero", () => {
    render(<ClientStatusCard client={BASE} training={null} {...PROPS} />);

    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });
});
