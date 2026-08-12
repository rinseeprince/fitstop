import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase-admin", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/error-handler", () => ({ captureApiError: vi.fn() }));

import { supabaseAdmin } from "./supabase-admin";
import { recalculateClientEnergy } from "./client-energy-service";
import { computeEnergyPair } from "./client-energy-calc";

const NOW = new Date("2026-08-12T12:00:00Z");

/** A complete client on the Mifflin path, sedentary, no overrides. */
function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    current_weight: 80,
    current_body_fat_percentage: null,
    height: 180,
    gender: "male",
    date_of_birth: "1996-01-01",
    work_activity_level: "sedentary",
    bmr: 1700,
    tdee: 2040,
    bmr_manual_override: false,
    tdee_manual_override: false,
    ...overrides,
  };
}

/** What the calculator says for a given row — so expectations never hardcode
 *  a number the calculator owns. */
function expected(row: ReturnType<typeof clientRow>) {
  const result = computeEnergyPair({
    weightKg: row.current_weight,
    heightCm: row.height,
    gender: row.gender,
    bodyFatPercentage: row.current_body_fat_percentage,
    dateOfBirth: row.date_of_birth,
    activityLevel: row.work_activity_level,
    now: NOW,
  });
  if (result.status !== "ready") throw new Error("fixture is not computable");
  return result;
}

let updateQuery: {
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

/** Table-routed stubbing, the body-metrics-service.test.ts idiom: the read and
 *  the write are distinct objects so each can be asserted independently. */
function wire(
  row: Record<string, unknown> | null,
  opts: { readError?: unknown; writeError?: unknown; writtenRow?: unknown } = {}
) {
  const readQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: row, error: opts.readError ?? null }),
  };
  updateQuery = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      // `in` rather than `??`: an explicitly-null writtenRow is the zero-row
      // case under test, and a nullish default would silently swallow it.
      data:
        opts.writeError != null
          ? null
          : "writtenRow" in opts
            ? opts.writtenRow
            : { bmr: 1, tdee: 1 },
      error: opts.writeError ?? null,
    }),
  };

  let call = 0;
  vi.mocked(supabaseAdmin.from).mockImplementation((() => {
    call += 1;
    return call === 1 ? readQuery : updateQuery;
  }) as never);
}

function payload() {
  return updateQuery.update.mock.calls[0][0] as Record<string, unknown>;
}

describe("recalculateClientEnergy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("the pair is atomic", () => {
    it("writes exactly { bmr, tdee } on a plain recompute — no flags, no updated_at", () => {
      // Exact-object: a stray flag key here would silently clobber a flag set
      // by a concurrent request, and updated_at is the DB trigger's job.
      const row = clientRow();
      wire(row);

      return recalculateClientEnergy("client-1", { now: NOW }).then((result) => {
        const e = expected(row);
        expect(payload()).toEqual({ bmr: e.bmr, tdee: e.tdee });
        expect(result.status).toBe("written");
        expect(result.bmr).toBe(e.bmr);
        expect(result.tdee).toBe(e.tdee);
      });
    });

    it.each([
      ["neither frozen", {}],
      ["bmr frozen", { bmr_manual_override: true }],
      ["tdee frozen", { tdee_manual_override: true }],
    ])("carries BOTH keys when %s", async (_label, flags) => {
      wire(clientRow(flags));

      await recalculateClientEnergy("client-1", { now: NOW });

      expect(payload()).toHaveProperty("bmr");
      expect(payload()).toHaveProperty("tdee");
    });

    it.each([
      ["body fat present (Katch)", { current_body_fat_percentage: 22 }],
      ["body fat absent (Mifflin)", { current_body_fat_percentage: null }],
    ])("recomputes both halves on a weight change — %s", async (_label, bf) => {
      const row = clientRow({ ...bf, current_weight: 91 });
      wire(row);

      const result = await recalculateClientEnergy("client-1", { now: NOW });
      const e = expected(row);

      expect(result.bmr).toBe(e.bmr);
      expect(result.tdee).toBe(e.tdee);
      expect(result.bmrDisposition).toBe("computed");
      expect(result.tdeeDisposition).toBe("computed");
    });
  });

  describe("override flags freeze exactly their own half", () => {
    it("a frozen BMR is written back, and TDEE derives FROM it", async () => {
      const row = clientRow({ bmr_manual_override: true, bmr: 2000 });
      wire(row);

      const result = await recalculateClientEnergy("client-1", { now: NOW });

      expect(result.bmr).toBe(2000);
      expect(result.bmrDisposition).toBe("frozen");
      // sedentary = 1.2
      expect(result.tdee).toBe(2400);
      expect(result.tdeeDisposition).toBe("computed");
    });

    it("a frozen TDEE stays pinned while BMR moves with weight", async () => {
      const row = clientRow({ tdee_manual_override: true, tdee: 3100 });
      wire(row);

      const result = await recalculateClientEnergy("client-1", { now: NOW });

      expect(result.tdee).toBe(3100);
      expect(result.tdeeDisposition).toBe("frozen");
      expect(result.bmr).toBe(expected(row).bmr);
      expect(result.bmrDisposition).toBe("computed");
    });

    it("writes nothing when both halves are frozen", async () => {
      wire(clientRow({ bmr_manual_override: true, tdee_manual_override: true }));

      const result = await recalculateClientEnergy("client-1", { now: NOW });

      expect(result.status).toBe("noop_all_frozen");
      expect(supabaseAdmin.from).toHaveBeenCalledTimes(1); // read only
    });

    it("recomputes a flag set over a NULL value — a vacuous freeze is not a freeze", async () => {
      // Otherwise a stray boolean permanently blocks the client from ever
      // getting a BMR, and validateClientForNutrition keeps rejecting them.
      const row = clientRow({ bmr_manual_override: true, bmr: null });
      wire(row);

      const result = await recalculateClientEnergy("client-1", { now: NOW });

      expect(result.bmr).toBe(expected(row).bmr);
      expect(result.bmrDisposition).toBe("backfilled");
      expect(result.bmrManualOverride).toBe(true); // flag left alone
    });
  });

  describe("override instructions", () => {
    it("setting a custom TDEE freezes it and recomputes BMR in the same write", async () => {
      const row = clientRow();
      wire(row);

      const result = await recalculateClientEnergy("client-1", {
        now: NOW,
        overrides: { tdee: { action: "set", value: 3100 } },
      });

      expect(payload()).toEqual({
        bmr: expected(row).bmr,
        tdee: 3100,
        tdee_manual_override: true,
      });
      expect(result.tdeeManualOverride).toBe(true);
    });

    it("setting a custom BMR derives TDEE from THAT value", async () => {
      wire(clientRow());

      const result = await recalculateClientEnergy("client-1", {
        now: NOW,
        overrides: { bmr: { action: "set", value: 2000 } },
      });

      expect(result.bmr).toBe(2000);
      expect(result.tdee).toBe(2400); // 2000 x 1.2, not stored-bmr x 1.2
    });

    it("clearing an override recomputes that half", async () => {
      const row = clientRow({ tdee_manual_override: true, tdee: 3100 });
      wire(row);

      const result = await recalculateClientEnergy("client-1", {
        now: NOW,
        overrides: { tdee: { action: "clear" } },
      });

      expect(result.tdee).toBe(expected(row).tdee);
      expect(result.tdeeManualOverride).toBe(false);
      expect(payload()).toHaveProperty("tdee_manual_override", false);
    });

    it("clearing the BMR override leaves a frozen TDEE pinned", async () => {
      const row = clientRow({
        bmr_manual_override: true,
        bmr: 2000,
        tdee_manual_override: true,
        tdee: 3100,
      });
      wire(row);

      const result = await recalculateClientEnergy("client-1", {
        now: NOW,
        overrides: { bmr: { action: "clear" } },
      });

      expect(result.bmr).toBe(expected(row).bmr);
      expect(result.tdee).toBe(3100);
    });

    it("adds only the flag key it was asked about", async () => {
      wire(clientRow());

      await recalculateClientEnergy("client-1", {
        now: NOW,
        overrides: { tdee: { action: "set", value: 3100 } },
      });

      expect(payload()).not.toHaveProperty("bmr_manual_override");
    });
  });

  describe("insufficient data", () => {
    it("writes nothing and nulls nothing", async () => {
      wire(clientRow({ height: null, bmr: 1700, tdee: 2040 }));

      const result = await recalculateClientEnergy("client-1", { now: NOW });

      expect(result.status).toBe("skipped_insufficient_data");
      expect(result.missing).toEqual(["height"]);
      expect(result.bmr).toBe(1700); // stored values reported, not destroyed
      expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    });

    it("still honours an explicit instruction, carrying the other half", async () => {
      // A coach's typed number is an assertion, not a computation — it must
      // land even for a client whose height is unknown.
      wire(clientRow({ height: null, bmr: 1700, tdee: 2040 }));

      const result = await recalculateClientEnergy("client-1", {
        now: NOW,
        overrides: { tdee: { action: "set", value: 3100 } },
      });

      expect(result.status).toBe("written");
      expect(payload()).toEqual({
        bmr: 1700,
        tdee: 3100,
        tdee_manual_override: true,
      });
      expect(result.bmrDisposition).toBe("carried");
    });
  });

  describe("idempotency", () => {
    it("two calls with unchanged inputs write identical values", async () => {
      const row = clientRow();
      wire(row);
      await recalculateClientEnergy("client-1", { now: NOW });
      const first = payload();

      vi.clearAllMocks();
      wire(row);
      await recalculateClientEnergy("client-1", { now: NOW });

      expect(payload()).toEqual(first);
    });

    it("age is the only legitimate drift — crossing a birthday moves the pair", async () => {
      const row = clientRow({ date_of_birth: "1996-08-20" });
      wire(row);
      await recalculateClientEnergy("client-1", {
        now: new Date("2026-08-12T12:00:00Z"),
      });
      const before = payload();

      vi.clearAllMocks();
      wire(row);
      await recalculateClientEnergy("client-1", {
        now: new Date("2026-08-21T12:00:00Z"),
      });

      expect(payload()).not.toEqual(before);
    });
  });

  describe("scoping and failure", () => {
    it("scopes the write to the coach when one is supplied", async () => {
      wire(clientRow());

      await recalculateClientEnergy("client-1", { now: NOW, coachId: "coach-9" });

      expect(updateQuery.eq).toHaveBeenCalledWith("id", "client-1");
      expect(updateQuery.eq).toHaveBeenCalledWith("coach_id", "coach-9");
    });

    it("reports failure when the write matches zero rows", async () => {
      // A forged clientId, or a coachId that does not own it. Silent success
      // here would report a recompute that never happened.
      wire(clientRow(), { writtenRow: null });

      const result = await recalculateClientEnergy("client-1", { now: NOW });

      expect(result.status).toBe("failed");
    });

    it("never throws on a DB error, and reports the stored pair", async () => {
      wire(clientRow(), { writeError: { message: "connection lost" } });

      const result = await recalculateClientEnergy("client-1", { now: NOW });

      expect(result.status).toBe("failed");
      expect(result.bmr).toBe(1700);
      expect(result.tdee).toBe(2040);
    });

    it("reports a missing client without writing", async () => {
      wire(null);

      const result = await recalculateClientEnergy("client-1", { now: NOW });

      expect(result.status).toBe("skipped_client_not_found");
      expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    });
  });
});
