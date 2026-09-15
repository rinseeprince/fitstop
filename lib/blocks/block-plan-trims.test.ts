import { describe, expect, it } from "vitest";
import { planBlockTrims, type TrimmablePlan } from "./block-plan-trims";

// The owner's examples (2026-09-15), dated as they were given, with the
// client's today in mid-September.
const TODAY = "2026-09-15";

const program = (name: string, startsOn: string, endsOn: string): TrimmablePlan => ({
  track: "training",
  id: `p-${name}`,
  name,
  startsOn,
  endsOn,
});

const targets = (startsOn: string, endsOn: string): TrimmablePlan => ({
  track: "nutrition",
  id: `v-${startsOn}`,
  name: null,
  startsOn,
  endsOn,
});

const drawn = (startsOn: string, endsOn: string) => ({ startsOn, endsOn, previousEndsOn: endsOn });
const shortened = (startsOn: string, endsOn: string, previousEndsOn: string) => ({
  startsOn,
  endsOn,
  previousEndsOn,
});

describe("planBlockTrims — a block contains its plans", () => {
  it("a plan that starts inside the block and runs past its end ends on the block's last day", () => {
    // Strength queued 6 Oct – 29 Nov, Build drawn 6 Oct – 2 Nov.
    const strength = program("Strength", "2026-10-06", "2026-11-29");
    expect(planBlockTrims([strength], [drawn("2026-10-06", "2026-11-02")], TODAY)).toEqual([
      { ...strength, newEndsOn: "2026-11-02" },
    ]);
  });

  it("nutrition targets are treated the same way", () => {
    const version = targets("2026-10-06", "2026-11-29");
    expect(planBlockTrims([version], [drawn("2026-10-06", "2026-11-02")], TODAY)).toEqual([
      { ...version, newEndsOn: "2026-11-02" },
    ]);
  });

  it("a queued plan a shorten leaves with no days is removed", () => {
    // Strength queued 20 Oct – 2 Nov in Build 6 Oct – 2 Nov; Build shortened to end 15 Oct.
    const strength = program("Strength", "2026-10-20", "2026-11-02");
    expect(
      planBlockTrims([strength], [shortened("2026-10-06", "2026-10-15", "2026-11-02")], TODAY)
    ).toEqual([{ ...strength, newEndsOn: null }]);
  });

  it("a shorten ends a plan running past the new end on it, and removes the one queued after it", () => {
    const first = program("Upper Lower", "2026-10-06", "2026-10-19");
    const second = program("Glute", "2026-10-20", "2026-11-02");
    expect(
      planBlockTrims([first, second], [shortened("2026-10-06", "2026-10-15", "2026-11-02")], TODAY)
    ).toEqual([
      { ...first, newEndsOn: "2026-10-15" },
      { ...second, newEndsOn: null },
    ]);
  });

  it("a program already running ends the day before a block drawn over it — and loses its days after the block too", () => {
    const running = program("Upper Lower", "2026-09-08", "2026-11-29");
    expect(planBlockTrims([running], [drawn("2026-10-06", "2026-11-02")], TODAY)).toEqual([
      { ...running, newEndsOn: "2026-10-05" },
    ]);
  });

  it("a block drawn from today ends the running program yesterday", () => {
    const running = program("Upper Lower", "2026-09-08", "2026-10-04");
    expect(planBlockTrims([running], [drawn(TODAY, "2026-10-12")], TODAY)).toEqual([
      { ...running, newEndsOn: "2026-09-14" },
    ]);
  });

  it("a queued plan that starts before the block ends the day before it", () => {
    const queued = program("Glute", "2026-09-28", "2026-10-25");
    expect(planBlockTrims([queued], [drawn("2026-10-06", "2026-11-02")], TODAY)).toEqual([
      { ...queued, newEndsOn: "2026-10-05" },
    ]);
  });

  it("leaves a plan inside the block, one ending on its last day, and one in a gap on either side", () => {
    const plans = [
      program("Inside", "2026-10-06", "2026-10-19"),
      program("To the end", "2026-10-20", "2026-11-02"),
      program("Before", "2026-09-01", "2026-10-05"),
      program("After", "2026-11-03", "2026-11-30"),
    ];
    expect(planBlockTrims(plans, [drawn("2026-10-06", "2026-11-02")], TODAY)).toEqual([]);
  });

  it("a shortened block already under way keeps its lived start: a plan crossing it is judged at the end alone", () => {
    const crossing = program("Upper Lower", "2026-08-25", "2026-10-25");
    expect(
      planBlockTrims([crossing], [shortened("2026-09-01", "2026-10-04", "2026-10-25")], TODAY)
    ).toEqual([{ ...crossing, newEndsOn: "2026-10-04" }]);
  });

  it("a plan two targets reach takes the earlier cut, and a removal wins", () => {
    const long = program("Long", "2026-10-06", "2026-12-27");
    expect(
      planBlockTrims(
        [long],
        [drawn("2026-11-10", "2026-11-30"), drawn("2026-10-06", "2026-10-26")],
        TODAY
      )
    ).toEqual([{ ...long, newEndsOn: "2026-10-26" }]);

    const queued = program("Queued", "2026-10-20", "2026-11-02");
    expect(
      planBlockTrims(
        [queued],
        [shortened("2026-10-06", "2026-10-15", "2026-11-02"), drawn("2026-11-01", "2026-11-20")],
        TODAY
      )
    ).toEqual([{ ...queued, newEndsOn: null }]);
  });

  it("asks nothing the second time: the trimmed plans already fit", () => {
    const target = drawn("2026-10-06", "2026-11-02");
    const plans = [
      program("Running", "2026-09-08", "2026-11-29"),
      program("Queued", "2026-10-20", "2026-12-20"),
    ];
    const trimmed = planBlockTrims(plans, [target], TODAY).map(
      ({ newEndsOn, ...plan }) => ({ ...plan, endsOn: newEndsOn as string })
    );
    expect(planBlockTrims(trimmed, [target], TODAY)).toEqual([]);
  });
});
