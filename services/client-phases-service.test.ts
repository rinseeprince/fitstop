import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from "./supabase-admin";
import {
  getClientPhases,
  replaceClientPhases,
  deleteClientPhase,
  PhaseWriteError,
} from "./client-phases-service";

const mockFrom = vi.mocked(supabaseAdmin.from);

type Row = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  rate_per_week_kg: number;
  daily_targets: unknown;
};

const GRID = [
  { day_of_week: "monday", calories: 2000, protein_g: 180, carb_g: 200, fat_g: 60 },
];

function row(
  id: string,
  name: string,
  starts_on: string,
  ends_on: string,
  rate_per_week_kg = -0.5,
  daily_targets: unknown = null
): Row {
  return { id, name, starts_on, ends_on, rate_per_week_kg, daily_targets };
}

/**
 * The service issues three query shapes: a thenable select chain, a thenable
 * delete chain, and a thenable upsert. Every chain method returns `this` so the
 * assertions can spy on the same object the service chained from.
 */
function createQuery(result: { data: unknown; error: { message: string } | null }) {
  const q: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
  };
  Object.defineProperty(q, "then", {
    value: (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve),
  });
  return q as ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * `replaceClientPhases` reads, may delete, may upsert, then re-reads. Queue the
 * queries in call order and hand them out one at a time.
 */
function wire(queries: ReturnType<typeof createQuery>[]) {
  let i = 0;
  mockFrom.mockImplementation(() => {
    const q = queries[i];
    i += 1;
    if (!q) throw new Error(`Unexpected from() call #${i}`);
    return q as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getClientPhases", () => {
  it("scopes to the client and orders by starts_on", async () => {
    const q = createQuery({
      data: [row("a", "Cut 1", "2026-08-03", "2026-09-27", -0.6, GRID)],
      error: null,
    });
    wire([q]);

    const phases = await getClientPhases("client-1");

    expect(q.eq).toHaveBeenCalledWith("client_id", "client-1");
    expect(q.order).toHaveBeenCalledWith("starts_on", { ascending: true });
    expect(phases).toEqual([
      {
        id: "a",
        name: "Cut 1",
        startsOn: "2026-08-03",
        endsOn: "2026-09-27",
        ratePerWeekKg: -0.6,
        dailyTargets: GRID,
      },
    ]);
  });

  it("throws rather than returning an empty list when the read fails", async () => {
    wire([createQuery({ data: null, error: { message: "boom" } })]);
    await expect(getClientPhases("client-1")).rejects.toThrow("Failed to fetch blocks: boom");
  });
});

describe("replaceClientPhases", () => {
  it("chains dates from the start date and writes them", async () => {
    const read = createQuery({ data: [], error: null });
    const upsert = createQuery({ data: null, error: null });
    const reread = createQuery({ data: [], error: null });
    wire([read, upsert, reread]);

    await replaceClientPhases(
      "client-1",
      {
        startDate: "2026-08-03",
        phases: [
          { name: "Cut 1", weeks: 8, ratePerWeekKg: -0.6 },
          { name: "Diet break", weeks: 2, ratePerWeekKg: 0 },
        ],
      },
      "2026-08-01"
    );

    const rows = upsert.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.starts_on, r.ends_on])).toEqual([
      ["2026-08-03", "2026-09-27"],
      ["2026-09-28", "2026-10-11"],
    ]);
    expect(upsert.upsert.mock.calls[0][1]).toEqual({ onConflict: "id" });
    // Every row carries an id, so this is one statement rather than a mixed
    // insert/update pair — PostgREST requires identical keys across the array.
    expect(rows.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
    expect(rows.every((r) => typeof r.updated_at === "string")).toBe(true);
  });

  it("keeps a grid when only the name changed", async () => {
    const existing = row("a", "Cut 1", "2026-08-03", "2026-09-27", -0.6, GRID);
    wire([
      createQuery({ data: [existing], error: null }),
      createQuery({ data: null, error: null }),
      createQuery({ data: [], error: null }),
    ]);

    await replaceClientPhases(
      "client-1",
      {
        startDate: "2026-08-03",
        phases: [{ id: "a", name: "Fat loss 1", weeks: 8, ratePerWeekKg: -0.6 }],
      },
      "2026-08-01"
    );

    const upsertQuery = mockFrom.mock.results[1].value as ReturnType<typeof createQuery>;
    const rows = upsertQuery.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].daily_targets).toEqual(GRID);
  });

  it("clears the grid when the rate changes", async () => {
    const existing = row("a", "Cut 1", "2026-08-03", "2026-09-27", -0.6, GRID);
    wire([
      createQuery({ data: [existing], error: null }),
      createQuery({ data: null, error: null }),
      createQuery({ data: [], error: null }),
    ]);

    await replaceClientPhases(
      "client-1",
      {
        startDate: "2026-08-03",
        phases: [{ id: "a", name: "Cut 1", weeks: 8, ratePerWeekKg: -0.4 }],
      },
      "2026-08-01"
    );

    const upsertQuery = mockFrom.mock.results[1].value as ReturnType<typeof createQuery>;
    const rows = upsertQuery.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    // A grid computed for -0.6 kg/wk is not valid for -0.4. Clearing it is what
    // makes "non-null grid" trustworthy to the per-date resolver.
    expect(rows[0].daily_targets).toBeNull();
  });

  it("clears the grid when the dates shift, even with the same rate", async () => {
    const existing = row("a", "Cut 1", "2026-08-03", "2026-09-27", -0.6, GRID);
    wire([
      createQuery({ data: [existing], error: null }),
      createQuery({ data: null, error: null }),
      createQuery({ data: [], error: null }),
    ]);

    await replaceClientPhases(
      "client-1",
      {
        startDate: "2026-08-10",
        phases: [{ id: "a", name: "Cut 1", weeks: 8, ratePerWeekKg: -0.6 }],
      },
      "2026-08-01"
    );

    const upsertQuery = mockFrom.mock.results[1].value as ReturnType<typeof createQuery>;
    const rows = upsertQuery.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].daily_targets).toBeNull();
  });

  it("rejects removing an elapsed block", async () => {
    const elapsed = row("a", "Cut 1", "2026-06-01", "2026-07-26", -0.6);
    wire([createQuery({ data: [elapsed], error: null })]);

    await expect(
      replaceClientPhases(
        "client-1",
        { startDate: "2026-07-27", phases: [{ name: "Cut 2", weeks: 4, ratePerWeekKg: -0.5 }] },
        "2026-07-29"
      )
    ).rejects.toThrow(PhaseWriteError);
  });

  it("rejects a change that would drag an elapsed block's dates", async () => {
    // The client sends LENGTHS, so shortening an earlier block silently moves
    // every later one. Validating the COMPUTED dates is what catches it.
    const elapsed = row("a", "Cut 1", "2026-06-01", "2026-07-26", -0.6);
    wire([createQuery({ data: [elapsed], error: null })]);

    await expect(
      replaceClientPhases(
        "client-1",
        {
          startDate: "2026-06-08",
          phases: [{ id: "a", name: "Cut 1", weeks: 8, ratePerWeekKg: -0.6 }],
        },
        "2026-07-29"
      )
    ).rejects.toThrow(/dates cannot change/);
  });

  it("leaves elapsed rows out of the write entirely", async () => {
    const elapsed = row("a", "Cut 1", "2026-06-01", "2026-07-26", -0.6);
    wire([
      createQuery({ data: [elapsed], error: null }),
      createQuery({ data: null, error: null }),
      createQuery({ data: [], error: null }),
    ]);

    await replaceClientPhases(
      "client-1",
      {
        startDate: "2026-06-01",
        phases: [
          { id: "a", name: "Cut 1", weeks: 8, ratePerWeekKg: -0.6 },
          { name: "Cut 2", weeks: 4, ratePerWeekKg: -0.5 },
        ],
      },
      "2026-07-29"
    );

    const upsertQuery = mockFrom.mock.results[1].value as ReturnType<typeof createQuery>;
    const rows = upsertQuery.upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Cut 2");
  });

  it("rejects an id that belongs to no block of this client", async () => {
    wire([createQuery({ data: [], error: null })]);

    await expect(
      replaceClientPhases(
        "client-1",
        {
          startDate: "2026-08-03",
          phases: [
            { id: "11111111-1111-1111-1111-111111111111", name: "X", weeks: 4, ratePerWeekKg: 0 },
          ],
        },
        "2026-08-01"
      )
    ).rejects.toThrow("That block no longer exists");
  });
});

describe("deleteClientPhase", () => {
  const chain = [
    row("a", "Cut 1", "2026-08-03", "2026-09-27", -0.6),
    row("b", "Diet break", "2026-09-28", "2026-10-11", 0),
    row("c", "Cut 2", "2026-10-12", "2026-11-22", -0.5),
  ];

  it("shifts later blocks back into the gap and reports the moves", async () => {
    wire([
      createQuery({ data: chain, error: null }),
      // replaceClientPhases: read, delete, upsert, re-read
      createQuery({ data: chain, error: null }),
      createQuery({ data: null, error: null }),
      createQuery({ data: null, error: null }),
      createQuery({ data: [], error: null }),
    ]);

    const result = await deleteClientPhase("client-1", "b", "2026-08-01");

    expect(result.deletedName).toBe("Diet break");
    expect(result.shifted).toEqual([
      { id: "c", name: "Cut 2", startsOn: "2026-09-28", endsOn: "2026-11-08" },
    ]);
    // "Cut 1" is before the deleted block, so it does not move.
    expect(result.shifted.find((s) => s.id === "a")).toBeUndefined();
  });

  it("refuses to delete an elapsed block", async () => {
    wire([createQuery({ data: chain, error: null })]);
    await expect(deleteClientPhase("client-1", "a", "2026-10-01")).rejects.toThrow(
      /already finished/
    );
  });

  it("404s on an unknown block", async () => {
    wire([createQuery({ data: chain, error: null })]);
    await expect(deleteClientPhase("client-1", "zzz", "2026-08-01")).rejects.toThrow(
      "That block no longer exists"
    );
  });

  it("deletes the last remaining block without re-chaining", async () => {
    const single = [chain[0]];
    wire([
      createQuery({ data: single, error: null }),
      createQuery({ data: null, error: null }),
    ]);

    const result = await deleteClientPhase("client-1", "a", "2026-08-01");
    expect(result.phases).toEqual([]);
    expect(result.shifted).toEqual([]);
  });
});
