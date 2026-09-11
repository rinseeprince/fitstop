import { describe, expect, it } from "vitest";
import { selectHeadlineFact } from "./block-headline";
import type { BlockPlanState } from "@/types/client-blocks";

const fact = (id: string, state: BlockPlanState) => ({ id, state });

describe("selectHeadlineFact", () => {
  it("the plan in force wins over one queued later in the block", () => {
    expect(selectHeadlineFact([fact("running", "active"), fact("later", "upcoming")])?.id).toBe(
      "running"
    );
  });

  it("the plan in force wins over one that ended before it", () => {
    expect(selectHeadlineFact([fact("earlier", "ended"), fact("running", "active")])?.id).toBe(
      "running"
    );
  });

  it("with nothing in force, the FIRST queued plan — a running block whose only plan starts tomorrow is set", () => {
    expect(
      selectHeadlineFact([fact("tomorrow", "upcoming"), fact("next-month", "upcoming")])?.id
    ).toBe("tomorrow");
  });

  it("with nothing in force and nothing queued, the LAST plan that ran — an early-ended program still headlines its block", () => {
    expect(selectHeadlineFact([fact("first", "ended"), fact("second", "ended")])?.id).toBe(
      "second"
    );
  });

  it("a queued plan outranks an ended one whatever the order", () => {
    expect(selectHeadlineFact([fact("ran", "ended"), fact("queued", "upcoming")])?.id).toBe(
      "queued"
    );
  });

  it("an empty list has no headline", () => {
    expect(selectHeadlineFact([])).toBeNull();
  });
});
