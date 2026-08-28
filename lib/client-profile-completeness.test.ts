import { describe, expect, it } from "vitest";
import {
  findProfileGaps,
  gapsNeedMeasurement,
  hasStartWeight,
  type ProfileEnergyFields,
} from "./client-profile-completeness";

// The reason this module exists: "does a TDEE exist?" is NOT the same question
// as "is this client's profile complete". computeEnergyPair hard-gates on
// weight/height/gender but SILENTLY substitutes a default age and a default
// activity multiplier — so a client missing both still gets a BMR and a TDEE,
// and a tdee-not-null check would call them ready.

function makeClient(
  overrides: Partial<ProfileEnergyFields> = {}
): ProfileEnergyFields {
  return {
    currentWeight: 82,
    height: 180,
    gender: "male",
    currentBodyFatPercentage: undefined,
    dateOfBirth: "1991-04-02",
    workActivityLevel: "moderately_active",
    tdeeManualOverride: undefined,
    ...overrides,
  };
}

describe("findProfileGaps", () => {
  it("reports nothing for a fully-specified client", () => {
    expect(findProfileGaps(makeClient())).toEqual([]);
  });

  it("catches the silent defaults a tdee-not-null check would miss", () => {
    // Weight, height and gender are all present, so the pair COMPUTES — the
    // client has a BMR and a TDEE. Both are built on assumptions.
    const gaps = findProfileGaps(
      makeClient({ dateOfBirth: undefined, workActivityLevel: undefined })
    );
    expect(gaps).toEqual(["age", "activity level"]);
  });

  it("reports only the hard-missing inputs when the pair cannot compute", () => {
    // No pair at all means nothing downstream has a TDEE to solve against;
    // "add an activity level" would be noise beside "add a weight".
    const gaps = findProfileGaps(
      makeClient({
        currentWeight: undefined,
        height: undefined,
        dateOfBirth: undefined,
        workActivityLevel: undefined,
      })
    );
    expect(gaps).toEqual(["weight", "height"]);
  });

  it("treats an unrecognized gender as missing, not as 'other'", () => {
    const gaps = findProfileGaps(
      makeClient({ gender: "unspecified" as ProfileEnergyFields["gender"] })
    );
    expect(gaps).toEqual(["gender"]);
  });

  it("does NOT ask for a birth date on the Katch-McArdle path", () => {
    // Lean-body-mass math has no age term, so a missing DOB changes nothing —
    // the same rule the profile form's birth-date nudge already applies.
    const gaps = findProfileGaps(
      makeClient({ dateOfBirth: undefined, currentBodyFatPercentage: 18 })
    );
    expect(gaps).toEqual([]);
  });

  it("still asks for a birth date on the Mifflin path", () => {
    const gaps = findProfileGaps(
      makeClient({ dateOfBirth: undefined, currentBodyFatPercentage: undefined })
    );
    expect(gaps).toEqual(["age"]);
  });

  it("stops asking for an activity level once the coach has overridden TDEE", () => {
    // Activity feeds the TDEE multiplier and nothing else. A coach who typed a
    // custom TDEE has overridden the only thing it touches, so nagging them
    // would be a permanent false alarm on a deliberate choice.
    const gaps = findProfileGaps(
      makeClient({ workActivityLevel: undefined, tdeeManualOverride: true })
    );
    expect(gaps).toEqual([]);
  });

  it("keeps asking for the other gaps despite a TDEE override", () => {
    const gaps = findProfileGaps(
      makeClient({
        workActivityLevel: undefined,
        dateOfBirth: undefined,
        tdeeManualOverride: true,
      })
    );
    expect(gaps).toEqual(["age"]);
  });
});

describe("gapsNeedMeasurement", () => {
  it("routes a missing weight to the measurement surface", () => {
    // The profile editor holds gender, birth date, height and activity level —
    // and NOT weight, which is a logged measurement. Sending a coach there to
    // add a weight is a dead end.
    expect(gapsNeedMeasurement(["weight", "height"])).toBe(true);
  });

  it("routes everything else to the profile editor", () => {
    expect(gapsNeedMeasurement(["height", "gender", "age"])).toBe(false);
    expect(gapsNeedMeasurement([])).toBe(false);
  });
});

describe("hasStartWeight", () => {
  // The one definition of "the intake metrics have landed", shared by the
  // panel's gate, the review actions' gate and the activation route's refusal —
  // so a greyed button and the rule behind it cannot disagree.
  it("is true once a weight is on the profile", () => {
    expect(hasStartWeight({ currentWeight: 92 })).toBe(true);
  });

  it("is false while the profile has none", () => {
    expect(hasStartWeight({ currentWeight: undefined })).toBe(false);
    expect(hasStartWeight(null)).toBe(false);
    expect(hasStartWeight(undefined)).toBe(false);
  });

  it("treats a logged zero as a weight, not as absence", () => {
    // `!= null`, not falsiness. Nobody weighs 0kg, but a predicate that reads
    // 0 as "not set" is the bug that eventually finds a real 0-valued field.
    expect(hasStartWeight({ currentWeight: 0 })).toBe(true);
  });
});
