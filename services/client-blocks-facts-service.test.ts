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
  tdee: number | null
) => ({ id, effective_from, effective_until, tdee });

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

  it("era pin: deficit uses the tdee of the version covering the modal's days, never the newest version", async () => {
    // 10 days under era A (2000 kcal, tdee 2800), then 4 under era B
    // (1800 kcal, tdee 2600), all elapsed. Modal = 2000 → deficit must be
    // 2800 − 2000 = 800. Pairing the newest version's tdee (2600) with the
    // modal would print 600 — the era-mixing bug 1B exists to prevent.
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-14")]);
    versionsResult = {
      data: [
        version("vA", "2026-05-01", "2026-06-10", 2800),
        version("vB", "2026-06-11", null, 2600),
      ],
      error: null,
    };
    eventPages = [
      {
        data: [...eventDays("2026-06-01", 10, 2000), ...eventDays("2026-06-11", 4, 1800)],
        error: null,
      },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      calories: 2000,
      deficitPerDay: 800,
      changeCount: 1,
      lastChangedOn: "2026-06-11",
    });
  });

  it("excludes is_modified days from the modal and the change detection", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-14")]);
    versionsResult = { data: [version("v", "2026-05-01", null, 2500)], error: null };
    eventPages = [
      {
        data: [
          ...eventDays("2026-06-01", 5, 2000),
          // Three hand-edited days: must not skew the modal or flag a change.
          ...eventDays("2026-06-06", 3, 1500, true),
          ...eventDays("2026-06-09", 6, 2000),
        ],
        error: null,
      },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      calories: 2000,
      deficitPerDay: 500,
      changeCount: 0,
      lastChangedOn: null,
    });
  });

  it("falls back to modified days for the headline when no unmodified day exists, suppressing the change marker", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-07")]);
    versionsResult = { data: [version("v", "2026-05-01", null, null)], error: null };
    eventPages = [
      {
        data: [
          ...eventDays("2026-06-01", 4, 1700, true),
          ...eventDays("2026-06-05", 3, 1600, true),
        ],
        error: null,
      },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      calories: 1700,
      deficitPerDay: null, // tdee null → no deficit, calories still shown
      changeCount: 0,
      lastChangedOn: null,
    });
  });

  it("returns null nutrition for a block with no events in its window", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block("a", "2026-06-01", "2026-06-14"),
      block("b", "2026-06-15", "2026-06-28"),
    ]);
    versionsResult = { data: [], error: null };
    eventPages = [{ data: eventDays("2026-06-15", 5, 2000), error: null }];

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].nutrition).toBeNull();
    expect(facts[1].nutrition?.calories).toBe(2000);
  });

  it("clamps a current block to lived days — future regenerated events do not vote", async () => {
    // Current block: 5 lived days at 2100, then a queued change already
    // materialized on future days at 1700. The column reports what has
    // governed the block SO FAR.
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-07", "2026-09-03")]);
    versionsResult = { data: [version("v", "2026-05-01", null, 2600)], error: null };
    eventPages = [
      {
        data: [
          ...eventDays("2026-08-07", 5, 2100), // through TODAY (2026-08-11)
          ...eventDays("2026-08-12", 10, 1700),
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
    });
  });

  it("pages past the 1000-row cap and aggregates over the union", async () => {
    // Page 1 is full (600×2000 + 400×1800) so the loop continues; page 2
    // (500×1800) is short and terminates it. Union: 1800 wins 900–600. A
    // truncated read (page 1 only) would report 2000 — this pin fails then.
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2022-01-03", "2026-08-01")]);
    versionsResult = { data: [version("v", "2020-01-01", null, 2400)], error: null };
    const page1 = [
      ...eventDays("2022-01-03", 600, 2000),
      ...eventDays(addDaysToDateString("2022-01-03", 600), 400, 1800),
    ];
    const page2 = eventDays(addDaysToDateString("2022-01-03", 1000), 500, 1800);
    eventPages = [
      { data: page1, error: null },
      { data: page2, error: null },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition?.calories).toBe(1800);
    expect(fact.nutrition?.deficitPerDay).toBe(600);
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
    versionsResult = { data: [version("v", "2026-05-01", null, null)], error: null };
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
    expect(fact.nutrition?.calories).toBe(2000);
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
