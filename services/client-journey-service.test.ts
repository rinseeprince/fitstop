import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./client-blocks-service", () => ({ listBlocks: vi.fn() }));
vi.mock("./client-goals-service", () => ({ getCurrentGoals: vi.fn() }));
vi.mock("./measurements-service", () => ({ getMeasurementSeries: vi.fn() }));
vi.mock("./nutrition-plan-notes-service", () => ({
  listNutritionPlanNotesInRange: vi.fn(),
}));

import { listBlocks } from "./client-blocks-service";
import { getCurrentGoals } from "./client-goals-service";
import { getMeasurementSeries } from "./measurements-service";
import { listNutritionPlanNotesInRange } from "./nutrition-plan-notes-service";
import { getClientJourney } from "./client-journey-service";
import type { ClientBlock } from "@/types/client-blocks";
import type { DayValue } from "@/lib/measurements/day-values";
import type { MeasurementKey, MeasurementSource } from "@/lib/measurements/keys";

const CLIENT_ID = "client-1";
const TODAY = "2026-08-12";

const block = (overrides: Partial<ClientBlock> = {}): ClientBlock => ({
  id: "block-1",
  name: "Build",
  focus: null,
  targetWeightKg: null,
  startsOn: "2026-08-01",
  endsOn: "2026-08-28",
  archivedAt: null,
  ...overrides,
});

/** One day-value of the weight series: what rule 2 left standing for that day. */
const dayValue = (
  id: string,
  date: string,
  value: number,
  source: MeasurementSource = "check_in"
): DayValue => ({
  id,
  metricKey: "weight",
  value,
  date,
  recordedAt: `${date}T08:00:00+00:00`,
  updatedAt: `${date}T08:00:00+00:00`,
  measuredAt: null,
  source,
  sourceId: null,
  note: null,
});

/** The measurement-log read, answered per metric. Ascending by day is the
 *  series contract; the fixtures are written in that order. */
function mockWeightSeries(values: DayValue[]) {
  vi.mocked(getMeasurementSeries).mockResolvedValue(
    new Map<MeasurementKey, DayValue[]>([["weight", values]])
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentGoals).mockResolvedValue(null);
  vi.mocked(listNutritionPlanNotesInRange).mockResolvedValue([]);
  mockWeightSeries([]);
});

describe("getClientJourney", () => {
  it("decorates blocks with the client's today and derives per-state weight facts from the day-values", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block({ id: "past", name: "Base", startsOn: "2026-06-01", endsOn: "2026-06-28" }),
      block({ id: "current", name: "Build", startsOn: "2026-06-29", endsOn: "2026-08-23" }),
      block({ id: "future", name: "Cut", startsOn: "2026-08-24", endsOn: "2026-09-20" }),
    ]);
    mockWeightSeries([
      dayValue("m-0", "2026-05-20", 84.0),
      dayValue("m-1", "2026-06-01", 83.2), // exactly on the past block's start
      dayValue("m-2", "2026-06-27", 81.9),
      dayValue("m-3", "2026-07-15", 81.0),
    ]);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    expect(journey.clientToday).toBe(TODAY);
    const [past, current, future] = journey.blocks;
    expect(past).toMatchObject({
      state: "past",
      weeks: 4,
      weekOfTotal: null,
      startWeightKg: 83.2, // at-or-before includes the start date itself
      endWeightKg: 81.9, // latest inside the window, not latest overall
    });
    expect(current).toMatchObject({
      state: "current",
      startWeightKg: 81.9,
      endWeightKg: 81.0, // latest overall
    });
    expect(current.weekOfTotal).toEqual({ current: 7, total: 8 });
    expect(future).toMatchObject({
      state: "future",
      startWeightKg: null,
      endWeightKg: null,
    });
    // The last day-value, the series being ascending.
    expect(journey.currentWeightKg).toBe(81.0);
  });

  it("parity: reads the log's weight day-values — the same read the coach Journey and the Overview chart make", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block()]);
    mockWeightSeries([dayValue("m-1", "2026-08-02", 82.25)]);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    // One read, weight only — never the whole log re-filtered here.
    expect(getMeasurementSeries).toHaveBeenCalledTimes(1);
    expect(getMeasurementSeries).toHaveBeenCalledWith(CLIENT_ID, { metricKeys: ["weight"] });
    // Raw kg pass-through, unrounded — the renderer rounds.
    expect(journey.currentWeightKg).toBe(82.25);
    expect(journey.blocks[0].startWeightKg).toBeNull(); // nothing at or before 2026-08-01
    expect(journey.blocks[0].endWeightKg).toBe(82.25);
  });

  it("parity: a day-value of any source is in the series — a coach entry counts like a check-in", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block({ startsOn: "2026-06-01", endsOn: "2026-08-23" }),
    ]);
    // The day's standing value is the coach's correction (rule 2 already
    // decided that upstream); this read must not rank sources again.
    mockWeightSeries([dayValue("m-1", "2026-06-01", 89.8, "coach_entry")]);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    expect(journey.blocks[0].startWeightKg).toBe(89.8);
    expect(journey.currentWeightKg).toBe(89.8);
  });

  it("excludes archived blocks from the payload", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block({
        id: "archived",
        startsOn: "2026-05-01",
        endsOn: "2026-05-28",
        archivedAt: "2026-06-01T00:00:00.000Z",
      }),
      block({ id: "kept", startsOn: "2026-05-29", endsOn: "2026-08-23" }),
    ]);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    expect(journey.blocks.map((b) => b.id)).toEqual(["kept"]);
  });

  it("short-circuits with no series reads when every block is archived or none exist", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block({ archivedAt: "2026-06-01T00:00:00.000Z", endsOn: "2026-05-28" }),
    ]);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    expect(journey).toEqual({
      clientToday: TODAY,
      blocks: [],
      goal: { weightKg: null, deadline: null },
      currentWeightKg: null,
      currentBlockNotes: null,
    });
    expect(getMeasurementSeries).not.toHaveBeenCalled();
    expect(listNutritionPlanNotesInRange).not.toHaveBeenCalled();
  });

  it("resolves the goal through client_goals: weight and deadline in kg, untouched", async () => {
    vi.mocked(listBlocks).mockResolvedValue([]);
    vi.mocked(getCurrentGoals).mockResolvedValue({
      goalWeight: 85.5,
      goalDeadline: "2026-12-01",
      goalStartDate: "2026-06-01",
    } as never);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    expect(journey.goal).toEqual({ weightKg: 85.5, deadline: "2026-12-01" });
  });

  it("maintenance goal (no goal weight) ships weightKg null; missing deadline ships null", async () => {
    vi.mocked(listBlocks).mockResolvedValue([]);
    vi.mocked(getCurrentGoals).mockResolvedValue({
      goalBodyFatPercentage: 15,
    } as never);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    expect(journey.goal).toEqual({ weightKg: null, deadline: null });
  });

  // These pin the POLICY on the wire rather than in a renderer. GET
  // /api/client/journey is the RN contract: if elapsed-block notes crossed it
  // and the web component simply didn't render them, RN would have to
  // re-derive the same drop or the two client apps would disagree about what a
  // client is allowed to read. This is the suite that would have caught that.
  describe("currentBlockNotes — the visibility policy lives on the wire", () => {
    const NOTE = {
      id: "n1",
      effectiveOn: "2026-08-05",
      body: "Dropping calories 200.",
    };

    it("reads ONLY the current block's window — elapsed notes never leave the DB", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block({ id: "past", startsOn: "2026-06-01", endsOn: "2026-07-31" }),
        block({ id: "current", startsOn: "2026-08-01", endsOn: "2026-08-31" }),
      ]);
      vi.mocked(listNutritionPlanNotesInRange).mockResolvedValue([NOTE]);

      const journey = await getClientJourney(CLIENT_ID, TODAY);

      // Not "fetched everything and filtered" — the elapsed block's window is
      // never queried at all.
      expect(listNutritionPlanNotesInRange).toHaveBeenCalledTimes(1);
      expect(listNutritionPlanNotesInRange).toHaveBeenCalledWith(
        CLIENT_ID,
        "2026-08-01",
        "2026-08-31"
      );
      expect(journey.currentBlockNotes).toEqual({
        blockId: "current",
        notes: [NOTE],
      });
    });

    it("carries blockId so a client can ASSERT rather than infer the owner", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block({ id: "current", startsOn: "2026-08-01", endsOn: "2026-08-31" }),
      ]);
      vi.mocked(listNutritionPlanNotesInRange).mockResolvedValue([NOTE]);

      const journey = await getClientJourney(CLIENT_ID, TODAY);
      const current = journey.blocks.find((b) => b.state === "current");
      expect(journey.currentBlockNotes?.blockId).toBe(current?.id);
    });

    it("null when no block is current — distinct from a current block with none", async () => {
      // The distinction the nullable object buys, and the reason this is not a
      // bare array: `null` = policy has nothing to show; `{blockId, notes: []}`
      // = there is a current block and the coach wrote nothing. A bare `[]`
      // could not tell those apart.
      vi.mocked(listBlocks).mockResolvedValue([
        block({ id: "past", startsOn: "2026-06-01", endsOn: "2026-07-31" }),
      ]);

      const journey = await getClientJourney(CLIENT_ID, TODAY);

      expect(journey.currentBlockNotes).toBeNull();
      expect(listNutritionPlanNotesInRange).not.toHaveBeenCalled();
    });

    it("empty notes array when the current block has none", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block({ id: "current", startsOn: "2026-08-01", endsOn: "2026-08-31" }),
      ]);
      vi.mocked(listNutritionPlanNotesInRange).mockResolvedValue([]);

      const journey = await getClientJourney(CLIENT_ID, TODAY);
      expect(journey.currentBlockNotes).toEqual({ blockId: "current", notes: [] });
    });

    it("no block carries its own notes field — the shape IS the policy", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block({ id: "past", startsOn: "2026-06-01", endsOn: "2026-07-31" }),
        block({ id: "current", startsOn: "2026-08-01", endsOn: "2026-08-31" }),
      ]);
      vi.mocked(listNutritionPlanNotesInRange).mockResolvedValue([NOTE]);

      const journey = await getClientJourney(CLIENT_ID, TODAY);

      // Widening visibility to finished blocks must be a deliberate contract
      // change, not a loosened filter — so there is nowhere on a block to put
      // notes by accident.
      for (const b of journey.blocks) {
        expect(b).not.toHaveProperty("notes");
      }
    });
  });
});
