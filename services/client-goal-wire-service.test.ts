import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./client-goals-service", () => ({ getGoalForDate: vi.fn() }));
vi.mock("./measurements-service", () => ({
  getCurrentMeasurements: vi.fn(),
  getReadingsOnDay: vi.fn(),
}));

import { getGoalForDate } from "./client-goals-service";
import { getCurrentMeasurements, getReadingsOnDay } from "./measurements-service";
import { getClientGoalWire } from "./client-goal-wire-service";
import type { GoalOnDay } from "@/types/client-goals";

const CLIENT_ID = "client-1";
const TODAY = "2026-08-12";

/** The goal in force on a day, as the goals service returns it. */
const goalOnDay = (overrides: Partial<GoalOnDay> = {}): GoalOnDay => ({
  id: "goal-now",
  clientId: CLIENT_ID,
  name: "Lose weight",
  type: "lose_weight",
  targetWeight: null,
  targetBodyFatPercentage: null,
  description: null,
  startsOn: "2026-07-20",
  source: "coach",
  setBy: "coach-1",
  createdAt: "2026-07-20T09:00:00+00:00",
  updatedAt: "2026-07-20T09:00:00+00:00",
  deadline: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGoalForDate).mockResolvedValue(null);
  vi.mocked(getCurrentMeasurements).mockResolvedValue({});
  vi.mocked(getReadingsOnDay).mockResolvedValue({});
});

describe("getClientGoalWire", () => {
  it("ships the goal in force on the client's today: its weight target and that day's deadline, in kg, untouched", async () => {
    vi.mocked(getGoalForDate).mockResolvedValue(
      goalOnDay({ targetWeight: 85.5, deadline: "2026-12-01" })
    );

    const { goal } = await getClientGoalWire(CLIENT_ID, TODAY);

    // Asked with the client's today — the day this read is anchored on — so a
    // goal planned for tomorrow is not the one shipped.
    expect(getGoalForDate).toHaveBeenCalledWith(CLIENT_ID, TODAY);
    expect(goal).toMatchObject({ weightKg: 85.5, deadline: "2026-12-01" });
  });

  it("a goal with no weight target ships weightKg null; no deadline ships null", async () => {
    vi.mocked(getGoalForDate).mockResolvedValue(
      goalOnDay({ type: "recomposition", targetBodyFatPercentage: 15 })
    );

    const { goal } = await getClientGoalWire(CLIENT_ID, TODAY);

    expect(goal).toMatchObject({ weightKg: null, deadline: null, bodyFatPercentage: 15 });
  });

  // The client's goal card (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d2). The
  // newest readings are the profile's, so they are not read here.
  it("ships what the goal card shows, with the readings on the goal's start day, and nothing else", async () => {
    vi.mocked(getGoalForDate).mockResolvedValue(
      goalOnDay({
        name: "Lean out",
        targetWeight: 78.6,
        targetBodyFatPercentage: 19.4,
        description: "Feel fit for the wedding",
        startsOn: "2026-07-06",
        deadline: "2026-11-27",
      })
    );
    vi.mocked(getReadingsOnDay).mockResolvedValue({
      weight: { id: "r-4", metricKey: "weight", value: 86.1, date: "2026-07-05", source: "coach_entry" },
    });

    expect(await getClientGoalWire(CLIENT_ID, TODAY)).toEqual({
      goal: {
        weightKg: 78.6,
        deadline: "2026-11-27",
        name: "Lean out",
        type: "lose_weight",
        bodyFatPercentage: 19.4,
        description: "Feel fit for the wedding",
        startReadings: { weightKg: 86.1, bodyFatPercentage: null },
      },
    });
    // The start readings are the goal's own start day's.
    expect(getReadingsOnDay).toHaveBeenCalledWith(CLIENT_ID, "2026-07-06");
    expect(getCurrentMeasurements).not.toHaveBeenCalled();
  });

  it("with no goal in force, every field is null and no reading is read", async () => {
    expect(await getClientGoalWire(CLIENT_ID, TODAY)).toEqual({
      goal: {
        weightKg: null,
        deadline: null,
        name: null,
        type: null,
        bodyFatPercentage: null,
        description: null,
        startReadings: null,
      },
    });
    expect(getReadingsOnDay).not.toHaveBeenCalled();
  });
});
