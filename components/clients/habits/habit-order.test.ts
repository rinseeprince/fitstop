import { describe, it, expect } from "vitest";
import { orderAfterMove } from "./habit-order";

const ALL = ["water", "walk", "sleep", "sauna", "stretch"];

describe("orderAfterMove — a move among the running and starting-later habits, sent as the whole list", () => {
  it("swaps a habit with its neighbour when every habit can move", () => {
    expect(orderAfterMove(ALL, ALL, "sleep", "up")).toEqual(["water", "sleep", "walk", "sauna", "stretch"]);
    expect(orderAfterMove(ALL, ALL, "sleep", "down")).toEqual(["water", "walk", "sauna", "sleep", "stretch"]);
  });

  it("names every one of the client's habits when some are stopped, each stopped one keeping its place", () => {
    // Water and walk are stopped; sleep, sauna and stretch can move.
    const movable = ["sleep", "sauna", "stretch"];
    expect(orderAfterMove(ALL, movable, "stretch", "up")).toEqual(["water", "walk", "sleep", "stretch", "sauna"]);
    // Moving across a stopped habit: the two that move swap slots, the stopped one stays between them.
    expect(orderAfterMove(ALL, ["water", "sleep"], "sleep", "up")).toEqual(["sleep", "walk", "water", "sauna", "stretch"]);
  });

  it("moves nothing past either end of the habits that can move, or for a habit that cannot", () => {
    expect(orderAfterMove(ALL, ALL, "water", "up")).toBeNull();
    expect(orderAfterMove(ALL, ALL, "stretch", "down")).toBeNull();
    expect(orderAfterMove(ALL, ["sleep", "sauna"], "sauna", "down")).toBeNull();
    expect(orderAfterMove(ALL, ["sleep", "sauna"], "water", "up")).toBeNull();
  });
});
