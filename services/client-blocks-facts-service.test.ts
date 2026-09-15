import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { getBlockFacts } from "./client-blocks-facts-service";

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

// Table-routed from(): ONE result, for nutrition_plans. Any other table throws,
// because a block's plans are found from their dates — nothing per day is read
// on either track.
let versionsResult: MockResult;
/** The versions query as it was built, so the span it read can be asserted. */
let versionsQuery: Record<string, ReturnType<typeof vi.fn>>;

function installFromMock() {
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === "nutrition_plans") {
      versionsQuery = createMockQuery(versionsResult) as never;
      return versionsQuery;
    }
    throw new Error(`Unexpected table: ${table}`);
  }) as never);
}

const block = (
  id: string,
  startsOn: string,
  endsOn: string,
  name = `Block ${id}`
) => ({ id, name, focus: null, startsOn, endsOn, archivedAt: null });

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

describe("getBlockFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    versionsResult = { data: [], error: null };
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
      // Starts inside block b and runs past the span: overlaps b only.
      { id: "p2", name: "Peak", effectiveFrom: "2026-07-01", effectiveUntil: "2027-12-31" },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    // ONE read per track, over the WHOLE journey — first block's start to last
    // block's end. Read any narrower and a later block loses its plans.
    expect(getTrainingPlansOverlapping).toHaveBeenCalledWith(
      CLIENT_ID,
      "2026-06-01",
      "2026-07-26"
    );
    expect(versionsQuery.lte).toHaveBeenCalledWith("effective_from", "2026-07-26");
    expect(versionsQuery.gte).toHaveBeenCalledWith("effective_until", "2026-06-01");
    expect(facts.map((f) => f.training.map((t) => t.id))).toEqual([
      ["p1"],
      ["p2"],
    ]);
    // The plan's OWN window rides the fact, with its state against TODAY —
    // stamped here, never derived by the card.
    expect(facts[1].training[0]).toEqual({
      id: "p2",
      name: "Peak",
      startsOn: "2026-07-01",
      endsOn: "2027-12-31",
      state: "active",
    });
  });

  // =========================================================================
  // A block's plans are found from their DATES — the plan rows are the whole
  // answer, on both tracks, and nothing per day is read.
  // =========================================================================

  it("lists a program whose days are not on the calendar — the card reads the plans, the calendar reads the days", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-09-07", "2026-10-04")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p47", name: "Strength", effectiveFrom: "2026-09-07", effectiveUntil: "2026-10-04" },
    ]);

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);

    expect(fact.training.map((t) => t.id)).toEqual(["p47"]);
    // No session read at all: `installFromMock` throws on any other table, and
    // this pins the intent rather than the throw.
    const tables = vi.mocked(supabaseAdmin.from).mock.calls.map((call) => String(call[0]));
    expect(tables).not.toContain("training_events");
    expect(tables).not.toContain("training_sessions");
  });

  it("lists a plan that started before the block, on both tracks, with its own dates", async () => {
    // A block already under way keeps its lived start edge, so a plan that
    // started before it is left crossing it: its days inside the block are the
    // client's programming, and the block says so with the plan's own start.
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-10", "2026-09-06")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p1", name: "Upper Lower", effectiveFrom: "2026-07-27", effectiveUntil: "2026-08-23" },
    ]);
    versionsResult = {
      data: [version("v1", "2026-07-27", "2026-08-23", 2600, 2200)],
      error: null,
    };

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);

    expect(fact.training).toEqual([
      {
        id: "p1",
        name: "Upper Lower",
        startsOn: "2026-07-27",
        endsOn: "2026-08-23",
        state: "active",
      },
    ]);
    expect(fact.nutrition.map((n) => [n.id, n.startsOn])).toEqual([
      ["v1", "2026-07-27"],
    ]);
  });

  it("each track answers on its own — workouts without targets say so", async () => {
    // The two are set up separately, so a block can hold one and not the other.
    vi.mocked(listBlocks).mockResolvedValue([block("c", "2026-09-07", "2026-10-04")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p47", name: "Strength", effectiveFrom: "2026-09-07", effectiveUntil: "2026-10-04" },
    ]);
    versionsResult = { data: [], error: null };

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);

    expect(fact.training.map((t) => t.id)).toEqual(["p47"]);
    expect(fact.nutrition).toEqual([]);
  });

  it("a block no plan reaches claims nothing", async () => {
    vi.mocked(listBlocks).mockResolvedValue([
      block("setup", "2026-08-03", "2026-08-30"),
      block("untouched", "2026-10-05", "2026-11-01"),
    ]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p19", name: "Base", effectiveFrom: "2026-08-03", effectiveUntil: "2026-08-30" },
    ]);
    versionsResult = {
      data: [version("v26", "2026-08-03", "2026-08-30", 2550, 1975)],
      error: null,
    };

    const [setup, untouched] = await getBlockFacts(CLIENT_ID, TODAY);

    expect(setup.training.map((t) => t.id)).toEqual(["p19"]);
    expect(setup.nutrition.map((n) => n.calories)).toEqual([1975]);
    expect(untouched.training).toEqual([]);
    expect(untouched.nutrition).toEqual([]);
  });

  it("counts a plan queued inside a current block — the days ahead are its days too", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("d", "2026-08-10", "2026-09-06")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p88", name: "Deload", effectiveFrom: "2026-08-12", effectiveUntil: "2026-09-06" },
    ]);

    const [fact] = await getBlockFacts(CLIENT_ID, TODAY);

    expect(fact.training.map((t) => [t.id, t.state])).toEqual([["p88", "upcoming"]]);
  });

  // The nutrition facts are the training facts' shape (owner, 2026-09-10):
  // every active version overlapping the block, in start order, each with its
  // own row's numbers and its own start. No reference date, no headline.
  describe("nutrition versions", () => {
    it("lists every version overlapping the block and excludes one starting after it ends", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-10")]);
      versionsResult = {
        data: [
          version("vA", "2026-05-01", "2026-06-10", 2800, 2400),
          // Starts the day after the block ends: never its.
          version("vB", "2026-06-11", "2027-12-31", 2600, 1800),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition).toEqual([
        { id: "vA", startsOn: "2026-05-01", endsOn: "2026-06-10", state: "ended", calories: 2400, deficitPerDay: 400, note: null },
      ]);
    });

    it("a CURRENT block lists a version queued inside it, under the running one — the 10 Sep case", async () => {
      // Block from 2026-08-10 (today is 2026-08-11); targets end today and a
      // new version starts tomorrow. The training column lists a queued
      // program, and so does this.
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-10", "2026-09-06")]);
      versionsResult = {
        data: [
          version("now", "2026-07-01", "2026-08-11", 2600, 2100),
          version("queued", "2026-08-12", "2026-09-06", 2600, 1700),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition).toEqual([
        // The running version ends ON today and is still active — the end day
        // is its own (`coversDate`); the queued one starts tomorrow: upcoming.
        { id: "now", startsOn: "2026-07-01", endsOn: "2026-08-11", state: "active", calories: 2100, deficitPerDay: 500, note: null },
        { id: "queued", startsOn: "2026-08-12", endsOn: "2026-09-06", state: "upcoming", calories: 1700, deficitPerDay: 900, note: null },
      ]);
    });

    it("a current block whose ONLY version starts tomorrow is set, not \"Not set\"", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-10", "2026-09-06")]);
      versionsResult = {
        data: [version("queued", "2026-08-12", "2026-09-06", 2600, 1700)],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition.map((n) => n.startsOn)).toEqual(["2026-08-12"]);
    });

    it("custom-macros override supplies the calories", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-08-01", "2026-08-28")]);
      versionsResult = {
        data: [version("v", "2026-08-01", "2026-08-28", 2600, 2200, { enabled: true, calories: 1850 })],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition).toEqual([
        { id: "v", startsOn: "2026-08-01", endsOn: "2026-08-28", state: "active", calories: 1850, deficitPerDay: 750, note: null },
      ]);
    });

    it("a version without a tdee shows calories only", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
      versionsResult = { data: [version("v", "2026-06-01", "2026-06-28", null, 1700)], error: null };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition).toEqual([
        { id: "v", startsOn: "2026-06-01", endsOn: "2026-06-28", state: "ended", calories: 1700, deficitPerDay: null, note: null },
      ]);
    });

    it("a re-save with the same numbers is its own entry, as a program placed twice is", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-09-03")]);
      versionsResult = {
        data: [
          version("v1", "2026-05-01", "2026-06-30", 3000, 2400),
          version("v2", "2026-07-01", "2026-09-03", 3000, 2400),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition.map((n) => [n.id, n.startsOn])).toEqual([
        ["v1", "2026-05-01"],
        ["v2", "2026-07-01"],
      ]);
    });

    it("excludes a version that ended before the block began", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
      versionsResult = {
        data: [
          version("before", "2026-01-01", "2026-05-31", 2500, 1500),
          version("during", "2026-06-01", "2026-06-28", 2500, 2000),
        ],
        error: null,
      };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition.map((n) => n.id)).toEqual(["during"]);
    });

    it("an empty list when no active version overlaps the block — \"Not set\"", async () => {
      vi.mocked(listBlocks).mockResolvedValue([
        block("a", "2026-06-01", "2026-06-14"), // ends before the version starts
        block("b", "2026-06-15", "2026-06-28"),
      ]);
      versionsResult = { data: [version("v", "2026-06-15", "2026-06-28", 2500, 2000)], error: null };

      const facts = await getBlockFacts(CLIENT_ID, TODAY);
      expect(facts[0].nutrition).toEqual([]);
      expect(facts[1].nutrition.map((n) => n.calories)).toEqual([2000]);
    });

    it("reads one versions statement for the whole journey, and no day", async () => {
      vi.mocked(listBlocks).mockResolvedValue([block("a", "2022-01-03", "2026-08-01")]);
      versionsResult = { data: [version("v", "2020-01-01", "2026-08-01", 2400, 1800)], error: null };

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);
      expect(fact.nutrition).toHaveLength(1);
      const tables = vi.mocked(supabaseAdmin.from).mock.calls.map((call) => String(call[0]));
      expect(tables.filter((table) => table === "nutrition_plans")).toHaveLength(1);
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

  it("a block's last day is still its own — a program starting on it is the block's", async () => {
    // The mirror of the case above, at the other edge: both ends are inclusive,
    // so a program whose first day is the block's last day ran a day of it.
    vi.mocked(listBlocks).mockResolvedValue([
      block("a", "2026-03-15", "2026-04-11"),
      block("b", "2026-04-12", "2026-05-09"),
    ]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p1", name: "Peak", effectiveFrom: "2026-04-11", effectiveUntil: "2026-05-09" },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].training.map((t) => t.id)).toEqual(["p1"]);
    expect(facts[1].training.map((t) => t.id)).toEqual(["p1"]);
  });

  it("the days after every window belong to no program", async () => {
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

  it("lists the block's programs in start order, which is what the headline reads", async () => {
    vi.mocked(listBlocks).mockResolvedValue([block("a", "2026-06-01", "2026-06-28")]);
    vi.mocked(getTrainingPlansOverlapping).mockResolvedValue([
      { id: "p1", name: "Base", effectiveFrom: "2026-06-01", effectiveUntil: "2026-06-14" },
      { id: "p2", name: "Peak", effectiveFrom: "2026-06-15", effectiveUntil: "2026-06-28" },
    ]);

    const facts = await getBlockFacts(CLIENT_ID, TODAY);
    expect(facts[0].training.map((t) => t.id)).toEqual(["p1", "p2"]);
  });

  // The note is a column on the version (migration 172), so it rides the same
  // read as the numbers and an archived version takes it out of the facts.
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

      const [fact] = await getBlockFacts(CLIENT_ID, TODAY);

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

      await getBlockFacts(CLIENT_ID, TODAY);

      const tables = vi.mocked(supabaseAdmin.from).mock.calls.map((call) => String(call[0]));
      expect(tables).not.toContain("nutrition_plan_notes");
      expect(tables.filter((table) => table === "nutrition_plans")).toHaveLength(1);
    });
  });
});
