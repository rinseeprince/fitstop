import { describe, it, expect, vi } from "vitest";

vi.mock("@/services/client-goal-writes-service", () => {
  class GoalWriteError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly conflict: unknown = null
    ) {
      super(message);
    }
  }
  return { GoalWriteError };
});

import { GoalWriteError, type GoalRefusalCode } from "@/services/client-goal-writes-service";
import { goalWriteErrorResponse } from "./goal-write-response";

async function answer(error: unknown, attempt = {}) {
  const response = goalWriteErrorResponse(error, attempt);
  return { status: response.status, body: await response.json() };
}

describe("a goal write's refusal", () => {
  it("offers to move the next goal past the new deadline, or delete it", async () => {
    const { status, body } = await answer(
      new GoalWriteError("deadline_after_next", "{}", {
        goalId: "goal-peak",
        name: "Peak",
        startsOn: "2026-10-05",
      }),
      { deadline: "2026-10-11" }
    );
    expect(status).toBe(409);
    expect(body.code).toBe("deadline_after_next");
    expect(body.error).toBe(
      "The deadline runs into Peak, which starts 5 Oct. Move Peak to 12 Oct or delete it."
    );
    expect(body.fixes).toEqual([
      { kind: "move_goal", goalId: "goal-peak", name: "Peak", startsOn: "2026-10-12" },
      { kind: "delete_goal", goalId: "goal-peak", name: "Peak" },
    ]);
  });

  // The move keeps the next goal's own deadline, which may not fall before its
  // new start: the move is offered where that deadline allows it, the delete
  // always.
  it("offers the move where the next goal's own deadline allows it, to the day", async () => {
    const { body } = await answer(
      new GoalWriteError("deadline_after_next", "{}", {
        goalId: "goal-bulk",
        name: "Bulk",
        startsOn: "2026-11-09",
        deadline: "2026-11-24",
      }),
      { deadline: "2026-11-23" }
    );
    expect(body.error).toBe("The deadline runs into Bulk, which starts 9 Nov. Move Bulk to 24 Nov or delete it.");
    expect(body.fixes).toEqual([
      { kind: "move_goal", goalId: "goal-bulk", name: "Bulk", startsOn: "2026-11-24" },
      { kind: "delete_goal", goalId: "goal-bulk", name: "Bulk" },
    ]);
  });

  it("offers no move when the next goal's deadline falls before the day it would move to", async () => {
    const { status, body } = await answer(
      new GoalWriteError("deadline_after_next", "{}", {
        goalId: "goal-race",
        name: "Race",
        startsOn: "2026-10-19",
        deadline: "2026-10-31",
      }),
      { deadline: "2026-11-06" }
    );
    expect(status).toBe(409);
    expect(body.error).toBe(
      "The deadline runs into Race, which starts 19 Oct. Set a deadline before 19 Oct, or delete Race."
    );
    expect(body.fixes).toEqual([{ kind: "delete_goal", goalId: "goal-race", name: "Race" }]);
  });

  it("offers to end the previous goal's deadline the day before the new start", async () => {
    const { status, body } = await answer(
      new GoalWriteError("previous_deadline", "{}", {
        goalId: "goal-cut",
        name: "Cut",
        deadline: "2026-11-14",
      }),
      { startsOn: "2026-11-03" }
    );
    expect(status).toBe(409);
    expect(body.error).toBe("Cut's deadline is 14 Nov. End that deadline on 2 Nov, or start this goal after it.");
    expect(body.fixes).toEqual([
      { kind: "end_deadline", goalId: "goal-cut", name: "Cut", deadline: "2026-11-02" },
    ]);
  });

  it("maps every refusal to its status", async () => {
    const statuses: Array<[GoalRefusalCode, number]> = [
      ["invalid_args", 400],
      ["not_found", 404],
      ["starts_in_past", 409],
      ["day_taken", 409],
      ["deadline_before_start", 409],
      ["started", 409],
      ["ended", 409],
      ["exists", 409],
    ];
    for (const [code, status] of statuses) {
      expect((await answer(new GoalWriteError(code, "x"))).status).toBe(status);
    }
  });

  it("says a started goal changes only its deadline and name", async () => {
    const { body } = await answer(new GoalWriteError("started", "x"));
    expect(body.error).toMatch(/only its deadline and name can change/);
    expect(body.fixes).toEqual([]);
  });

  it("answers anything else with a plain 500", async () => {
    const { status, body } = await answer(new Error("connection reset"));
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Failed to save the goal" });
  });
});
