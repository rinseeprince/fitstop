import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NutritionSection } from "./nutrition-section";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";

type Nutrition = CheckInPeriodAdherence["nutrition"];

/**
 * The smoke week (owner, 2026-09-11): six days logged on target, and today
 * logged with no target after the plan was deleted. The kernel's figures for
 * it — this card renders them and counts nothing.
 */
function summary(overrides: Partial<Nutrition> = {}): Nutrition {
  return {
    rail: [],
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

describe("the figures come from the kernel, over one day set each", () => {
  it("the total, the pill and the averages are over the targeted and judged days — the untargeted day moves no number", () => {
    const { container } = render(<NutritionSection nutrition={summary()} />);

    expect(screen.getByText("14,060")).toBeInTheDocument();
    expect(screen.getByText(/of 14,060 kcal target/)).toBeInTheDocument();
    expect(screen.getByText(/HIT · 6\/6 on target/)).toBeInTheDocument();
    expect(screen.queryByText(/6\/7/)).not.toBeInTheDocument();
    expect(screen.getByText(/Avg 2,343 kcal \/ day/)).toBeInTheDocument();
    // 170 g on every judged day, against 170 g — never 173 against 146.
    expect(container.textContent).toContain("170g / 170g");
    expect(container.textContent).not.toContain("146g");
  });

  it("names the logged day that had no target, so the coach sees where it went", () => {
    render(<NutritionSection nutrition={summary()} />);

    expect(screen.getByText(/1 logged day had no target and is not counted/)).toBeInTheDocument();
  });

  it("counts a skipped targeted day against the client", () => {
    // Three of seven prescribed days logged, each on target: 3/7, a MISSED
    // week, an intake average over the three days with data.
    render(
      <NutritionSection
        nutrition={summary({
          loggedDays: 3,
          targetedDays: 7,
          judgedDays: 3,
          loggedNoTargetDays: 0,
          onTarget: 3,
          daysOnTargetPct: 43,
          targetTotals: { calories: 14000, proteinG: 1050, carbsG: 1400, fatG: 420 },
          consumedOnTargetedDays: { calories: 6000, proteinG: 450, carbsG: 600, fatG: 180 },
          calorieAdherencePct: 42.9,
          periodVerdict: "missed",
          perJudgedDay: {
            consumed: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
            target: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
          },
          intakePerLoggedDay: { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
        })}
      />
    );

    expect(screen.getByText("6,000")).toBeInTheDocument();
    expect(screen.getByText(/of 14,000 kcal target/)).toBeInTheDocument();
    expect(screen.getByText(/MISSED · 3\/7 on target/)).toBeInTheDocument();
    expect(screen.getByText(/Avg 2,000 kcal \/ day/)).toBeInTheDocument();
    expect(screen.queryByText(/had no target/)).not.toBeInTheDocument();
  });

  it("shows no total, no pill and no bar when the coach prescribed nothing — never 0 of 0, never MISSED over nothing", () => {
    render(
      <NutritionSection
        nutrition={summary({
          loggedDays: 1,
          targetedDays: 0,
          judgedDays: 0,
          loggedNoTargetDays: 1,
          onTarget: 0,
          daysOnTargetPct: null,
          targetTotals: null,
          consumedOnTargetedDays: null,
          calorieAdherencePct: null,
          periodVerdict: null,
          perJudgedDay: null,
          intakePerLoggedDay: { calories: 2100, proteinG: 190, carbsG: 200, fatG: 37 },
          netCaloriesOnJudgedDays: null,
        })}
      />
    );

    expect(
      screen.getByText(/No target was set on any day of this period\. 1 day logged, avg 2,100 kcal \/ day\./)
    ).toBeInTheDocument();
    expect(screen.queryByText(/on target/)).not.toBeInTheDocument();
    expect(screen.queryByText(/MISSED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/kcal target/)).not.toBeInTheDocument();
  });

  it("renders nothing when nothing was logged, and nothing on a legacy row", () => {
    const empty = render(<NutritionSection nutrition={summary({ loggedDays: 0, judgedDays: 0, onTarget: 0 })} />);
    expect(empty.container.firstChild).toBeNull();
    empty.unmount();

    const legacy = render(<NutritionSection nutrition={null} />);
    expect(legacy.container.firstChild).toBeNull();
  });
});

describe("the card computes nothing", () => {
  // The defect this guards: the card once summed calories over the days with
  // a target and macros over the days a macro was logged, and read 173 g
  // against 146 g for a client on 170 g every day. It takes no rows now.
  it("takes no log rows and folds no figure of its own", () => {
    const source = readFileSync(join(process.cwd(), "components/check-in/nutrition-section.tsx"), "utf8");
    expect(source).not.toMatch(/dailyLogs|DailyLog|\.reduce\(|fullWeekTarget|periodDays/);
  });
});
