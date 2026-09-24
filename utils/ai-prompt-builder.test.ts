import { describe, it, expect } from "vitest";
import { buildCheckInReviewPrompt } from "./ai-prompt-builder";
import { CHECK_IN_REVIEW_BRIEF } from "./ai-system-prompt";
import { describeReviewShape } from "./ai-analysis-format";
import { summarizeNutritionPeriod } from "./nutrition-period-summary";
import type { CheckInReviewInput } from "@/types/check-in-review-input";
import type { CheckIn, CheckInWithDetails, CheckInTrainingEventDetail } from "@/types/check-in";
import type { NutritionDay } from "@/types/schedule";
import type { DailyLog } from "@/types/daily-log";
import type { HabitBreakdown } from "@/types/coach-overview";

// A fixture week, Fri 11 to Thu 17 September 2026, built to hold one of
// everything the AI is given: a full workout with its exercise lines, a
// partial one with a note, two missed ones, food hit / under / over / logged
// with no target / not logged, wellness on four days with two day notes, a
// habit the client had all week and one added midweek, a weight with its
// change since the last check-in, a goal on track with a deadline and the
// drift note, the client's words and an answer to the coach's question.
const DATES = [
  "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14",
  "2026-09-15", "2026-09-16", "2026-09-17",
];

const checkIn = {
  id: "ci-1",
  clientId: "client-1",
  status: "pending",
  createdAt: "2026-09-17T08:30:00Z",
  updatedAt: "2026-09-17T08:30:00Z",
  periodStart: "2026-09-11",
  periodEnd: "2026-09-17",
  weight: 82.4,
  notes: "Tough week at work, slept badly midweek.",
  prs: "Hit 100 kg on squat",
  challenges: "Skipped Thursday, too tired",
  exerciseHighlights: [
    { exerciseName: "Barbell Back Squat", highlightType: "pr", weightValue: 100, reps: 5, details: "felt smooth" },
  ],
  customAnswers: [
    { questionId: "q-1", prompt: "How was your energy in the gym?", answer: "Low on Wednesday, fine otherwise" },
  ],
} as CheckInWithDetails;

const workouts: CheckInTrainingEventDetail[] = [
  { eventId: "e-1", date: "2026-09-11", sessionName: "Lower A", status: "completed", logStatus: "logged", completionQuality: "full", trainingSessionId: "s-1", sessionLogId: "log-1" },
  { eventId: "e-2", date: "2026-09-14", sessionName: "Upper A", status: "completed", logStatus: "logged", completionQuality: "partial", trainingSessionId: "s-2", sessionLogId: "log-2", notes: "Cut it short, shoulder niggle" },
  { eventId: "e-3", date: "2026-09-16", sessionName: "Lower B", status: "scheduled", logStatus: "not_logged", completionQuality: null, trainingSessionId: "s-3", sessionLogId: null },
  { eventId: "e-4", date: "2026-09-17", sessionName: "Upper B", status: "scheduled", logStatus: "not_logged", completionQuality: null, trainingSessionId: "s-4", sessionLogId: null },
];

const exerciseLines = new Map<string, string[]>([
  ["log-1", [
    "Barbell Back Squat — 3 of 3 working sets: Load (kg) 100, 100, 100 (target 95–100 kg); Reps 5, 5, 5 (target 5)",
    "Romanian Deadlift — 3 of 3 working sets: Load (kg) 80, 80, 80 (target 80 kg); Reps 8, 8, 7 (target 8; 1 of 3 below target)",
  ]],
  ["log-2", [
    "Barbell Bench Press — 2 of 3 working sets: Load (kg) 70, 70 (target 70 kg); Reps 6, 5 (target 6; 1 of 2 below target)",
  ]],
]);

function day(
  date: string,
  status: NutritionDay["status"],
  actual: [number, number, number, number] | null,
  target: [number, number, number, number] | null
): NutritionDay {
  return {
    date,
    dayOfWeek: "monday",
    status,
    actualCalories: actual?.[0] ?? null,
    actualProteinG: actual?.[1] ?? null,
    actualCarbsG: actual?.[2] ?? null,
    actualFatG: actual?.[3] ?? null,
    targetCalories: target?.[0] ?? null,
    targetProteinG: target?.[1] ?? null,
    targetCarbsG: target?.[2] ?? null,
    targetFatG: target?.[3] ?? null,
  };
}

const TARGET: [number, number, number, number] = [2400, 180, 250, 80];
const nutritionDays: NutritionDay[] = [
  day("2026-09-11", "hit", [2350, 170, 240, 75], TARGET),
  day("2026-09-12", "missed", [1800, 120, 200, 55], TARGET),
  day("2026-09-13", "not_logged", null, TARGET),
  day("2026-09-14", "partial", [2600, 190, 280, 85], TARGET),
  day("2026-09-15", "not_logged", null, TARGET),
  day("2026-09-16", "no_target", [2100, 150, 220, 70], null),
  day("2026-09-17", "not_logged", null, TARGET),
];

const habits: HabitBreakdown[] = [
  { id: "h-1", name: "Walk 10k steps", eligibleDays: 7, completedDays: 3, pct: 43, rail: [true, false, false, true, false, true, false] },
  { id: "h-2", name: "Water 3 L", eligibleDays: 4, completedDays: 2, pct: 50, rail: [null, null, null, true, false, true, false] },
];

const dailyLog = (date: string, fields: Partial<DailyLog>): DailyLog =>
  ({ id: `dl-${date}`, clientId: "client-1", date, createdAt: "", updatedAt: "", ...fields }) as DailyLog;

const dailyLogs: DailyLog[] = [
  dailyLog("2026-09-11", { mood: 4, energy: 7, sleep: 6, stress: 5, soreness: 3 }),
  dailyLog("2026-09-12", { mood: 3, sleep: 5, notes: "Long day" }),
  dailyLog("2026-09-14", { energy: 4, sleep: 4, stress: 8, notes: "Barely slept, shoulder sore" }),
  dailyLog("2026-09-16", { mood: 4, energy: 6, sleep: 7, stress: 4, soreness: 2 }),
];

const previous = { id: "ci-0", clientId: "client-1", createdAt: "2026-09-10T08:00:00Z", weight: 83 } as CheckIn;

const fixture: CheckInReviewInput = {
  checkIn,
  clientName: "Jane Doe",
  submittedOn: "2026-09-17",
  viewer: "metric",
  dates: DATES,
  loggedDates: ["2026-09-11", "2026-09-12", "2026-09-14", "2026-09-16"],
  workouts,
  exerciseLines,
  nutrition: { days: nutritionDays, summary: summarizeNutritionPeriod(nutritionDays) },
  habits,
  dailyLogs,
  comparison: {
    comparison: {
      previous,
      client: {
        id: "client-1",
        name: "Jane Doe",
        currentWeight: 82.4,
        unitPreference: "metric",
        nutritionPlanBaseWeightKg: 86,
        nutritionPlanEffectiveDate: "2026-09-01",
      },
      changes: { weight: -0.6, mood: 0, energy: -1, sleep: -1, stress: 2 },
      timeBetweenCheckIns: 7,
    },
    goalProgress: {
      weight: {
        goal: 78,
        startingWeight: 86,
        goalStartWeight: 86,
        position: { current: 82.4, remaining: 4.4, percentComplete: 45, status: "approaching", trend: "towards", paceStatus: "on_track" },
      },
      deadline: { date: "2026-11-30", daysRemaining: 74, isPastDeadline: false },
      goal: { name: "Lose weight", type: "lose_weight" },
      goalIsCurrent: true,
    },
  },
};

const EXPECTED = `Check-in review for Jane Doe
Week Friday 11 September 2026 to Thursday 17 September 2026. Submitted Thursday 17 September 2026, 7 days since the last check-in.

WEIGHT AND GOAL
Weight: 82.4 kg, -0.6 vs last check-in
Body fat: not tracked
Goal, weight: 78 kg from a start of 86 kg. On track · 4.4 kg to go
Deadline 30 Nov · 74 days
Weight has moved 3.6 kg since these targets took effect on 1 Sep - consider reviewing their nutrition plan.

THE WEEK IN FIGURES
Training: 2 of 4 sessions done (1 partial, 2 missed)
Food: 6,750 kcal of 14,400 kcal over the 6 days with a target: MISSED, 1/6 days on target. Average per logged day against its target: 2,250 kcal (target 2,400 kcal), protein 160 g (target 180 g), carbs 240 g (target 250 g), fat 72 g (target 80 g). 1 logged day had no target and is not counted.
Wellness, change since the last check-in: mood 0, energy -1, sleep -1, stress +2, soreness not compared
Habits: Walk 10k steps 3/7 days; Water 3 L 2/4 days

DAY BY DAY
Wellness scores: mood out of 5; energy, sleep, stress and soreness out of 10, where higher stress or soreness is worse.

Friday 11 September
Training: Lower A: logged, full
  Barbell Back Squat — 3 of 3 working sets: Load (kg) 100, 100, 100 (target 95–100 kg); Reps 5, 5, 5 (target 5)
  Romanian Deadlift — 3 of 3 working sets: Load (kg) 80, 80, 80 (target 80 kg); Reps 8, 8, 7 (target 8; 1 of 3 below target)
Food: 2,350 kcal eaten (protein 170 g, carbs 240 g, fat 75 g), target 2,400 kcal (protein 180 g, carbs 250 g, fat 80 g): hit target
Wellness: mood 4/5, energy 7/10, sleep 6/10, stress 5/10, soreness 3/10
Habits: Walk 10k steps, ticked

Saturday 12 September
Training: rest day, nothing scheduled
Food: 1,800 kcal eaten (protein 120 g, carbs 200 g, fat 55 g), target 2,400 kcal (protein 180 g, carbs 250 g, fat 80 g): missed, under target
Wellness: mood 3/5, sleep 5/10
Habits: Walk 10k steps, not ticked
Note: "Long day"

Sunday 13 September
Nothing logged.
Training: rest day, nothing scheduled
Food: nothing logged, target 2,400 kcal (protein 180 g, carbs 250 g, fat 80 g)
Wellness: nothing logged
Habits: Walk 10k steps, not ticked

Monday 14 September
Training: Upper A: logged, partial
  Note: "Cut it short, shoulder niggle"
  Barbell Bench Press — 2 of 3 working sets: Load (kg) 70, 70 (target 70 kg); Reps 6, 5 (target 6; 1 of 2 below target)
Food: 2,600 kcal eaten (protein 190 g, carbs 280 g, fat 85 g), target 2,400 kcal (protein 180 g, carbs 250 g, fat 80 g): partial, over target
Wellness: energy 4/10, sleep 4/10, stress 8/10
Habits: Walk 10k steps, ticked; Water 3 L, ticked
Note: "Barely slept, shoulder sore"

Tuesday 15 September
Nothing logged.
Training: rest day, nothing scheduled
Food: nothing logged, target 2,400 kcal (protein 180 g, carbs 250 g, fat 80 g)
Wellness: nothing logged
Habits: Walk 10k steps, not ticked; Water 3 L, not ticked

Wednesday 16 September
Training: Lower B: missed, not logged
Food: 2,100 kcal eaten (protein 150 g, carbs 220 g, fat 70 g), no target set
Wellness: mood 4/5, energy 6/10, sleep 7/10, stress 4/10, soreness 2/10
Habits: Walk 10k steps, ticked; Water 3 L, ticked

Thursday 17 September
Nothing logged.
Training: Upper B: missed, not logged
Food: nothing logged, target 2,400 kcal (protein 180 g, carbs 250 g, fat 80 g)
Wellness: nothing logged
Habits: Walk 10k steps, not ticked; Water 3 L, not ticked

CLIENT'S OWN WORDS
Reflection: "Tough week at work, slept badly midweek."
Wins: "Hit 100 kg on squat"
Challenges: "Skipped Thursday, too tired"
Exercise highlights:
  [PR] Barbell Back Squat @ 100 kg x 5, felt smooth
Your questions:
  Q: How was your energy in the gym?
  A: "Low on Wednesday, fine otherwise"

Return a JSON object with exactly these keys, in this order, and nothing else:
{
  "analysis": "your working, written first: think the week through here day by day and measure by measure before you write anything else; the coach never sees this field",
  "summary": "the full report, in several paragraphs under short plain section lines: what happened, what is most likely driving it and why, how the days and measures connect, and what you expect next week if nothing changes",
  "watchItems": [{ "type": "win | risk | trend | flag", "text": "the observation, its likely cause, and what it connects to" }],
  "themes": ["a short phrase in the client's own words"],
  "coachActions": [{ "priority": "high | medium | low", "text": "what to do, why, and how to raise it with the client" }],
  "clientMessage": "a message to Jane Doe, as long as it needs to be, ready to send"
}
Use as many items as the week warrants, or none.`;

describe("buildCheckInReviewPrompt — the fixture week, pinned", () => {
  it("assembles exactly this text for the fixture week", () => {
    expect(buildCheckInReviewPrompt(fixture)).toBe(EXPECTED);
  });

  it("writes 'nothing logged' wherever nothing was, and 'Nothing logged.' on a day with no log at all", () => {
    const prompt = buildCheckInReviewPrompt(fixture);
    const sunday = prompt.slice(prompt.indexOf("\nSunday 13 September\n"), prompt.indexOf("\nMonday 14 September\n"));
    expect(sunday).toContain("Nothing logged.");
    expect(sunday).toContain("Food: nothing logged, target 2,400 kcal");
    expect(sunday).toContain("Wellness: nothing logged");
    expect(sunday).toContain("Walk 10k steps, not ticked");
    // A day the client logged carries no such line, whatever it lacks.
    const saturday = prompt.slice(prompt.indexOf("\nSaturday 12 September\n"), prompt.indexOf("\nSunday 13 September\n"));
    expect(saturday).not.toContain("Nothing logged.");
    expect(saturday).toContain("Training: rest day, nothing scheduled");
  });

  it("gives a missed workout as its name only, and a logged one its exercises set by set", () => {
    const prompt = buildCheckInReviewPrompt(fixture);
    const wednesday = prompt.slice(prompt.indexOf("\nWednesday 16 September\n"), prompt.indexOf("\nThursday 17 September\n"));
    expect(wednesday).toContain("Training: Lower B: missed, not logged");
    expect(wednesday).not.toContain("working sets");
    const friday = prompt.slice(prompt.indexOf("\nFriday 11 September\n"), prompt.indexOf("\nSaturday 12 September\n"));
    expect(friday).toContain("Training: Lower A: logged, full\n  Barbell Back Squat — 3 of 3 working sets");
  });

  it("says when a logged workout recorded no sets, rather than leaving an empty block", () => {
    const prompt = buildCheckInReviewPrompt({ ...fixture, exerciseLines: new Map() });
    expect(prompt).toContain("Training: Lower A: logged, full (no sets recorded)");
    expect(prompt).toContain("Training: Upper A: logged, partial (no sets recorded)\n  Note: \"Cut it short, shoulder niggle\"");
  });

  it("never counts the days logged", () => {
    const prompt = buildCheckInReviewPrompt(fixture);
    expect(prompt).not.toMatch(/\d+ of \d+ days logged/i);
    expect(prompt).not.toMatch(/days logged/i);
  });

  it("counts the week's sessions once, through summariseTraining, partials in the numerator", () => {
    expect(buildCheckInReviewPrompt(fixture)).toContain("Training: 2 of 4 sessions done (1 partial, 2 missed)");
  });

  it("writes the weight and the goal in the coach's units", () => {
    const prompt = buildCheckInReviewPrompt({ ...fixture, viewer: "imperial" });
    expect(prompt).toContain("Weight: 181.7 lbs, -0.6 vs last check-in");
    expect(prompt).toContain("Goal, weight: 172 lbs from a start of 189.6 lbs. On track · 9.7 lbs to go");
  });

  it("states a goal with no target as the goal itself — its type and its deadline — never as none set (commit 8d4)", () => {
    const prompt = buildCheckInReviewPrompt({
      ...fixture,
      comparison: {
        ...fixture.comparison!,
        goalProgress: {
          deadline: { date: "2026-10-24", daysRemaining: 37, isPastDeadline: false },
          goal: { name: "Hyrox Manchester", type: "event_prep" },
          goalIsCurrent: true,
        },
      },
    });
    expect(prompt).toContain(
      "Goal: Hyrox Manchester (Event prep), with no target to track progress against\nEvent day 24 Oct · 37 days\n"
    );
    expect(prompt).not.toContain("none set");
  });

  it("says none was set only when no goal was in force on the check-in's day", () => {
    const prompt = buildCheckInReviewPrompt({
      ...fixture,
      comparison: { ...fixture.comparison!, goalProgress: { goal: null, goalIsCurrent: false } },
    });
    expect(prompt).toContain("Goal: none set as of this check-in");
  });

  it("degrades to what it has: no comparison, no loggedDates, nothing typed", () => {
    const prompt = buildCheckInReviewPrompt({
      ...fixture,
      checkIn: { ...checkIn, notes: undefined, prs: undefined, challenges: undefined, exerciseHighlights: [], customAnswers: [] },
      comparison: null,
      loggedDates: null,
      habits: [],
    });
    expect(prompt).toContain("Submitted Thursday 17 September 2026.");
    expect(prompt).toContain("Weight: 82.4 kg\nBody fat: not tracked\nGoal: not available");
    expect(prompt).not.toContain("Nothing logged.");
    expect(prompt).not.toContain("Habits:");
    expect(prompt).not.toContain("Wellness, change");
    expect(prompt).toContain("CLIENT'S OWN WORDS\nThe client wrote nothing this check-in.");
  });

  it("says when nothing was prescribed and when no food was logged, never 0 of 0", () => {
    const empty: NutritionDay[] = DATES.map((date) => day(date, "not_logged", null, TARGET));
    const prompt = buildCheckInReviewPrompt({
      ...fixture,
      workouts: [],
      nutrition: { days: empty, summary: summarizeNutritionPeriod(empty) },
    });
    expect(prompt).toContain("Training: no sessions were prescribed this week");
    expect(prompt).toContain("Food: nothing logged on any day; a target was set on 7 of the 7 days");
  });
});

describe("the brief and the shape carry no rule and no count", () => {
  it("the brief asks for the full report: causes, connections, what to expect, the reasoning, at length", () => {
    expect(CHECK_IN_REVIEW_BRIEF).toContain("experienced coach");
    expect(CHECK_IN_REVIEW_BRIEF).toContain("not a summary");
    expect(CHECK_IN_REVIEW_BRIEF).toContain("what is most likely driving each thing you see and why");
    expect(CHECK_IN_REVIEW_BRIEF).toContain("what you expect to happen next week if nothing changes");
    expect(CHECK_IN_REVIEW_BRIEF).toContain("reasoning behind every recommendation");
    expect(CHECK_IN_REVIEW_BRIEF).toContain("as a question");
    expect(CHECK_IN_REVIEW_BRIEF).toContain("a few sentences is not a review");
    expect(CHECK_IN_REVIEW_BRIEF).toContain("British English");
    expect(CHECK_IN_REVIEW_BRIEF).toContain("injury, persistent pain or disordered eating");
    expect(CHECK_IN_REVIEW_BRIEF).not.toMatch(/logged notes on only/i);
    expect(CHECK_IN_REVIEW_BRIEF).not.toMatch(/never infer/i);
    expect(CHECK_IN_REVIEW_BRIEF).not.toMatch(/\d+ to \d+/);
  });

  it("the shape names the card's parts and sets no length", () => {
    const shape = describeReviewShape("Jane");
    for (const key of ["analysis", "summary", "watchItems", "themes", "coachActions", "clientMessage"]) {
      expect(shape).toContain(`"${key}"`);
    }
    expect(shape).not.toMatch(/\d+ to \d+/);
    expect(shape).not.toMatch(/sentences/);
    expect(shape).not.toMatch(/up to \d/);
  });
});
