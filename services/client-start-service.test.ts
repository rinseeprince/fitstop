import { describe, it, expect, vi, beforeEach } from "vitest";

const { upsertMetricEntry, state } = vi.hoisted(() => ({
  upsertMetricEntry: vi.fn().mockResolvedValue({}),
  state: {
    row: {} as Record<string, unknown>,
    updates: [] as Record<string, unknown>[],
    deletes: [] as { date?: string; key?: string; keys?: string[] }[],
  },
}));

vi.mock("./metric-entries-service", () => ({ upsertMetricEntry }));

vi.mock("./supabase-admin", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "clients") {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: state.row, error: null }) }),
          }),
          update: (payload: Record<string, unknown>) => {
            state.updates.push(payload);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      // client_metric_entries. Two delete shapes reach here: the MOVE, which
      // takes both start keys at once (`.in`), and a single WITHDRAWAL
      // (`.eq("metric_key", …)`), whose terminal call is awaited directly —
      // hence the thenable.
      const captured: { date?: string } = {};
      const chain = {
        delete: () => chain,
        eq: (col: string, value: string) => {
          if (col === "entry_date") captured.date = value;
          if (col === "metric_key") {
            state.deletes.push({ date: captured.date, key: value });
          }
          return chain;
        },
        in: (_col: string, keys: string[]) => {
          state.deletes.push({ date: captured.date, keys });
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      };
      return chain;
    },
  },
}));

import { recordClientStart } from "./client-start-service";

beforeEach(() => {
  upsertMetricEntry.mockClear();
  state.row = {};
  state.updates = [];
  state.deletes = [];
});

/** The upserts this call issued, as {metricKey, value, entryDate}. */
function entries() {
  return upsertMetricEntry.mock.calls.map(([, input]) => input);
}

describe("recordClientStart", () => {
  it("logs the stored start measurements on the day it is given", async () => {
    // Activation: the date arrives, the values were captured at intake or
    // manual add. Both land as ordinary entries, which is what puts the start
    // weight on the Physique chart with no chart code.
    state.row = { start_date: null, starting_weight: 90, starting_body_fat_percentage: 24 };

    await recordClientStart("c1", { startsOn: "2026-08-21", coachId: "coach-1" });

    expect(state.updates[0].start_date).toBe("2026-08-21");
    expect(entries()).toEqual([
      { metricKey: "weight", value: 90, entryDate: "2026-08-21", coachId: "coach-1" },
      { metricKey: "bodyFat", value: 24, entryDate: "2026-08-21", coachId: "coach-1" },
    ]);
  });

  it("writes nothing to the chart for a client with no measurements", async () => {
    state.row = { start_date: null, starting_weight: null, starting_body_fat_percentage: null };

    await recordClientStart("c1", { startsOn: "2026-08-21", coachId: "coach-1" });

    expect(state.updates[0].start_date).toBe("2026-08-21");
    expect(entries()).toEqual([]);
  });

  it("MOVES the pair when the start date changes", async () => {
    // The entries are keyed by date. Left behind they orphan at the old date
    // and the chart's first point stops being the start weight.
    state.row = { start_date: "2026-08-21", starting_weight: 90, starting_body_fat_percentage: 24 };

    await recordClientStart("c1", { startsOn: "2026-08-14", coachId: "coach-1" });

    expect(state.deletes).toEqual([
      { date: "2026-08-21", keys: ["weight", "bodyFat"] },
    ]);
    expect(entries().map((e) => e.entryDate)).toEqual(["2026-08-14", "2026-08-14"]);
  });

  it("does not delete anything when the date is unchanged", async () => {
    state.row = { start_date: "2026-08-21", starting_weight: 90, starting_body_fat_percentage: null };

    await recordClientStart("c1", { weightKg: 92, coachId: "coach-1" });

    expect(state.deletes).toEqual([]);
    expect(state.updates[0].starting_weight).toBe(92);
    // The upsert replaces the entry on that date — same (client, metric, date).
    expect(entries()).toEqual([
      { metricKey: "weight", value: 92, entryDate: "2026-08-21", coachId: "coach-1" },
    ]);
  });

  it("REMOVES the entry when a start body fat is withdrawn", async () => {
    // null means "we no longer believe that figure", not "leave it alone" —
    // so the entry comes off the chart rather than staying plotted.
    state.row = { start_date: "2026-08-21", starting_weight: 90, starting_body_fat_percentage: 24 };

    await recordClientStart("c1", { bodyFatPercentage: null, coachId: "coach-1" });

    expect(state.updates[0].starting_body_fat_percentage).toBeNull();
    expect(state.deletes).toEqual([
      { date: "2026-08-21", key: "bodyFat" },
    ]);
    // The weight is untouched and still re-stated on its own entry.
    expect(entries()).toEqual([
      { metricKey: "weight", value: 90, entryDate: "2026-08-21", coachId: "coach-1" },
    ]);
  });

  it("keeps the values on the columns while there is no start date yet", async () => {
    // A client set up but not activated: nothing to date a measurement at, so
    // the value waits on the column until activation gives it a day.
    state.row = { start_date: null, starting_weight: null, starting_body_fat_percentage: null };

    await recordClientStart("c1", { weightKg: 88, coachId: "coach-1" });

    expect(state.updates[0].starting_weight).toBe(88);
    expect(entries()).toEqual([]);
  });

  it("leaves an unsupplied value alone rather than clearing it", async () => {
    state.row = { start_date: "2026-08-21", starting_weight: 90, starting_body_fat_percentage: 24 };

    await recordClientStart("c1", { bodyFatPercentage: 22, coachId: "coach-1" });

    expect(state.updates[0]).not.toHaveProperty("starting_weight");
    // …but the weight is still re-stated on the entry, so the pair on that date
    // always describes the same origin.
    expect(entries().map((e) => e.value)).toEqual([90, 22]);
  });
});
