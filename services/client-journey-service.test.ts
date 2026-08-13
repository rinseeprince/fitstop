import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("./client-blocks-service", () => ({ listBlocks: vi.fn() }));
vi.mock("./client-goals-service", () => ({ getCurrentGoals: vi.fn() }));
vi.mock("./metric-entries-service", () => ({ listMetricEntries: vi.fn() }));
vi.mock("./nutrition-plan-notes-service", () => ({
  listNutritionPlanNotesInRange: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { listBlocks } from "./client-blocks-service";
import { getCurrentGoals } from "./client-goals-service";
import { listMetricEntries } from "./metric-entries-service";
import { listNutritionPlanNotesInRange } from "./nutrition-plan-notes-service";
import { getClientJourney } from "./client-journey-service";
import type { ClientBlock } from "@/types/client-blocks";
import type { MetricEntry } from "@/types/metric-entries";

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

type CheckInWeightRow = {
  id: string;
  client_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  weight: number;
};

const checkInRow = (
  id: string,
  createdAt: string,
  weight: number
): CheckInWeightRow => ({
  id,
  client_id: CLIENT_ID,
  status: "pending",
  created_at: createdAt,
  updated_at: createdAt,
  weight,
});

const entry = (
  id: string,
  entryDate: string,
  value: number,
  metricKey = "weight"
): MetricEntry =>
  ({
    id,
    clientId: CLIENT_ID,
    metricKey,
    value,
    entryDate,
    createdAt: `${entryDate}T09:00:00.000Z`,
    updatedAt: `${entryDate}T09:00:00.000Z`,
  }) as MetricEntry;

// Chainable check_ins stub serving one page per await (fetchAllPages re-builds
// the query each iteration). Records every filter call for the parity pins.
function mockCheckInsQuery(pages: CheckInWeightRow[][]) {
  let call = 0;
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    then: (resolve: (value: { data: CheckInWeightRow[]; error: null }) => void) =>
      Promise.resolve({
        data: pages[Math.min(call++, pages.length - 1)],
        error: null,
      }).then(resolve),
  };
  vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentGoals).mockResolvedValue(null);
  vi.mocked(listMetricEntries).mockResolvedValue([]);
  vi.mocked(listNutritionPlanNotesInRange).mockResolvedValue([]);
});

describe("getClientJourney", () => {
  it("decorates blocks with the client's today and derives per-state weight facts", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block({ id: "past", name: "Base", startsOn: "2026-06-01", endsOn: "2026-06-28" }),
      block({ id: "current", name: "Build", startsOn: "2026-06-29", endsOn: "2026-08-23" }),
      block({ id: "future", name: "Cut", startsOn: "2026-08-24", endsOn: "2026-09-20" }),
    ]);
    mockCheckInsQuery([
      [
        checkInRow("ci-0", "2026-05-20T08:00:00.000Z", 84.0),
        checkInRow("ci-1", "2026-06-01T08:00:00.000Z", 83.2), // exactly on the past block's start
        checkInRow("ci-2", "2026-06-27T08:00:00.000Z", 81.9),
        checkInRow("ci-3", "2026-07-15T08:00:00.000Z", 81.0),
      ],
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
    expect(journey.currentWeightKg).toBe(81.0);
  });

  it("parity: a same-day coach entry outranks the check-in (merged tie-rank, not timestamp order)", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block({ startsOn: "2026-06-01", endsOn: "2026-08-23" }),
    ]);
    // Check-in submitted at 14:00 on the same day the coach logged 89.8 —
    // body_metrics timestamp order would pick 90.2; the merged series must not.
    mockCheckInsQuery([[checkInRow("ci-1", "2026-06-01T14:00:00.000Z", 90.2)]]);
    vi.mocked(listMetricEntries).mockResolvedValue([
      entry("entry-1", "2026-06-01", 89.8),
    ]);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    expect(journey.blocks[0].startWeightKg).toBe(89.8);
    expect(journey.currentWeightKg).toBe(89.8);
  });

  it("parity: never filters check-ins by status — a pending check-in's weight is in the series", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block()]);
    const query = mockCheckInsQuery([
      [checkInRow("ci-1", "2026-08-02T08:00:00.000Z", 82.25)],
    ]);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    // Raw kg pass-through, unrounded — the renderer rounds.
    expect(journey.currentWeightKg).toBe(82.25);
    // The only filters are the tenant scope and weight NOT NULL.
    expect(query.eq).toHaveBeenCalledTimes(1);
    expect(query.eq).toHaveBeenCalledWith("client_id", CLIENT_ID);
    expect(query.not).toHaveBeenCalledTimes(1);
    expect(query.not).toHaveBeenCalledWith("weight", "is", null);
    expect(query.in).not.toHaveBeenCalled();
    for (const call of query.eq.mock.calls) {
      expect(call[0]).not.toBe("status");
    }
  });

  it("ignores non-weight metric entries", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block()]);
    mockCheckInsQuery([[]]);
    vi.mocked(listMetricEntries).mockResolvedValue([
      entry("entry-1", "2026-08-02", 18.2, "bodyFat"),
    ]);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    expect(journey.currentWeightKg).toBeNull();
    expect(journey.blocks[0].startWeightKg).toBeNull();
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
    mockCheckInsQuery([[]]);

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
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(listMetricEntries).not.toHaveBeenCalled();
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

  it("pages the check-ins read past the ~1000-row cap and unions the pages", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block({ startsOn: "2020-01-01", endsOn: "2026-08-23" }),
    ]);
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      checkInRow(
        `ci-${String(i).padStart(4, "0")}`,
        `2025-01-01T08:00:00.000Z`,
        80
      )
    );
    // The latest weight lives on page 2 — a truncated read would miss it.
    const shortPage = [checkInRow("ci-tail", "2026-08-01T08:00:00.000Z", 78.4)];
    const query = mockCheckInsQuery([fullPage, shortPage]);

    const journey = await getClientJourney(CLIENT_ID, TODAY);

    expect(query.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(query.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(journey.currentWeightKg).toBe(78.4);
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
      mockCheckInsQuery([[]]);
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
      mockCheckInsQuery([[]]);
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
      mockCheckInsQuery([[]]);

      const journey = await getClientJourney(CLIENT_ID, TODAY);

      expect(journey.currentBlockNotes).toBeNull();
      expect(listNutritionPlanNotesInRange).not.toHaveBeenCalled();
    });

    it("empty notes array when the current block has none", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block({ id: "current", startsOn: "2026-08-01", endsOn: "2026-08-31" }),
      ]);
      mockCheckInsQuery([[]]);
      vi.mocked(listNutritionPlanNotesInRange).mockResolvedValue([]);

      const journey = await getClientJourney(CLIENT_ID, TODAY);
      expect(journey.currentBlockNotes).toEqual({ blockId: "current", notes: [] });
    });

    it("no block carries its own notes field — the shape IS the policy", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block({ id: "past", startsOn: "2026-06-01", endsOn: "2026-07-31" }),
        block({ id: "current", startsOn: "2026-08-01", endsOn: "2026-08-31" }),
      ]);
      mockCheckInsQuery([[]]);
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
