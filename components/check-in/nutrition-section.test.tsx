import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NutritionSection } from "./nutrition-section";
import type { CheckInPeriodAdherence } from "@/types/coach-overview";
import type { NutritionDay } from "@/types/schedule";

type Nutrition = CheckInPeriodAdherence["nutrition"];

const row = (
  date: string,
  status: NutritionDay["status"],
  eaten: [number, number, number, number] | null,
  target: [number, number, number, number] | null
): NutritionDay => ({
  date,
  dayOfWeek: "monday",
  status,
  targetCalories: target?.[0] ?? null,
  targetProteinG: target?.[1] ?? null,
  targetCarbsG: target?.[2] ?? null,
  targetFatG: target?.[3] ?? null,
  actualCalories: eaten?.[0] ?? null,
  actualProteinG: eaten?.[1] ?? null,
  actualCarbsG: eaten?.[2] ?? null,
  actualFatG: eaten?.[3] ?? null,
});

const TARGET: [number, number, number, number] = [2343, 170, 229, 83];

/**
 * The smoke week's frozen rows (Sat 5 – Fri 11 Sep): six days within 50 kcal
 * of 2,343, and Friday logged with no target. Their sums are the summary's
 * figures below — 14,060 kcal on the targeted days, 2,309 a day over seven.
 */
const WEEK: NutritionDay[] = [
  row("2026-09-05", "hit", [2351, 165, 225, 79], TARGET),
  row("2026-09-06", "hit", [2320, 168, 231, 84], TARGET),
  row("2026-09-07", "hit", [2368, 171, 228, 82], TARGET),
  row("2026-09-08", "hit", [2339, 174, 234, 87], TARGET),
  row("2026-09-09", "hit", [2301, 169, 222, 81], TARGET),
  row("2026-09-10", "hit", [2381, 173, 232, 86], TARGET),
  row("2026-09-11", "no_target", [2105, 176, 198, 61], null),
];

/**
 * The smoke week (owner, 2026-09-11): six days logged on target, and today
 * logged with no target after the plan was deleted. The kernel's figures for
 * it — this card renders them and counts nothing.
 */
function summary(overrides: Partial<Nutrition> = {}): Nutrition {
  return {
    rail: [],
    days: WEEK,
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

describe("the week day by day — a table of the copy's rows, worded from their frozen standing", () => {
  const rowsOf = () => screen.getAllByTestId("nutrition-day-row");
  /** Each figure cell's two lines, [target, eaten], for Kcal, Protein, Carbs and Fats. */
  const figures = (row: HTMLElement) =>
    within(row)
      .getAllByRole("cell")
      .slice(1, 5)
      .map((cell) => [...cell.children].map((line) => line.textContent));
  const dayCell = (row: HTMLElement) => within(row).getAllByRole("cell")[0].textContent;

  it("lists one line per frozen day under the summary, in the copy's order, the units named once in the headings", () => {
    const { container } = render(<NutritionSection nutrition={summary()} />);
    const text = container.textContent ?? "";

    expect(rowsOf().map(dayCell)).toEqual(["Sat 5", "Sun 6", "Mon 7", "Tue 8", "Wed 9", "Thu 10", "Fri 11"]);
    expect(text.indexOf("Avg macros / day")).toBeLessThan(text.indexOf("Sat 5"));
    for (const heading of ["Day", "Kcal", "Protein (g)", "Carbs (g)", "Fats (g)"]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getAllByText("On target")).toHaveLength(6);
    expect(screen.getByText("No target")).toBeInTheDocument();
  });

  it("puts each day's target over what was eaten, figure by figure, with no unit in the cells", () => {
    render(<NutritionSection nutrition={summary()} />);
    const rows = rowsOf();

    expect(figures(rows[0])).toEqual([["2,343", "2,351"], ["170", "165"], ["229", "225"], ["83", "79"]]);
    expect(figures(rows[5])).toEqual([["2,343", "2,381"], ["170", "173"], ["229", "232"], ["83", "86"]]);
    expect(rows[0].textContent).not.toMatch(/kcal|\dg\b/);
  });

  it("words the day from the standing the check-in froze, never from its numbers", () => {
    // Frozen as on target with figures today's thresholds would call missed:
    // a sent week never rewords itself.
    const frozen = [row("2026-09-05", "hit", [1500, 110, 140, 50], [2300, 172, 241, 71])];
    render(<NutritionSection nutrition={summary({ days: frozen })} />);

    expect(screen.getByText("On target")).toBeInTheDocument();
    expect(screen.queryByText("Missed")).not.toBeInTheDocument();
  });

  it("keeps a blank target line where no target covered the day, and a dash where nothing was eaten", () => {
    const days = [
      row("2026-09-06", "no_target", [1870, 148, 190, 62], null),
      row("2026-09-07", "not_logged", null, [2300, 172, 241, 71]),
      row("2026-09-08", "no_target", null, null),
    ];
    render(<NutritionSection nutrition={summary({ days })} />);
    const [eatenOnly, targetOnly, neither] = rowsOf();
    const blank = " ";

    expect(figures(eatenOnly)).toEqual([[blank, "1,870"], [blank, "148"], [blank, "190"], [blank, "62"]]);
    expect(figures(targetOnly)).toEqual([["2,300", "—"], ["172", "—"], ["241", "—"], ["71", "—"]]);
    expect(figures(neither)).toEqual([[blank, "—"], [blank, "—"], [blank, "—"], [blank, "—"]]);
    expect(within(eatenOnly).getByText("No target")).toBeInTheDocument();
    expect(within(targetOnly).getByText("No food logged")).toBeInTheDocument();
    expect(within(neither).getByText("No target")).toBeInTheDocument();
  });

  it("colours each word the adherence rail's way: teal, amber, rose, the faint tint, none", () => {
    const days = [
      row("2026-09-05", "hit", [2260, 169, 236, 70], [2300, 172, 241, 71]),
      row("2026-09-06", "partial", [2140, 161, 219, 66], [2300, 172, 241, 71]),
      row("2026-09-07", "missed", [1690, 133, 168, 58], [2300, 172, 241, 71]),
      row("2026-09-08", "not_logged", null, [2300, 172, 241, 71]),
      row("2026-09-09", "no_target", [1870, 148, 190, 62], null),
    ];
    render(<NutritionSection nutrition={summary({ days })} />);
    const [hit, partial, missed, notLogged, noTarget] = rowsOf();

    expect(within(hit).getByText("On target").className).toContain("text-[#0d9488]");
    expect(within(partial).getByText("Partial").className).toContain("text-[#d97706]");
    expect(within(missed).getByText("Missed").className).toContain("text-[#c06060]");
    expect(within(notLogged).getByText("No food logged").className).toContain("bg-[rgba(13,148,136,0.04)]");
    expect(within(noTarget).getByText("No target").className).not.toContain("bg-");
  });
});

describe("the card computes nothing", () => {
  // The defect this guards: the card once summed calories over the days with
  // a target and macros over the days a macro was logged, and read 173 g
  // against 146 g for a client on 170 g every day. It takes no rows now, and
  // it judges no day of its own: a row's word is the standing the check-in
  // froze, so the per-day verdict and any classifier of a day stay out.
  it("takes no log rows, folds no figure of its own and judges no day — the card or its table", () => {
    for (const file of ["nutrition-section.tsx", "nutrition-days-table.tsx"]) {
      const source = readFileSync(join(process.cwd(), "components/check-in", file), "utf8");
      expect(source).not.toMatch(/dailyLogs|DailyLog|\.reduce\(|fullWeekTarget|periodDays|nutrition-verdict|classifyDay/);
    }
  });
});
