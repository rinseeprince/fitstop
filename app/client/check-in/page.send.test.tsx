import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import ClientCheckInPage from "./page";
import type { ClientHabitWeek, HabitDayFacts } from "@/types/habits";

// Send waits for every write on its way, the Training step's and the Habits
// step's alike (docs/HABITS-REBUILD-PLAN.md §6, commit 6): the server derives
// the week's figures and freezes the check-in's copy from the client's logs
// when the check-in is sent, so a workout logged on the Training step and a
// habit entry made on the Habits step must both have landed first. The page,
// its pending writes and the real Habits step run here over a real SWR cache;
// only the network, the context read and the Training step's checklist are
// stubbed — the checklist hands the page a workout log as it does in the app.

const { submitCheckIn, context } = vi.hoisted(() => ({
  submitCheckIn: vi.fn(),
  context: { value: null as unknown },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock("@/hooks/use-client-check-in", () => ({
  useClientCheckIn: () => ({
    contextData: context.value,
    isLoadingContext: false,
    contextError: null,
    nextDueDate: null,
    submitCheckIn,
  }),
}));
// units-context and the profile hook import the browser Supabase client, which
// throws without env vars; the page only needs the preference and the clear.
vi.mock("@/hooks/use-client-profile", () => ({
  CLIENT_PROFILE_KEY: "/api/client/me",
  useInvalidateClientProfile: () => vi.fn(),
}));
vi.mock("@/contexts/units-context", () => ({ useUnits: () => ({ preference: "metric" }) }));
vi.mock("@/components/check-in/step-subjective", () => ({ StepSubjective: () => <div data-testid="step-feeling" /> }));
vi.mock("@/components/check-in/progress-indicator", () => ({ ProgressIndicator: () => null }));
vi.mock("@/components/check-in/form-success", () => ({ FormSuccess: () => <div data-testid="form-success" /> }));
vi.mock("@/components/client-portal/check-in/past-check-ins-section", () => ({
  PastCheckInsSection: () => null,
  PAST_CHECK_INS_SWR_KEY: "/api/client/check-ins?limit=10",
}));
vi.mock("@/components/check-in/step-training", () => ({
  StepTraining: ({ onLogEvent }: { onLogEvent: (eventId: string, payload: { completionQuality: "full" }) => Promise<void> }) => (
    <button type="button" onClick={() => void onLogEvent("event-1", { completionQuality: "full" }).catch(() => {})}>
      Log Upper A
    </button>
  ),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const DATES = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
const day = (date: string, facts: Partial<HabitDayFacts> = {}): HabitDayFacts => ({
  date, covered: true, planned: true, target: null, edited: false, versionId: "v", timesPerWeek: null, entry: null, met: false, ...facts,
});
const HABIT_WEEK: ClientHabitWeek = {
  start: DATES[0],
  end: DATES[6],
  dates: DATES,
  habits: [
    {
      habit: { id: "walk", name: "Walk", howTo: null, measure: "tick", unit: null, direction: null },
      words: { schedule: "Every day", target: null },
      days: DATES.map((date) => day(date)),
      figures: { planned: 7, done: 0, met: 0 },
    },
  ],
  totals: { planned: 7, done: 0, met: 0 },
};

/** The workout log, held until the test answers it. */
let answerWorkout: () => void;
/** Each habit entry write, held until the test answers it, by the day it is for. */
let habitWrites: { date: string; answer: () => void }[];

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wednesday evening, London: the client checks in on their check-in day.
  vi.setSystemTime(new Date("2026-09-30T18:00:00Z"));
  vi.stubGlobal("localStorage", memoryStorage());
  submitCheckIn.mockReset().mockResolvedValue({ success: true });
  context.value = {
    clientInfo: {
      id: "client-1",
      name: "Alex",
      email: "alex@example.com",
      coachName: "Coach",
      timezone: "Europe/London",
      logsOpenFrom: "2026-09-24",
    },
    trainingEventDetails: [],
    dailyLogs: [],
    periodStart: DATES[0],
    periodEnd: DATES[6],
    periodDays: 7,
    // Every field off: Feeling, Training, then Habits.
    form: { fields: [], questions: [] },
    habitWeek: HABIT_WEEK,
  };
  habitWrites = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url === "/api/client/training/events/event-1/log") {
        return new Promise<Response>((resolve) => (answerWorkout = () => resolve(reply({ success: true }))));
      }
      if (method === "PUT" && url.startsWith("/api/client/habits/walk/days/")) {
        const date = url.split("/").pop()!;
        return new Promise<Response>((resolve) => {
          habitWrites.push({
            date,
            answer: () =>
              resolve(
                reply({
                  success: true,
                  data: {
                    day: day(date, { entry: { done: true, value: null, note: null }, met: true }),
                    week: { planned: 7, done: habitWrites.length, met: habitWrites.length, start: DATES[0], end: DATES[6] },
                  },
                })
              ),
          });
        });
      }
      return Promise.resolve(reply({ success: true, data: HABIT_WEEK }));
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Lets the writes, and anything waiting on them, run. */
async function flushed() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

/** Logs the missed workout on Training, ticks Monday's walk on Habits, and presses Submit: both writes still on their way. */
async function sendWithBothWritesOut() {
  const user = userEvent.setup();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      <ClientCheckInPage />
    </SWRConfig>
  );

  // Feeling, then Training: the client logs the workout they missed.
  expect(screen.getByTestId("step-feeling")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /next/i }));
  await user.click(screen.getByRole("button", { name: "Log Upper A" }));

  // Then Habits, last: the client ticks Monday's walk.
  await user.click(screen.getByRole("button", { name: /next/i }));
  await user.click(screen.getByRole("checkbox", { name: "Walk, Mon 28 Sept, planned" }));
  await waitFor(() => expect(habitWrites).toHaveLength(1));

  await user.click(screen.getByRole("button", { name: /submit check-in/i }));
  await flushed();
  expect(submitCheckIn).not.toHaveBeenCalled();
  // While it sends, the step takes no entry that could race the week's freeze.
  expect(screen.getByRole("checkbox", { name: "Walk, Tue 29 Sept, planned" })).toBeDisabled();
}

describe("Send waits for every pending habit and training write", () => {
  it("waits for the habit ticked on the Habits step once the workout has landed", async () => {
    await sendWithBothWritesOut();

    // The workout lands first: the habit is still on its way.
    answerWorkout();
    await flushed();
    expect(submitCheckIn).not.toHaveBeenCalled();

    habitWrites[0].answer();
    await waitFor(() => expect(submitCheckIn).toHaveBeenCalledTimes(1));
  });

  it("waits for the workout logged on the Training step once the habit has landed", async () => {
    await sendWithBothWritesOut();

    // The habit lands first: the workout is still on its way.
    habitWrites[0].answer();
    await flushed();
    expect(submitCheckIn).not.toHaveBeenCalled();

    answerWorkout();
    await waitFor(() => expect(submitCheckIn).toHaveBeenCalledTimes(1));
  });

  it("waits for a habit entry still in line behind another write of the same habit", async () => {
    const user = userEvent.setup();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
        <ClientCheckInPage />
      </SWRConfig>
    );
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    // Monday, then Tuesday: Tuesday's write waits in line for Monday's answer.
    await user.click(screen.getByRole("checkbox", { name: "Walk, Mon 28 Sept, planned" }));
    await user.click(screen.getByRole("checkbox", { name: "Walk, Tue 29 Sept, planned" }));
    await waitFor(() => expect(habitWrites).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /submit check-in/i }));
    await flushed();
    expect(habitWrites).toHaveLength(1);

    habitWrites[0].answer();
    await waitFor(() => expect(habitWrites).toHaveLength(2));
    await flushed();
    expect(submitCheckIn).not.toHaveBeenCalled();

    habitWrites[1].answer();
    await waitFor(() => expect(submitCheckIn).toHaveBeenCalledTimes(1));
    expect(habitWrites.map((write) => write.date)).toEqual(["2026-09-28", "2026-09-29"]);
  });
});
