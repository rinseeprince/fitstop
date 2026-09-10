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

// Table-routed from(): one result for nutrition_plans (the versions, each
// carrying its save note), a QUEUE of page results for training_events
// (fetchAllPages issues one from() per page). Nothing per day is read for
// nutrition: the versions ARE the block's nutrition days.
let versionsResult: MockResult;
let trainingDayPages: MockResult[];

function installFromMock() {
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === "nutrition_plans") return createMockQuery(versionsResult);
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
  custom: { enabled?: boolean; calories?: number | null } = {},
  coach_note: string | null = null
) => ({
  id,
  effective_from,
  effective_until,
  tdee,
  baseline_calories,
  custom_macros_enabled: custom.enabled ?? false,
  custom_calories: custom.calories ?? null,
  coach_note,
});

/** n sequential training-event dates from `start` — the "has days" gate's input. */
function trainingDays(start: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ date: addDaysToDateString(start, i) }));
}

describe("getBlockFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    versionsResult = { data: [], error: null };
    // Both gates default to SATISFIED, wide enough to cover every fixture
    // block, so the "a block shows only what is on its days" rule is exercised
    // by its own cases rather than silently by every other one. A constant
    // baseline means the change marker still counts zero.
    trainingDayPages = [{ data: trainingDays("2026-01-01", 500), error: null }];
    installFromMock();
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([]);
  });

  it("returns [] with no blocks and reads nothing else", async () => {
    vi.mocked(listBlocks).mockResolvedValue([]);
    expect(await getBlockFacts(CLIENT_ID)).toEqual([]);
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
      { id: "p2", name: "Peak", effectiveFrom: "2026-07-01", effectiveUntil: "2027-12-31" },
    ]);

    const facts = await getBlockFacts(CLIENT_ID);
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
    trainingDayPages = [{ data: trainingDays("2026-08-01", 28), error: null }];

    const [live, untouched] = await getBlockFacts(CLIENT_ID);

    expect(live.training.map((t) => t.id)).toEqual(["p31"]);
    expect(live.nutrition.map((n) => n.calories)).toEqual([2150]);

    expect(untouched.training).toEqual([]);
    // The version's window reaches the later block, and a day's target is
    // computed from the version covering it — so those days HAVE targets, and
    // the block says so with the version's own start, as a crossing program.
    expect(untouched.nutrition).toEqual([
      { id: "v52", startsOn: "2026-08-01", calories: 2150, deficitPerDay: 550, note: null },
    ]);
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
    trainingDayPages = [{ data: trainingDays("2026-08-03", 28), error: null }];

    const [empty, setup] = await getBlockFacts(CLIENT_ID);

    expect(empty.training).toEqual([]);
    // The version covers the first block's days too, so its targets are set
    // there whether or not a session was.
    expect(empty.nutrition.map((n) => n.id)).toEqual(["v26"]);
    expect(setup.training.map((t) => t.id)).toEqual(["p19"]);
    expect(setup.nutrition.map((n) => n.calories)).toEqual([1975]);
  });

  it("gates each track on ITS OWN days — workouts without targets say so", async () => {
    // The two are set up separately, so a block can hold one and not the other.
    vi.mocked(listBlocks).mockResolvedValue([block("c", "2026-09-07", "2026-10-04")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p47", name: "Strength", effectiveFrom: "2026-09-07", effectiveUntil: "2027-12-31" },
    ]);
    // No version overlaps the block: targets were never set for it.
    versionsResult = { data: [], error: null };
    trainingDayPages = [{ data: trainingDays("2026-09-07", 28), error: null }];

    const [fact] = await getBlockFacts(CLIENT_ID);

    expect(fact.training.map((t) => t.id)).toEqual(["p47"]);
    expect(fact.nutrition).toEqual([]);
  });

  it("counts a day anywhere in the block, including one still ahead of today", async () => {
    // A current block whose program starts tomorrow HAS days; clamping the gate
    // at today would report it as untouched.
    vi.mocked(listBlocks).mockResolvedValue([block("d", "2026-08-10", "2026-09-06")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p88", name: "Deload", effectiveFrom: "2026-08-12", effectiveUntil: "2027-12-31" },
    ]);
    versionsResult = { data: [], error: null };
    trainingDayPages = [
      { data: trainingDays(addDaysToDateString(TODAY, 1), 14), error: null },
    ];

    const [fact] = await getBlockFacts(CLIENT_ID);

    expect(fact.training.map((t) => t.id)).toEqual(["p88"]);
  });

  // The nutrition facts are the training facts' shape (owner, 2026-09-10):
  // every active version overlapping the block, in start order, each with its
  // own row's numbers and its own start. No reference date, no headline.
  describe("nutrition versions", () => {
    it("lists every version overlapping the block with its OWN numbers and its OWN start — a version that began before the block keeps its real start", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-10")]);
      versionsResult = {
        data: [
          version("vA", "2026-05-01", "2026-06-10", 2800, 2400),
          // Starts the day after the block ends: never its.
          version("vB", "2026-06-11", "2027-12-31", 2600, 1800),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID);
      expect(fact.nutrition).toEqual([
        { id: "vA", startsOn: "2026-05-01", calories: 2400, deficitPerDay: 400, note: null },
      ]);
    });

    it("a CURRENT block lists a version queued inside it, under the running one — the 10 Sep case", async () => {
      // Block from 2026-08-10 (today is 2026-08-11); targets end today and a
      // new version starts tomorrow. The old reference-date rule read "the
      // version covering today" and showed one; the training column lists a
      // queued program, and so does this now.
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-10", "2026-09-06")]);
      versionsResult = {
        data: [
          version("now", "2026-07-01", "2026-08-11", 2600, 2100),
          version("queued", "2026-08-12", "2027-12-31", 2600, 1700),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID);
      expect(fact.nutrition).toEqual([
        { id: "now", startsOn: "2026-07-01", calories: 2100, deficitPerDay: 500, note: null },
        { id: "queued", startsOn: "2026-08-12", calories: 1700, deficitPerDay: 900, note: null },
      ]);
    });

    it("a current block whose ONLY version starts tomorrow is set, not \"Not set\"", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-10", "2026-09-06")]);
      versionsResult = {
        data: [version("queued", "2026-08-12", "2026-09-06", 2600, 1700)],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID);
      expect(fact.nutrition.map((n) => n.startsOn)).toEqual(["2026-08-12"]);
    });

    it("custom-macros override supplies the calories", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-01", "2026-08-28")]);
      versionsResult = {
        data: [version("v", "2026-08-01", "2027-12-31", 2600, 2200, { enabled: true, calories: 1850 })],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID);
      expect(fact.nutrition).toEqual([
        { id: "v", startsOn: "2026-08-01", calories: 1850, deficitPerDay: 750, note: null },
      ]);
    });

    it("a version without a tdee shows calories only", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
      versionsResult = { data: [version("v", "2026-06-01", "2027-12-31", null, 1700)], error: null };

      const [fact] = await getBlockFacts(CLIENT_ID);
      expect(fact.nutrition).toEqual([
        { id: "v", startsOn: "2026-06-01", calories: 1700, deficitPerDay: null, note: null },
      ]);
    });

    it("a re-save with the same numbers is its own entry, as a program placed twice is", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-09-03")]);
      versionsResult = {
        data: [
          version("v1", "2026-05-01", "2026-06-30", 3000, 2400),
          version("v2", "2026-07-01", "2027-12-31", 3000, 2400),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID);
      expect(fact.nutrition.map((n) => [n.id, n.startsOn])).toEqual([
        ["v1", "2026-05-01"],
        ["v2", "2026-07-01"],
      ]);
    });

    it("excludes a version that ended before the block began and one that starts after it ends", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
      versionsResult = {
        data: [
          version("before", "2026-01-01", "2026-05-31", 2500, 1500),
          version("during", "2026-06-01", "2026-06-28", 2500, 2000),
          version("after", "2026-06-29", "2027-12-31", 2500, 2300),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID);
      expect(fact.nutrition.map((n) => n.id)).toEqual(["during"]);
    });

    it("an empty list when no active version overlaps the block — \"Not set\"", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block("a", "2026-06-01", "2026-06-14"), // ends before the version starts
        block("b", "2026-06-15", "2026-06-28"),
      ]);
      versionsResult = { data: [version("v", "2026-06-15", "2027-12-31", 2500, 2000)], error: null };

      const facts = await getBlockFacts(CLIENT_ID);
      expect(facts[0].nutrition).toEqual([]);
      expect(facts[1].nutrition.map((n) => n.calories)).toEqual([2000]);
    });

    it("reads no day: the versions read answers the nutrition gate on its own", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2022-01-03", "2026-08-01")]);
      versionsResult = { data: [version("v", "2020-01-01", "2027-12-31", 2400, 1800)], error: null };

      const [fact] = await getBlockFacts(CLIENT_ID);
      expect(fact.nutrition).toHaveLength(1);
      const tables = vi.mocked(supabaseAdmin.from).mock.calls.map((call) => String(call[0]));
      expect(tables.filter((table) => table === "nutrition_plans")).toHaveLength(1);
      expect(tables).not.toContain("nutrition_events");
      expect(tables).not.toContain("nutrition_day_edits");
    });
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

    const facts = await getBlockFacts(CLIENT_ID);
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

    const facts = await getBlockFacts(CLIENT_ID);
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

    const facts = await getBlockFacts(CLIENT_ID);
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

    const facts = await getBlockFacts(CLIENT_ID);
    expect(facts[0].training.map((t) => t.id)).toEqual(["p2"]);
  });

  // The notes read is the fourth parallel read, partitioned per block in
  // memory — one read for the whole journey span, never one per block.
  describe("coach notes (migration 172) — a version's note rides its fact", () => {
    it("carries each version's own note, null when the save had none", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
      versionsResult = {
        data: [
          version("v1", "2026-06-01", "2026-06-14", 2600, 2000, {}, "Starting your cut."),
          version("v2", "2026-06-15", "2026-06-28", 2600, 1900),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID);

      expect(fact.nutrition.map((n) => [n.id, n.note])).toEqual([
        ["v1", "Starting your cut."],
        ["v2", null],
      ]);
    });

    it("reads no notes table — the note is a column on the version, so an archived version takes it out of the facts by construction", async () => {
      // The residue this closes: a block drawn over a deleted plan listed the
      // deleted plan's notes, because a date-anchored notes read did not ask
      // whether the version still stood. The versions read is already active-only.
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
      versionsResult = { data: [version("v1", "2026-06-01", "2026-06-28", 2600, 2000, {}, "Note.")], error: null };

      await getBlockFacts(CLIENT_ID);

      const tables = vi.mocked(supabaseAdmin.from).mock.calls.map((call) => String(call[0]));
      expect(tables).not.toContain("nutrition_plan_notes");
      expect(tables.filter((table) => table === "nutrition_plans")).toHaveLength(1);
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
