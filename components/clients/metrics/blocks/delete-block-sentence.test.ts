import { describe, expect, it } from "vitest";
import { computeDeleteShift } from "@/lib/blocks/block-chain";
import { buildDeleteSentence } from "./delete-block-sentence";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";

const TODAY = "2026-08-11";

const view = (
  id: string,
  name: string,
  startsOn: string,
  endsOn: string,
  weeks: number,
  state: ClientBlockView["state"]
): ClientBlockView => ({
  id,
  name,
  focus: null,
  targetWeightKg: null,
  startsOn,
  endsOn,
  weeks,
  state,
  weekOfTotal: null,
});

// Contiguous chain around TODAY. The outcomes come from the REAL
// computeDeleteShift — the same helper the DELETE route executes — so these
// pin the sentence against the shift that will actually run.
const A = view("a", "Base", "2026-06-01", "2026-06-28", 4, "past");
const B = view("b", "Cut 1", "2026-06-29", "2026-08-23", 8, "current");
const C = view("c", "Cut 2", "2026-08-24", "2026-09-20", 4, "future");
const D = view("d", "Peak", "2026-09-21", "2026-10-18", 4, "future");
const E = view("e", "Deload", "2026-10-19", "2026-11-01", 2, "future");

function outcomeFor(chain: ClientBlockView[], id: string) {
  const outcome = computeDeleteShift(chain, id, TODAY);
  if (!outcome || outcome.kind === "elapsed") {
    throw new Error("fixture should be deletable");
  }
  return outcome;
}

describe("buildDeleteSentence", () => {
  it("future block with one shifted successor — the doc's example shape", () => {
    const chain = [A, B, C, D];
    expect(buildDeleteSentence(chain, "c", outcomeFor(chain, "c"))).toBe(
      "The journey shortens to 16 weeks and ends 20 Sep. Peak moves to 24 Aug."
    );
  });

  it("deleting the last block: no moves clause", () => {
    const chain = [A, B, C, D];
    expect(buildDeleteSentence(chain, "d", outcomeFor(chain, "d"))).toBe(
      "The journey shortens to 16 weeks and ends 20 Sep."
    );
  });

  it("two shifted blocks are both named", () => {
    const chain = [B, C, D, E];
    expect(buildDeleteSentence(chain, "c", outcomeFor(chain, "c"))).toBe(
      "The journey shortens to 14 weeks and ends 4 Oct. Peak moves to 24 Aug and Deload to 21 Sep."
    );
  });

  it("three or more shifted blocks collapse to a count", () => {
    const F = view("f", "Taper", "2026-11-02", "2026-11-15", 2, "future");
    const chain = [B, C, D, E, F];
    expect(buildDeleteSentence(chain, "c", outcomeFor(chain, "c"))).toBe(
      "The journey shortens to 16 weeks and ends 18 Oct. 3 later blocks move earlier."
    );
  });

  it("current block mid-flight: the successor starts today", () => {
    const chain = [A, B, C];
    expect(buildDeleteSentence(chain, "b", outcomeFor(chain, "b"))).toBe(
      "Cut 2 starts today."
    );
  });

  it("current block with no successor: the journey ends yesterday", () => {
    const chain = [A, B];
    expect(buildDeleteSentence(chain, "b", outcomeFor(chain, "b"))).toBe(
      "The journey now ends yesterday."
    );
  });

  it("removing the journey's only block says exactly that", () => {
    const chain = [C];
    expect(buildDeleteSentence(chain, "c", outcomeFor(chain, "c"))).toBe(
      "Removes the journey's only block."
    );
  });
});
