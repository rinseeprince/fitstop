import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeEnergyPair,
  toActivityLevel,
  calculateAge,
} from "./client-energy-calc";
import { getActivityMultiplier } from "@/utils/nutrition-helpers";
import type { ActivityLevel } from "@/types/check-in";

// A complete, Mifflin-path client (no body fat) unless a test says otherwise.
const BASE = {
  weightKg: 80,
  heightCm: 180,
  gender: "male" as const,
  dateOfBirth: "1996-01-01",
  activityLevel: "sedentary",
  now: new Date("2026-08-12T12:00:00Z"),
};

describe("computeEnergyPair", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formula selection", () => {
    it("uses Katch-McArdle when body fat is known", () => {
      // The verified fixture: 170 kg at 9 % body fat.
      // 370 + 21.6 x (170 x 0.91) = 3711.52 -> 3712.
      const result = computeEnergyPair({
        ...BASE,
        weightKg: 170,
        bodyFatPercentage: 9,
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.bmr).toBe(3712);
      expect(result.method).toBe("katch_mcardle");
    });

    it("uses Mifflin-St Jeor when body fat is absent, per gender", () => {
      // 10(80) + 6.25(180) - 5(30) = 1775, then +5 / -161 / -78.
      const male = computeEnergyPair(BASE);
      const female = computeEnergyPair({ ...BASE, gender: "female" });
      const other = computeEnergyPair({ ...BASE, gender: "other" });

      expect(male.status === "ready" && male.bmr).toBe(1780);
      expect(female.status === "ready" && female.bmr).toBe(1614);
      expect(other.status === "ready" && other.bmr).toBe(1697);
      expect(male.status === "ready" && male.method).toBe("mifflin_st_jeor");
    });

    it("treats a body fat of 0 as absent and falls back to Mifflin", () => {
      const result = computeEnergyPair({ ...BASE, bodyFatPercentage: 0 });

      expect(result.status === "ready" && result.method).toBe("mifflin_st_jeor");
    });
  });

  describe("TDEE", () => {
    const LEVELS: ActivityLevel[] = [
      "sedentary",
      "lightly_active",
      "moderately_active",
      "very_active",
      "extremely_active",
    ];

    it.each(LEVELS)("applies the %s multiplier", (level) => {
      const result = computeEnergyPair({ ...BASE, activityLevel: level });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.tdee).toBe(
        Math.round(result.bmr * getActivityMultiplier(level))
      );
      expect(result.activityLevel).toBe(level);
      expect(result.activityLevelSource).toBe("client");
    });

    it("derives TDEE from the ROUNDED bmr, so the stored pair is reproducible", () => {
      // 21.6 x lean mass rarely lands on an integer, so raw-vs-rounded is a
      // real divergence: a UI recomputing tdee from the stored bmr must get
      // the stored tdee back, not a value one calorie away.
      const result = computeEnergyPair({
        ...BASE,
        weightKg: 83.7,
        bodyFatPercentage: 17.3,
        activityLevel: "very_active",
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.tdee).toBe(
        Math.round(result.bmr * getActivityMultiplier("very_active"))
      );
    });
  });

  describe("activity level resolution", () => {
    it("falls back to the default when null", () => {
      const result = computeEnergyPair({ ...BASE, activityLevel: null });

      expect(result.status === "ready" && result.activityLevel).toBe("sedentary");
      expect(result.status === "ready" && result.activityLevelSource).toBe("default");
    });

    it("warns and defaults on an unrecognized value, never producing NaN", () => {
      // getActivityMultiplier does an unguarded Record lookup, so without the
      // normalizer this path yields Math.round(bmr * undefined) = NaN, which
      // would be written into a NUMERIC column.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = computeEnergyPair({ ...BASE, activityLevel: "athlete" });

      expect(warn).toHaveBeenCalledOnce();
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.activityLevel).toBe("sedentary");
      expect(Number.isNaN(result.tdee)).toBe(false);
    });

    it("toActivityLevel reports its source", () => {
      expect(toActivityLevel("very_active")).toEqual({
        level: "very_active",
        source: "client",
      });
      expect(toActivityLevel(null)).toEqual({
        level: "sedentary",
        source: "default",
      });
    });
  });

  describe("age", () => {
    it("assumes the default when no birth date is stored", () => {
      const result = computeEnergyPair({ ...BASE, dateOfBirth: null });

      expect(result.status === "ready" && result.ageYears).toBe(30);
      expect(result.status === "ready" && result.ageSource).toBe("assumed_default");
    });

    it("reports age as not required on the Katch path", () => {
      const result = computeEnergyPair({
        ...BASE,
        bodyFatPercentage: 20,
        dateOfBirth: null,
      });

      expect(result.status === "ready" && result.ageSource).toBe("not_required");
    });

    it("measures age against the injected clock, not the wall clock", () => {
      // The seed scripts guarantee byte-identical output per --seed, so this
      // calculator must never read the real clock.
      const early = computeEnergyPair({
        ...BASE,
        now: new Date("2026-08-12T12:00:00Z"),
      });
      const later = computeEnergyPair({
        ...BASE,
        now: new Date("2036-08-12T12:00:00Z"),
      });

      expect(early.status === "ready" && early.ageYears).toBe(30);
      expect(later.status === "ready" && later.ageYears).toBe(40);
    });

    it("calculateAge does not count an unreached birthday", () => {
      expect(calculateAge("1996-09-01", new Date("2026-08-12T12:00:00Z"))).toBe(29);
      expect(calculateAge("1996-09-01", new Date("2026-09-01T12:00:00Z"))).toBe(30);
    });
  });

  describe("insufficient data", () => {
    it.each([
      ["weight", { weightKg: null }],
      ["height", { heightCm: null }],
      ["gender", { gender: null }],
    ])("reports %s as missing", (field, override) => {
      const result = computeEnergyPair({ ...BASE, ...override });

      expect(result.status).toBe("insufficient");
      if (result.status !== "insufficient") return;
      expect(result.missing).toContain(field);
    });

    it("names every missing field at once", () => {
      const result = computeEnergyPair({
        weightKg: null,
        heightCm: null,
        gender: null,
      });

      expect(result.status === "insufficient" && result.missing).toEqual([
        "weight",
        "height",
        "gender",
      ]);
    });

    it("treats an unrecognized gender as missing, not as 'other'", () => {
      // lib/mappers.ts CASTS gender rather than checking it, so nothing
      // upstream guarantees the union. Silently costing such a client through
      // the "other" branch would be a guess presented as a measurement.
      const result = computeEnergyPair({ ...BASE, gender: "unspecified" });

      expect(result.status).toBe("insufficient");
      if (result.status !== "insufficient") return;
      expect(result.missing).toEqual(["gender"]);
    });
  });
});
