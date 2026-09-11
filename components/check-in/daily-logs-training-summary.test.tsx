import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DailyLogsTrainingSummary } from "./daily-logs-training-summary";
import type { NutritionPeriodSummary } from "@/utils/nutrition-period-summary";

/** The smoke week's figures, as the context wire carries them. */
function summary(overrides: Partial<NutritionPeriodSummary> = {}): NutritionPeriodSummary {
  return {
    periodDays: 7,
    loggedDays: 7,
    targetedDays: 6,
    judgedDays: 6,
    loggedNoTargetDays: 1,
    onTarget: 6,
    over: 0,
    under: 0,
    daysOnTargetPct: 100,
    targetTotals: { calories: 14060, proteinG: 1020, carbsG: 1372, fatG: 499 },
    consumedOnTargetedDays: { calories: 14060, proteinG: 1020, carbsG: 1372, fatG: 499 },
    calorieAdherencePct: 100,
    periodVerdict: "hit",
    perJudgedDay: {
      consumed: { calories: 2343, proteinG: 170, carbsG: 229, fatG: 83 },
      target: { calories: 2343, proteinG: 170, carbsG: 229, fatG: 83 },
    },
    intakePerLoggedDay: { calories: 2309, proteinG: 173, carbsG: 225, fatG: 77 },
    netCaloriesOnJudgedDays: 0,
    ...overrides,
  };
}

afterEach(cleanup);

describe("the wizard's nutrition summary renders the kernel's figures", () => {
  it("days logged over the period, days on target over the targeted days, the averages over their own days", () => {
    render(<DailyLogsTrainingSummary dailyLogs={[]} nutritionSummary={summary()} />);

    expect(screen.getByText("7/7 days")).toBeInTheDocument();
    expect(screen.getByText("6/6 days")).toBeInTheDocument();
    expect(screen.queryByText("6/7 days")).not.toBeInTheDocument();
    expect(screen.getByText(/2309 cal/)).toBeInTheDocument();
    expect(screen.getByText(/2343 cal/)).toBeInTheDocument();
  });

  it("says No targets set when the coach prescribed nothing — never 0/7 in red", () => {
    render(
      <DailyLogsTrainingSummary
        dailyLogs={[]}
        nutritionSummary={summary({
          loggedDays: 1, targetedDays: 0, judgedDays: 0, loggedNoTargetDays: 1, onTarget: 0,
          daysOnTargetPct: null, targetTotals: null, consumedOnTargetedDays: null,
          calorieAdherencePct: null, periodVerdict: null, perJudgedDay: null,
          intakePerLoggedDay: { calories: 2100, proteinG: 190, carbsG: 200, fatG: 37 },
          netCaloriesOnJudgedDays: null,
        })}
      />
    );

    expect(screen.getByText("1/7 days")).toBeInTheDocument();
    expect(screen.getByText("No targets set")).toBeInTheDocument();
    expect(screen.queryByText("0/7 days")).not.toBeInTheDocument();
    expect(screen.getByText(/2100 cal/)).toBeInTheDocument();
    expect(screen.queryByText("Average Target")).not.toBeInTheDocument();
  });

  it("shows the net only over the judged days, and no nutrition block without the wire's figures", () => {
    const net = render(<DailyLogsTrainingSummary dailyLogs={[]} nutritionSummary={summary({ netCaloriesOnJudgedDays: 650 })} />);
    expect(screen.getByText(/\+650 cal/)).toBeInTheDocument();
    net.unmount();

    render(<DailyLogsTrainingSummary dailyLogs={[]} nutritionSummary={null} />);
    expect(screen.queryByText("Nutrition Summary")).not.toBeInTheDocument();
    expect(screen.getByText("Training Summary")).toBeInTheDocument();
  });
});
