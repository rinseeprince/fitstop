import { describe, it, expect, vi, beforeEach } from "vitest";
import { addDaysToDateString } from "@/lib/date-helpers";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("./client-blocks-service", () => ({
  listBlocks: vi.fn(),
}));

vi.mock("./training-service", () => ({
  getTrainingPlansOverlapping: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { listBlocks } from "./client-blocks-service";
import { getTrainingPlansOverlapping } from "./training-service";
import {
  getBlockFacts,
  reduceToGoverningSegments,
} from "./client-blocks-facts-service";

const TODAY = "2026-08-11";
const CLIENT_ID = "client-1";

type MockResult = { data?: unknown; error: unknown };

function createMockQuery(result: MockResult) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  Object.assign(query, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    gte: vi.fn(chain),
    lte: vi.fn(chain),
    or: vi.fn(chain),
    order: vi.fn(chain),
    range: vi.fn(chain),
    then: (resolve: (value: MockResult) => void) =>
      Promise.resolve(result).then(resolve),
  });
  return query;
}

// Table-routed from(): one result for nutrition_plans, a QUEUE of page
// results for nutrition_events (fetchAllPages issues one from() per page).
let versionsResult: MockResult;
let eventPages: MockResult[];

function installFromMock() {
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === "nutrition_plans") return createMockQuery(versionsResult);
    if (table === "nutrition_events") {
      const page = eventPages.shift() ?? { data: [], error: null };
      return createMockQuery(page);
    }
    throw new Error(`Unexpected table: ${table}`);
  }) as never);
}

const block = (
  id: string,
  startsOn: string,
  endsOn: string,
  name = `Block ${id}`
) => ({ id, name, focus: null, targetWeightKg: null, startsOn, endsOn, archivedAt: null });

const version = (
  id: string,
  effective_from: string,
  effective_until: string | null,
  tdee: number | null,
  baseline_calories = 2000,
  custom: { enabled?: boolean; calories?: number | null } = {}
) => ({
  id,
  effective_from,
  effective_until,
  tdee,
  baseline_calories,
  custom_macros_enabled: custom.enabled ?? false,
  custom_calories: custom.calories ?? null,
});

/** n sequential daily event rows from `start`. */
function eventDays(
  start: string,
  n: number,
  baseline: number | null,
  isModified = false
) {
  return Array.from({ length: n }, (_, i) => ({
    date: addDaysToDateString(start, i),
    baseline_calories: baseline,
    is_modified: isModified,
  }));
}

describe("getBlockFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    versionsResult = { data: [], error: null };
    eventPages = [{ data: [], error: null }];
    installFromMock();
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([]);
  });

  it("returns [] with no blocks and reads nothing else", async () => {
    vi.mocked(listBlocks).mockResolvedValue([]);
    expect(await getBlockFacts(CLIENT_ID, TODAY)).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(getTrainingPlansOverlapping).not.toHaveBeenCalled();
  });

  it("partitions overlapping training plans per block window", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block("a", "2026-06-01", "2026-06-28"),
      block("b", "2026-06-29", "2026-07-26"),
    ]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      // Covers block a only.
      { id: "p1", name: "Base", effectiveFrom: "2026-05-20", effectiveUntil: "2026-06-20" },
      // Open-ended from inside block b: overlaps b only.
      { id: "p2", name: "Peak", effectiveFrom: "2026-07-01", effectiveUntil: null },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts.map((f) => f.training.map((t) => t.id))).toEqual([
      ["p1"],
      ["p2"],
    ]);
    expect(facts[1].training[0]).toEqual({
      id: "p2",
      name: "Peak",
      startsOn: "2026-07-01",
    });
  });

  it("past block: era pin — the version covering its FINAL day, never the newest", async () => {
    // Block ends 2026-06-10, inside era A (baseline 2400, tdee 2800); era B
    // (1800, tdee 2600) starts after. The block must report era A's
    // prescription — pairing the newest version would be the era-mixing bug
    // 1B exists to prevent.
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-10")]);
    versionsResult = {
      data: [
        version("vA", "2026-05-01", "2026-06-10", 2800, 2400),
        version("vB", "2026-06-11", null, 2600, 1800),
      ],
      error: null,
    };
    eventPages = [{ data: eventDays("2026-06-01", 10, 2400), error: null }];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      calories: 2400,
      deficitPerDay: 400,
      changeCount: 0,
      lastChangedOn: null,
      // vB starts the day after the block ends, so it never governed it.
      eras: [{ from: "2026-06-01", calories: 2400, deficitPerDay: 400 }],
    });
  });

  it("current block: the prescription covering TODAY, hand-edits ignored — the fixture case", async () => {
    // Every lived day is hand-edited (a fully materialized stretch). The
    // dominant-era modal went blind here; the prescription source cannot:
    // the version covering today supplies calories + tdee directly.
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-07-24", "2026-09-03")]);
    versionsResult = {
      data: [
        version("old", "2025-07-02", "2026-08-10", 2220, 2220),
        version("new", "2026-08-11", null, 2220, 1995),
      ],
      error: null,
    };
    eventPages = [
      { data: eventDays("2026-07-27", 17, 2300, true), error: null },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      calories: 1995,
      deficitPerDay: 225,
      changeCount: 0, // modified days can neither flag nor mask a change
      lastChangedOn: null,
      // BOTH eras governed part of this block, and the timeline says so even
      // though every lived day is hand-edited — the versions know what the
      // events cannot. The first is clipped to the block's own start.
      eras: [
        { from: "2026-07-24", calories: 2220, deficitPerDay: 0 },
        { from: "2026-08-11", calories: 1995, deficitPerDay: 225 },
      ],
    });
  });

  it("custom-macros override supplies the calories", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-01", "2026-09-03")]);
    versionsResult = {
      data: [
        version("v", "2026-05-01", null, 2600, 2100, { enabled: true, calories: 1850 }),
      ],
      error: null,
    };

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      calories: 1850,
      deficitPerDay: 750,
      changeCount: 0,
      lastChangedOn: null,
      // The override reaches the era too, not just the headline.
      eras: [{ from: "2026-08-01", calories: 1850, deficitPerDay: 750 }],
    });
  });

  it("the change marker skips hand-edited days: an edit stretch can neither flag nor mask", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-14")]);
    versionsResult = { data: [version("v", "2026-05-01", null, 2500)], error: null };
    eventPages = [
      {
        data: [
          ...eventDays("2026-06-01", 5, 2000),
          // Three hand-edited days at a different value: no flag.
          ...eventDays("2026-06-06", 3, 1500, true),
          ...eventDays("2026-06-09", 6, 2000),
        ],
        error: null,
      },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      calories: 2000, // the version's baseline, not an event aggregate
      deficitPerDay: 500,
      changeCount: 0,
      lastChangedOn: null,
      eras: [{ from: "2026-06-01", calories: 2000, deficitPerDay: 500 }],
    });
  });

  it("a version without a tdee shows calories only", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-07")]);
    versionsResult = { data: [version("v", "2026-05-01", null, null, 1700)], error: null };

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      calories: 1700,
      deficitPerDay: null,
      changeCount: 0,
      lastChangedOn: null,
      eras: [{ from: "2026-06-01", calories: 1700, deficitPerDay: null }],
    });
  });

  it("returns null nutrition for a block whose reference date no version covers", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block("a", "2026-06-01", "2026-06-14"), // ends before the version starts
      block("b", "2026-06-15", "2026-06-28"),
    ]);
    versionsResult = { data: [version("v", "2026-06-15", null, 2500, 2000)], error: null };

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].nutrition).toBeNull();
    expect(facts[1].nutrition?.calories).toBe(2000);
  });

  it("the change window clamps at today — a queued change's future events do not flag yet", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-07", "2026-09-03")]);
    versionsResult = { data: [version("v", "2026-05-01", null, 2600, 2100)], error: null };
    eventPages = [
      {
        data: [
          ...eventDays("2026-08-07", 5, 2100), // through TODAY (2026-08-11)
          ...eventDays("2026-08-12", 10, 1700), // tomorrow's era — not lived
        ],
        error: null,
      },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      calories: 2100,
      deficitPerDay: 500,
      changeCount: 0,
      lastChangedOn: null,
      eras: [{ from: "2026-08-07", calories: 2100, deficitPerDay: 500 }],
    });
  });

  // The eras are what the "what happened" timeline renders. They exist because
  // the headline reads the REFERENCE-date version — today, for a current block —
  // so pinning those numbers to a historical date would silently rewrite a past
  // entry every time the coach saved a new plan.
  describe("nutrition eras", () => {
    it("each era carries its OWN version's numbers, not the headline's", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-09-03")]);
      versionsResult = {
        data: [
          version("v1", "2026-05-01", "2026-06-30", 3000, 2400),
          version("v2", "2026-07-01", null, 3000, 2000),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);

      // The headline is era 2 (it covers today). Era 1 keeps its own 2400 —
      // that is the property a later plan save must not be able to disturb.
      expect(fact.nutrition?.calories).toBe(2000);
      expect(fact.nutrition?.eras).toEqual([
        { from: "2026-06-01", calories: 2400, deficitPerDay: 600 },
        { from: "2026-07-01", calories: 2000, deficitPerDay: 1000 },
      ]);
    });

    it("clips the first era to the block's start, not the version's", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
      versionsResult = {
        data: [version("v", "2024-01-01", null, 2500, 2000)],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition?.eras).toEqual([
        { from: "2026-06-01", calories: 2000, deficitPerDay: 500 },
      ]);
    });

    // A queued save is a plan, not a thing that happened.
    it("stops at today: a version starting tomorrow is not in the log", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-01", "2026-09-03")]);
      versionsResult = {
        data: [
          version("now", "2026-07-01", "2026-08-11", 2600, 2100),
          version("queued", "2026-08-12", null, 2600, 1700),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition?.eras).toEqual([
        { from: "2026-08-01", calories: 2100, deficitPerDay: 500 },
      ]);
    });

    it("omits a re-save that left the numbers where they were", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-09-03")]);
      versionsResult = {
        data: [
          version("v1", "2026-05-01", "2026-06-30", 3000, 2400),
          // Same calories AND same tdee: nothing the coach would recognise as
          // a change, so no entry.
          version("v2", "2026-07-01", null, 3000, 2400),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition?.eras).toEqual([
        { from: "2026-06-01", calories: 2400, deficitPerDay: 600 },
      ]);
    });

    it("excludes a version whose window ended before the block began", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
      versionsResult = {
        data: [
          version("before", "2026-01-01", "2026-05-31", 2500, 1500),
          version("during", "2026-06-01", null, 2500, 2000),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition?.eras).toEqual([
        { from: "2026-06-01", calories: 2000, deficitPerDay: 500 },
      ]);
    });
  });

  it("pages past the 1000-row cap — a change only visible on page 2 still flags", async () => {
    // Page 1 is full (1000×2000) so the loop continues; page 2 (500×1800) is
    // short and terminates it. The era transition sits at page 2's first row —
    // a truncated read (page 1 only) would report changeCount 0.
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2022-01-03", "2026-08-01")]);
    versionsResult = { data: [version("v", "2020-01-01", null, 2400, 1800)], error: null };
    const transitionDate = addDaysToDateString("2022-01-03", 1000);
    eventPages = [
      { data: eventDays("2022-01-03", 1000, 2000), error: null },
      { data: eventDays(transitionDate, 500, 1800), error: null },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition?.changeCount).toBe(1);
    expect(fact.nutrition?.lastChangedOn).toBe(transitionDate);
    // Both pages were requested: nutrition_events hit twice.
    const eventCalls = vi
      .mocked(supabaseAdmin.from)
      .mock.calls.filter((call) => String(call[0]) === "nutrition_events");
    expect(eventCalls).toHaveLength(2);
  });

  it("does NOT leak a superseded open-window plan into later blocks", async () => {
    // Placed plans keep effective_until = NULL forever; raw overlap would
    // list the January program in the June block. Governing segments end a
    // plan's reign where its successor starts.
    vi.mocked(listBlocks).mockResolvedValue([
      block("a", "2026-01-05", "2026-02-01"),
      block("b", "2026-06-01", "2026-06-28"),
    ]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p1", name: "Base", effectiveFrom: "2026-01-05", effectiveUntil: null },
      { id: "p2", name: "Peak", effectiveFrom: "2026-03-01", effectiveUntil: null },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].training.map((t) => t.id)).toEqual(["p1"]);
    expect(facts[1].training.map((t) => t.id)).toEqual(["p2"]);
  });

  it("hands govern-ship back to the older open plan when a capped successor expires", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-03-01", "2026-03-28")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p1", name: "Base", effectiveFrom: "2026-01-05", effectiveUntil: null },
      { id: "p2", name: "Bridge", effectiveFrom: "2026-02-01", effectiveUntil: "2026-02-28" },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    // March is past the bridge's window; the open base plan governs again —
    // the same answer getTrainingPlanForDate gives any March date.
    expect(facts[0].training.map((t) => t.id)).toEqual(["p1"]);
  });

  it("same-day tie: the list-first (newest-created) plan governs; the loser never appears", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
    // getTrainingPlansOverlapping orders created_at DESC within a start
    // date, so p2 (list-first) is the resolution winner.
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p2", name: "Corrected", effectiveFrom: "2026-06-01", effectiveUntil: null },
      { id: "p1", name: "Mistake", effectiveFrom: "2026-06-01", effectiveUntil: null },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].training.map((t) => t.id)).toEqual(["p2"]);
  });

  it("counts multiple prescription changes and reports the newest era's first day", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-21")]);
    versionsResult = { data: [version("v", "2026-05-01", null, null, 1800)], error: null };
    eventPages = [
      {
        data: [
          ...eventDays("2026-06-01", 8, 2000),
          ...eventDays("2026-06-09", 6, 1900),
          ...eventDays("2026-06-15", 7, 1800),
        ],
        error: null,
      },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition?.calories).toBe(1800);
    expect(fact.nutrition?.changeCount).toBe(2);
    expect(fact.nutrition?.lastChangedOn).toBe("2026-06-15");
  });
});

describe("reduceToGoverningSegments", () => {
  it("merges adjacent same-plan segments and clips reigns at successors", () => {
    const plans = [
      { id: "p1", name: "Base", effectiveFrom: "2026-01-05", effectiveUntil: null },
      { id: "p2", name: "Bridge", effectiveFrom: "2026-02-01", effectiveUntil: "2026-02-28" },
    ];
    const segments = reduceToGoverningSegments(plans, "2026-01-05", "2026-04-30");
    expect(
      segments.map((s) => [s.plan.id, s.from, s.to])
    ).toEqual([
      ["p1", "2026-01-05", "2026-01-31"],
      ["p2", "2026-02-01", "2026-02-28"],
      ["p1", "2026-03-01", "2026-04-30"],
    ]);
  });

  it("leaves a true gap ungoverned (no plan covers before the first start)", () => {
    const plans = [
      { id: "p1", name: "Base", effectiveFrom: "2026-02-01", effectiveUntil: null },
    ];
    const segments = reduceToGoverningSegments(plans, "2026-01-01", "2026-03-01");
    expect(segments.map((s) => [s.plan.id, s.from, s.to])).toEqual([
      ["p1", "2026-02-01", "2026-03-01"],
    ]);
  });
});
