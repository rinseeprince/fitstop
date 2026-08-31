import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NutritionSection } from "./nutrition-section";
import type { DailyLog } from "@/types/daily-log";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";

const START = new Date("2026-08-24T00:00:00");
const END = new Date("2026-08-30T00:00:00"); // seven days

/** Three logged days: 2,479 kcal and 161g protein each, on a 2,154 / 159g target. */
const THREE_LOGGED_DAYS: DailyLog[] = ["2026-08-24", "2026-08-25", "2026-08-26"].map(
  (date) =>
    ({
      date,
      caloriesConsumed: 2479,
      targetCalories: 2154,
      proteinG: 161,
      targetProteinG: 159,
      carbsG: 229,
      targetCarbsG: 190,
      fatG: 103,
      targetFatG: 84,
    }) as DailyLog,
);

const nutrition: CheckInPeriodAdherence["nutrition"] = {
  rail: [],
  onTarget: 3,
  loggedDays: 3,
  pct: 43,
};

function renderCard(
  periodDays: number | null = 7,
  periodNutrition: typeof nutrition | null = nutrition,
) {
  return render(
    <NutritionSection
      dailyLogs={THREE_LOGGED_DAYS}
      contextStartDate={START}
      contextEndDate={END}
      fullWeekTarget={{ calories: 15077, proteinG: 1113, carbsG: 1330, fatG: 588 }}
      nutrition={periodNutrition}
      periodDays={periodDays}
    />,
  );
}

afterEach(cleanup);

describe("the totals", () => {
  it("keep the WHOLE period's target — that is the adherence question", () => {
    renderCard();

    expect(screen.getByText("7,437")).toBeInTheDocument();
    expect(screen.getByText(/of 15,077 kcal target/)).toBeInTheDocument();
    expect(screen.getByText(/3\/7 on target/)).toBeInTheDocument();
  });

  it("takes its day count from the server, not from the local date span", () => {
    // Both are 7 here; they diverge on a legacy row whose period resolves
    // differently. The server's list is what the on-target figure is indexed
    // against, so it is the one the fraction must agree with.
    renderCard(3);

    expect(screen.getByText(/3\/3 on target/)).toBeInTheDocument();
  });
});

describe("coverage vs adherence", () => {
  it("puts days LOGGED on the rail and days ON TARGET in the pill", () => {
    // Two different questions: how much of the week the client recorded, and
    // how much of what they recorded landed on target. Neither answers the
    // other, so neither slot may carry the other's number.
    //
    // The figures are deliberately DIFFERENT here — one on target out of three
    // logged. With the shared fixture's 3-and-3 both slots render the same
    // string and the assertion passes whichever number each is wired to.
    renderCard(7, { onTarget: 1, loggedDays: 3, pct: 14 });

    expect(screen.getByText("3 of 7 days logged")).toBeInTheDocument();
    expect(screen.getByText(/1\/7 on target/)).toBeInTheDocument();
  });

  it("still states coverage on a legacy row with no server figures", () => {
    // `nutrition` null drops the pill's on-target half; the rail is then the
    // only place the week's coverage is stated, and it must survive.
    renderCard(7, null);

    expect(screen.getByText("3 of 7 days logged")).toBeInTheDocument();
    expect(screen.queryByText(/on target/)).not.toBeInTheDocument();
  });
});

describe("the averages", () => {
  it("are per LOGGED day, so a tracked day is not diluted by an untracked one", () => {
    // 7,437 over three logged days is 2,479 — not 1,062, which is what
    // dividing by the calendar week produced.
    renderCard();

    expect(screen.getByText(/Avg 2,479 kcal \/ logged day/)).toBeInTheDocument();
    expect(screen.queryByText(/full week/)).not.toBeInTheDocument();
  });

  it("compares each macro against the target that applied on those same days", () => {
    // 161g against a 159g target: on the days they tracked, this client was
    // almost exactly on plan. Dividing the actual by seven while the target
    // came from a full week rendered it as 69g against 159g — a collapse that
    // never happened.
    const { container } = renderCard();

    // The value cell renders `{actual}g / {target}g` across several text nodes,
    // so it is matched on the row's own textContent.
    expect(container.textContent).toContain("161g / 159g");
    expect(container.textContent).not.toContain("69g");
  });
});
