import { describe, it, expect } from "vitest";
import { orderAfterMove } from "./habit-order";

const ALL = ["water", "walk", "sleep", "sauna", "stretch"];

describe("orderAfterMove — a move among the habits on screen, sent as the whole list", () => {
  it("swaps a habit with its neighbour when every habit is shown", () => {
    expect(orderAfterMove(ALL, ALL, "sleep", "up")).toEqual(["water", "sleep", "walk", "sauna", "stretch"]);
    expect(orderAfterMove(ALL, ALL, "sleep", "down")).toEqual(["water", "walk", "sauna", "sleep", "stretch"]);
  });

  it("names every one of the client's habits when a search shows some, the hidden ones keeping their places", () => {
    // A search for "s" shows sleep, sauna and stretch; water and walk are hidden.
    const shown = ["sleep", "sauna", "stretch"];
    expect(orderAfterMove(ALL, shown, "stretch", "up")).toEqual(["water", "walk", "sleep", "stretch", "sauna"]);
    // Moving across a hidden habit: the two shown swap slots, the hidden one stays between them.
    expect(orderAfterMove(ALL, ["water", "sleep"], "sleep", "up")).toEqual(["sleep", "walk", "water", "sauna", "stretch"]);
  });

  it("moves nothing past either end of the habits on screen, or for a habit not on screen", () => {
    expect(orderAfterMove(ALL, ALL, "water", "up")).toBeNull();
    expect(orderAfterMove(ALL, ALL, "stretch", "down")).toBeNull();
    expect(orderAfterMove(ALL, ["sleep", "sauna"], "sauna", "down")).toBeNull();
    expect(orderAfterMove(ALL, ["sleep", "sauna"], "water", "up")).toBeNull();
  });
});
