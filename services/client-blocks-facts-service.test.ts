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

// The span's nutrition days are the day reader's (one computed day per date a
// version covers); the facts never read a day table.
vi.mock("./nutrition-days-service", () => ({
  getNutritionEventsForDateRange: vi.fn(),
}));

import { supabaseAdmin } from "./supabase-admin";
import { listBlocks } from "./client-blocks-service";
import { getTrainingPlansOverlapping } from "./training-service";
import { getNutritionEventsForDateRange } from "./nutrition-days-service";
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
// results for nutrition_plan_notes and training_events (fetchAllPages issues
// one from() per page for each). The nutrition days are the reader's answer,
// read lazily so a test can set them after the beforeEach.
let versionsResult: MockResult;
let nutritionDays: DayFixture[];
let notePages: MockResult[];
let trainingDayPages: MockResult[];

function installFromMock() {
  vi.mocked(getNutritionEventsForDateRange).mockImplementation(() =>
    Promise.resolve(nutritionDays as never)
  );
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === "nutrition_plans") return createMockQuery(versionsResult);
    if (table === "nutrition_plan_notes") {
      const page = notePages.shift() ?? { data: [], error: null };
      return createMockQuery(page);
    }
    if (table === "training_events") {
      const page = trainingDayPages.shift() ?? { data: [], error: null };
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
  effective_until: string,
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

/** n sequential training-event dates from `start` — the "has days" gate's input. */
function trainingDays(start: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ date: addDaysToDateString(start, i) }));
}

type DayFixture = { date: string; baselineCalories: number; isModified: boolean };

/** n sequential computed days from `start` — the fields the facts read. */
function eventDays(start: string, n: number, baseline: number, isModified = false): DayFixture[] {
  return Array.from({ length: n }, (_, i) => ({
    date: addDaysToDateString(start, i),
    baselineCalories: baseline,
    isModified,
  }));
}

describe("getBlockFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    versionsResult = { data: [], error: null };
    notePages = [{ data: [], error: null }];
    // Both gates default to SATISFIED, wide enough to cover every fixture
    // block, so the "a block shows only what is on its days" rule is exercised
    // by its own cases rather than silently by every other one. A constant
    // baseline means the change marker still counts zero.
    nutritionDays = eventDays("2026-01-01", 500, 2000);
    trainingDayPages = [{ data: trainingDays("2026-01-01", 500), error: null }];
    installFromMock();
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([]);
  });

  it("returns [] with no blocks and reads nothing else", async () => {
    vi.mocked(listBlocks).mockResolvedValue([]);
    expect(await getBlockFacts(CLIENT_ID, TODAY)).toEqual([]);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
    expect(getTrainingPlansOverlapping).not.toHaveBeenCalled();
    expect(getNutritionEventsForDateRange).not.toHaveBeenCalled();
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
      { id: "p2", name: "Peak", effectiveFrom: "2026-07-01", effectiveUntil: "2027-12-31" },
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

  // =========================================================================
  // A block shows what is set only if it actually HAS DAYS on the calendar.
  //
  // Both columns resolve by window, and neither a placed training plan nor an
  // open nutrition version ever carries an end date — so without this gate a
  // September program governs every later block for ever, and a block the coach
  // has drawn but not set up claims a program and a prescription it has none of.
  // =========================================================================

  it("a block with NO days claims nothing, however the windows overlap it", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block("live", "2026-08-01", "2026-08-28"),
      block("untouched", "2026-10-05", "2026-11-01"),
    ]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      // Placed in the live block and never closed — it "covers" the later one.
      { id: "p31", name: "Hypertrophy", effectiveFrom: "2026-08-01", effectiveUntil: "2027-12-31" },
    ]);
    versionsResult = {
      data: [version("v52", "2026-08-01", "2027-12-31", 2700, 2150)],
      error: null,
    };
    // Days exist only in the first block.
    nutritionDays = eventDays("2026-08-01", 28, 2150);
    trainingDayPages = [{ data: trainingDays("2026-08-01", 28), error: null }];

    const [live, untouched] = await getBlockFacts(CLIENT_ID, TODAY);

    expect(live.training.map((t) => t.id)).toEqual(["p31"]);
    expect(live.nutrition?.calories).toBe(2150);

    expect(untouched.training).toEqual([]);
    expect(untouched.nutrition).toBeNull();
  });

  it("days AFTER a block are not its days — the gate is bounded at both ends", async () => {
    // The mirror of the case above, and the one a start-only bound would miss:
    // the coach set the SECOND block up and left the first empty. A gate that
    // only asked "is there a day on or after this block's start" would hand the
    // untouched first block the second's program.
    vi.mocked(listBlocks).mockResolvedValue([
      block("empty", "2026-07-06", "2026-08-02"),
      block("setup", "2026-08-03", "2026-08-30"),
    ]);
    // Both windows OPEN from before the first block, so window logic alone
    // hands the plan and the prescription to BOTH — only the days separate them.
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p19", name: "Base", effectiveFrom: "2026-07-06", effectiveUntil: "2027-12-31" },
    ]);
    versionsResult = {
      data: [version("v26", "2026-07-06", "2027-12-31", 2550, 1975)],
      error: null,
    };
    nutritionDays = eventDays("2026-08-03", 28, 1975);
    trainingDayPages = [{ data: trainingDays("2026-08-03", 28), error: null }];

    const [empty, setup] = await getBlockFacts(CLIENT_ID, TODAY);

    expect(empty.training).toEqual([]);
    expect(empty.nutrition).toBeNull();
    expect(setup.training.map((t) => t.id)).toEqual(["p19"]);
    expect(setup.nutrition?.calories).toBe(1975);
  });

  it("gates each track on ITS OWN days — workouts without targets say so", async () => {
    // The two are set up separately, so a block can hold one and not the other.
    vi.mocked(listBlocks).mockResolvedValue([block("c", "2026-09-07", "2026-10-04")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p47", name: "Strength", effectiveFrom: "2026-09-07", effectiveUntil: "2027-12-31" },
    ]);
    versionsResult = {
      data: [version("v63", "2026-06-15", "2027-12-31", 2900, 2380)],
      error: null,
    };
    nutritionDays = [];
    trainingDayPages = [{ data: trainingDays("2026-09-07", 28), error: null }];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);

    expect(fact.training.map((t) => t.id)).toEqual(["p47"]);
    expect(fact.nutrition).toBeNull();
  });

  it("counts a day anywhere in the block, including one still ahead of today", async () => {
    // A current block whose program starts tomorrow HAS days; clamping the gate
    // at today would report it as untouched.
    vi.mocked(listBlocks).mockResolvedValue([block("d", "2026-08-10", "2026-09-06")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p88", name: "Deload", effectiveFrom: "2026-08-12", effectiveUntil: "2027-12-31" },
    ]);
    versionsResult = { data: [], error: null };
    nutritionDays = [];
    trainingDayPages = [
      { data: trainingDays(addDaysToDateString(TODAY, 1), 14), error: null },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);

    expect(fact.training.map((t) => t.id)).toEqual(["p88"]);
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
        version("vB", "2026-06-11", "2027-12-31", 2600, 1800),
      ],
      error: null,
    };
    nutritionDays = eventDays("2026-06-01", 10, 2400);

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      startsOn: "2026-05-01",
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
        version("new", "2026-08-11", "2027-12-31", 2220, 1995),
      ],
      error: null,
    };
    nutritionDays = eventDays("2026-07-27", 17, 2300, true);

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      startsOn: "2026-08-11",
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
        version("v", "2026-05-01", "2027-12-31", 2600, 2100, { enabled: true, calories: 1850 }),
      ],
      error: null,
    };

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      startsOn: "2026-05-01",
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
    versionsResult = { data: [version("v", "2026-05-01", "2027-12-31", 2500)], error: null };
    nutritionDays = [
          ...eventDays("2026-06-01", 5, 2000),
          // Three hand-edited days at a different value: no flag.
          ...eventDays("2026-06-06", 3, 1500, true),
          ...eventDays("2026-06-09", 6, 2000),
        ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      startsOn: "2026-05-01",
      calories: 2000, // the version's baseline, not an event aggregate
      deficitPerDay: 500,
      changeCount: 0,
      lastChangedOn: null,
      eras: [{ from: "2026-06-01", calories: 2000, deficitPerDay: 500 }],
    });
  });

  it("a version without a tdee shows calories only", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-07")]);
    versionsResult = { data: [version("v", "2026-05-01", "2027-12-31", null, 1700)], error: null };

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      startsOn: "2026-05-01",
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
    versionsResult = { data: [version("v", "2026-06-15", "2027-12-31", 2500, 2000)], error: null };

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].nutrition).toBeNull();
    expect(facts[1].nutrition?.calories).toBe(2000);
  });

  it("the change window clamps at today — a queued change's future events do not flag yet", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-07", "2026-09-03")]);
    versionsResult = { data: [version("v", "2026-05-01", "2027-12-31", 2600, 2100)], error: null };
    nutritionDays = [
          ...eventDays("2026-08-07", 5, 2100), // through TODAY (2026-08-11)
          ...eventDays("2026-08-12", 10, 1700), // tomorrow's era — not lived
        ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition).toEqual({
      startsOn: "2026-05-01",
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
          version("v2", "2026-07-01", "2027-12-31", 3000, 2000),
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
        data: [version("v", "2024-01-01", "2027-12-31", 2500, 2000)],
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
          version("queued", "2026-08-12", "2027-12-31", 2600, 1700),
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
          version("v2", "2026-07-01", "2027-12-31", 3000, 2400),
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
          version("during", "2026-06-01", "2027-12-31", 2500, 2000),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition?.eras).toEqual([
        { from: "2026-06-01", calories: 2000, deficitPerDay: 500 },
      ]);
    });
  });

  it("reads the span's days ONCE through the day reader, and a change deep in a long span still flags", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2022-01-03", "2026-08-01")]);
    versionsResult = { data: [version("v", "2020-01-01", "2027-12-31", 2400, 1800)], error: null };
    const transitionDate = addDaysToDateString("2022-01-03", 1000);
    nutritionDays = [
      ...eventDays("2022-01-03", 1000, 2000),
      ...eventDays(transitionDate, 500, 1800),
    ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition?.changeCount).toBe(1);
    expect(fact.nutrition?.lastChangedOn).toBe(transitionDate);
    // One read for the whole journey span, never one per block or per page.
    expect(getNutritionEventsForDateRange).toHaveBeenCalledTimes(1);
    expect(getNutritionEventsForDateRange).toHaveBeenCalledWith(CLIENT_ID, "2022-01-03", "2026-08-01");
  });

  it("a program's window ends where its row says — a January program never reaches a June block", async () => {
    // Both ends are on the row (migration 167): the January program was capped
    // at the day before its successor started, so a June block lists only the
    // program whose window reaches it.
    vi.mocked(listBlocks).mockResolvedValue([
      block("a", "2026-01-05", "2026-02-01"),
      block("b", "2026-06-01", "2026-06-28"),
    ]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p1", name: "Base", effectiveFrom: "2026-01-05", effectiveUntil: "2026-02-28" },
      { id: "p2", name: "Peak", effectiveFrom: "2026-03-01", effectiveUntil: "2026-12-31" },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].training.map((t) => t.id)).toEqual(["p1"]);
    expect(facts[1].training.map((t) => t.id)).toEqual(["p2"]);
  });

  it("a program's last day is still its own — a block opening on it lists the program", async () => {
    // The window is inclusive on both ends (migration 167): a block whose first
    // day is a program's last day got one workout from it.
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-03-15", "2026-04-11")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p1", name: "Base", effectiveFrom: "2026-01-05", effectiveUntil: "2026-03-15" },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].training.map((t) => t.id)).toEqual(["p1"]);
  });

  it("the days after every window are ungoverned — nothing hands govern-ship back", async () => {
    // There is no open plan to fall back to (migration 167): once the bridge
    // ends, March belongs to no program, the same answer getTrainingPlanForDate
    // gives any March date.
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-03-01", "2026-03-28")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p1", name: "Base", effectiveFrom: "2026-01-05", effectiveUntil: "2026-01-31" },
      { id: "p2", name: "Bridge", effectiveFrom: "2026-02-01", effectiveUntil: "2026-02-28" },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].training).toEqual([]);
  });

  it("same-day tie: the list-first (newest-created) plan governs; the loser never appears", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
    // getTrainingPlansOverlapping orders created_at DESC within a start
    // date, so p2 (list-first) is the resolution winner.
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p2", name: "Corrected", effectiveFrom: "2026-06-01", effectiveUntil: "2026-06-28" },
      { id: "p1", name: "Mistake", effectiveFrom: "2026-06-01", effectiveUntil: "2026-06-28" },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].training.map((t) => t.id)).toEqual(["p2"]);
  });

  it("counts multiple prescription changes and reports the newest era's first day", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-21")]);
    versionsResult = { data: [version("v", "2026-05-01", "2027-12-31", null, 1800)], error: null };
    nutritionDays = [
          ...eventDays("2026-06-01", 8, 2000),
          ...eventDays("2026-06-09", 6, 1900),
          ...eventDays("2026-06-15", 7, 1800),
        ];

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
    expect(fact.nutrition?.calories).toBe(1800);
    expect(fact.nutrition?.changeCount).toBe(2);
    expect(fact.nutrition?.lastChangedOn).toBe("2026-06-15");
  });

  // The notes read is the fourth parallel read, partitioned per block in
  // memory — one read for the whole journey span, never one per block.
  describe("coach notes (migration 147)", () => {
    const noteRow = (id: string, effective_on: string, body: string) => ({
      id,
      effective_on,
      body,
    });

    it("partitions notes to the block whose window contains their effective date", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block("a", "2026-06-01", "2026-06-28"),
        block("b", "2026-06-29", "2026-07-26"),
      ]);
      notePages = [
        {
          data: [
            noteRow("n1", "2026-06-05", "Starting your cut."),
            noteRow("n2", "2026-06-28", "Last day of the cut."),
            noteRow("n3", "2026-06-29", "Into maintenance."),
          ],
          error: null,
        },
      ];

      const facts = await getBlockFacts(CLIENT_ID, TODAY);

      // Inclusive on BOTH ends — a note dated on the final day belongs to the
      // block that ends that day, not the one starting the next.
      expect(facts[0].notes.map((n) => n.id)).toEqual(["n1", "n2"]);
      expect(facts[1].notes.map((n) => n.id)).toEqual(["n3"]);
      expect(facts[0].notes[0]).toEqual({
        id: "n1",
        effectiveOn: "2026-06-05",
        body: "Starting your cut.",
      });
    });

    it("reads the span ONCE, not once per block", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block("a", "2026-06-01", "2026-06-28"),
        block("b", "2026-06-29", "2026-07-26"),
        block("c", "2026-07-27", "2026-08-23"),
      ]);

      await getBlockFacts(CLIENT_ID, TODAY);

      // String() rather than a cast: `from`'s parameter type narrows to the
      // first table in the generated union, so a direct === comparison is a
      // TS2367 "no overlap" error even though the call is real at runtime.
      const noteReads = vi
        .mocked(supabaseAdmin.from)
        .mock.calls.map((c) => String(c[0]))
        .filter((table) => table === "nutrition_plan_notes");
      expect(noteReads).toHaveLength(1);
    });

    it("keeps a FUTURE block's notes — a queued plan the coach already explained", async () => {
      // Unlike the nutrition eras, notes are not clamped to today. Hiding the
      // coach's own reasoning from them until the date arrives would be wrong.
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-09-01", "2026-09-28")]);
      notePages = [
        { data: [noteRow("n9", "2026-09-01", "Next block's plan.")], error: null },
      ];

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.notes.map((n) => n.id)).toEqual(["n9"]);
    });

    it("gives every block an empty array when the client has no notes", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.notes).toEqual([]);
    });
  });
});

describe("reduceToGoverningSegments", () => {
  it("clips reigns at successors and leaves the days after every window ungoverned", () => {
    // A `draft` row can still share a live plan's days (the exclusion is scoped
    // to live rows), so the per-date resolution stays: the later start wins
    // while both cover the day, and once every window has ended nothing does.
    const plans = [
      { id: "p1", name: "Base", effectiveFrom: "2026-01-05", effectiveUntil: "2026-03-15" },
      { id: "p2", name: "Bridge", effectiveFrom: "2026-02-01", effectiveUntil: "2026-02-28" },
    ];
    const segments = reduceToGoverningSegments(plans, "2026-01-05", "2026-04-30");
    expect(
      segments.map((s) => [s.plan.id, s.from, s.to])
    ).toEqual([
      ["p1", "2026-01-05", "2026-01-31"],
      ["p2", "2026-02-01", "2026-02-28"],
      ["p1", "2026-03-01", "2026-03-15"],
    ]);
  });

  it("leaves a true gap ungoverned (no plan covers before the first start)", () => {
    const plans = [
      { id: "p1", name: "Base", effectiveFrom: "2026-02-01", effectiveUntil: "2026-03-31" },
    ];
    const segments = reduceToGoverningSegments(plans, "2026-01-01", "2026-03-01");
    expect(segments.map((s) => [s.plan.id, s.from, s.to])).toEqual([
      ["p1", "2026-02-01", "2026-03-01"],
    ]);
  });
});
