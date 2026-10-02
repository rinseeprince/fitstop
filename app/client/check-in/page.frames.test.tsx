import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Profiler } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import ClientCheckInPage from "./page";

// The wizard opening on a saved draft (CONVENTIONS §7 → "No frame disagrees"):
// a draft left on its last step, Habits, restored into a week that held no
// habit, so the wizard has four steps. Every commit shows a step: never a
// frame past the last step, with no step under the progress line.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock("@/hooks/use-client-check-in", () => ({
  useClientCheckIn: () => ({
    contextData: {
      clientInfo: { id: "client-1", name: "Alex", email: "a@x.com", coachName: "Coach", timezone: "Europe/London", logsOpenFrom: null },
      periodStart: "2026-09-24",
      periodEnd: "2026-09-30",
      periodDays: 7,
      form: { fields: ["notes", "weight", "photo_front", "prs"], questions: [] },
      habitWeek: { start: "2026-09-24", end: "2026-09-30", dates: [], habits: [], totals: { planned: 0, done: 0, met: 0 } },
    },
    isLoadingContext: false,
    contextError: null,
    nextDueDate: null,
    submitCheckIn: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-client-profile", () => ({
  CLIENT_PROFILE_KEY: "/api/client/me",
  useInvalidateClientProfile: () => vi.fn(),
}));
vi.mock("@/contexts/units-context", () => ({ useUnits: () => ({ preference: "metric" }) }));
vi.mock("@/components/check-in/step-subjective", () => ({ StepSubjective: () => <div data-step="feeling" /> }));
vi.mock("@/components/check-in/step-metrics", () => ({ StepMetrics: () => <div data-step="metrics" /> }));
vi.mock("@/components/check-in/step-photos", () => ({ StepPhotos: () => <div data-step="photos" /> }));
vi.mock("@/components/check-in/step-training", () => ({ StepTraining: () => <div data-step="training" /> }));
vi.mock("@/components/check-in/step-habits", () => ({ StepHabits: () => <div data-step="habits" /> }));
vi.mock("@/components/check-in/progress-indicator", () => ({ ProgressIndicator: () => null }));
vi.mock("@/components/client-portal/check-in/past-check-ins-section", () => ({
  PastCheckInsSection: () => null,
  PAST_CHECK_INS_SWR_KEY: "/api/client/check-ins?limit=10",
}));

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

let frames: (string | null)[] = [];
const snapshot = () => document.querySelector("[data-step]")?.getAttribute("data-step") ?? null;

beforeEach(() => {
  frames = [];
  const storage = memoryStorage();
  // Left on step 5, Habits, last week: this week has four steps and no habit.
  storage.setItem("check-in-form-data-client-check-in", JSON.stringify({ data: { notes: "Long week" }, step: 5, savedAt: "" }));
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the wizard opening on a saved draft", () => {
  it("lands a draft left past the last step on the last step, with no commit showing no step", async () => {
    render(
      <Profiler id="check-in" onRender={() => frames.push(snapshot())}>
        <ClientCheckInPage />
      </Profiler>
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /submit check-in/i })).toBeInTheDocument());
    expect(frames.at(-1)).toBe("training");
    expect(frames.every((step) => step !== null)).toBe(true);
  });
});
