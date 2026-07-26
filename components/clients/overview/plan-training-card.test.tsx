import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlanTrainingCard } from "./plan-training-card";
import type { OverviewPlanSummary } from "@/types/coach-overview";

const RUNNING: NonNullable<OverviewPlanSummary["training"]> = {
  planId: "plan-1",
  planName: "Hypertrophy Block A",
  splitType: "upper_lower",
  frequencyPerWeek: 4,
  programDurationWeeks: 8,
  currentWeek: 3,
  thisWeek: { completed: 2, planned: 4, missed: 1 },
  nextSession: { name: "Upper A", date: "2026-07-27", isToday: false },
  progressionPct: 4.2,
};

const QUEUED: NonNullable<OverviewPlanSummary["upcomingTraining"]> = {
  planId: "plan-2",
  planName: "Strength Block B",
  startsOn: "2026-07-27",
  splitType: "push_pull_legs",
  frequencyPerWeek: 5,
  programDurationWeeks: 6,
};

beforeEach(() => cleanup());

describe("PlanTrainingCard — running program", () => {
  it("leads with the plan name, its chips, and this week's numbers", () => {
    render(
      <PlanTrainingCard training={RUNNING} upcomingTraining={null} onOpenTraining={vi.fn()} />
    );

    expect(screen.getByText("Hypertrophy Block A")).toBeInTheDocument();
    expect(screen.getByText("Upper/Lower")).toBeInTheDocument();
    expect(screen.getByText("4x/week")).toBeInTheDocument();
    expect(screen.getByText("8 weeks")).toBeInTheDocument();
    expect(screen.getByText("2 of 4")).toBeInTheDocument();
    expect(screen.getByText("1 session missed")).toBeInTheDocument();
    expect(screen.getByText("+4.2%")).toBeInTheDocument();
  });

  it("wins over a queued program", () => {
    render(
      <PlanTrainingCard training={RUNNING} upcomingTraining={QUEUED} onOpenTraining={vi.fn()} />
    );

    expect(screen.getByText("Hypertrophy Block A")).toBeInTheDocument();
    expect(screen.queryByText("Strength Block B")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Starts/)).not.toBeInTheDocument();
  });
});

describe("PlanTrainingCard — program placed to start later", () => {
  it("names the program and its start date instead of claiming none exists", () => {
    render(
      <PlanTrainingCard training={null} upcomingTraining={QUEUED} onOpenTraining={vi.fn()} />
    );

    expect(screen.getByText("Strength Block B")).toBeInTheDocument();
    expect(screen.getByText(/Starts/)).toBeInTheDocument();
    expect(screen.getByText(/Mon, 27 Jul/)).toBeInTheDocument();
    expect(screen.queryByText(/No training plan/i)).not.toBeInTheDocument();
  });

  it("keeps the split / frequency / duration chips", () => {
    render(
      <PlanTrainingCard training={null} upcomingTraining={QUEUED} onOpenTraining={vi.fn()} />
    );

    expect(screen.getByText("Push/Pull/Legs")).toBeInTheDocument();
    expect(screen.getByText("5x/week")).toBeInTheDocument();
    expect(screen.getByText("6 weeks")).toBeInTheDocument();
  });

  it("shows no this-week, next-session or progression figures — none exist before day one", () => {
    render(
      <PlanTrainingCard training={null} upcomingTraining={QUEUED} onOpenTraining={vi.fn()} />
    );

    expect(screen.queryByText("This week")).not.toBeInTheDocument();
    expect(screen.queryByText("Next session")).not.toBeInTheDocument();
    expect(screen.queryByText("Progression")).not.toBeInTheDocument();
  });

  it("offers Open Training as a link, not as a fix-the-gap button", async () => {
    const user = userEvent.setup();
    const onOpenTraining = vi.fn();
    render(
      <PlanTrainingCard training={null} upcomingTraining={QUEUED} onOpenTraining={onOpenTraining} />
    );

    await user.click(screen.getByRole("button", { name: "Open Training" }));
    expect(onOpenTraining).toHaveBeenCalledTimes(1);
  });
});

describe("PlanTrainingCard — nothing assigned", () => {
  it("invites the coach to place a program", async () => {
    const user = userEvent.setup();
    const onOpenTraining = vi.fn();
    render(
      <PlanTrainingCard training={null} upcomingTraining={null} onOpenTraining={onOpenTraining} />
    );

    expect(screen.getByText("No training plan on the calendar")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Training" }));
    expect(onOpenTraining).toHaveBeenCalledTimes(1);
  });
});
