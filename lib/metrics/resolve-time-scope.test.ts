import { describe, it, expect } from "vitest";
import { resolveTimeScope, type RoadmapWithPhases } from "./resolve-time-scope";
import type { Phase, Roadmap } from "@/types/roadmap";

const TODAY = "2026-06-04";

function makePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: "phase-1",
    roadmapId: "rm-1",
    clientId: "client-1",
    name: "Phase 1",
    orderIndex: 0,
    status: "completed",
    milestones: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRoadmap(overrides: Partial<RoadmapWithPhases> = {}): RoadmapWithPhases {
  const base: Roadmap = {
    id: "rm-1",
    clientId: "client-1",
    coachId: "coach-1",
    name: "Roadmap",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  return { ...base, phases: [], ...overrides };
}

describe("resolveTimeScope", () => {
  it("all-time → null bounds", () => {
    expect(resolveTimeScope({ kind: "all" }, [], TODAY)).toEqual({
      start: null,
      end: null,
    });
  });

  it("relative → [today - days, null]", () => {
    expect(resolveTimeScope({ kind: "relative", days: 30 }, [], TODAY)).toEqual({
      start: "2026-05-05",
      end: null,
    });
    expect(resolveTimeScope({ kind: "relative", days: 7 }, [], TODAY)).toEqual({
      start: "2026-05-28",
      end: null,
    });
  });

  it("phase window = [start, end] for a completed phase", () => {
    const roadmaps = [
      makeRoadmap({
        phases: [
          makePhase({ id: "p1", startDate: "2026-02-01", endDate: "2026-03-15" }),
        ],
      }),
    ];
    expect(resolveTimeScope({ kind: "phase", phaseId: "p1" }, roadmaps, TODAY)).toEqual({
      start: "2026-02-01",
      end: "2026-03-15",
    });
  });

  it("active phase (null end) → end falls back to today", () => {
    const roadmaps = [
      makeRoadmap({
        phases: [
          makePhase({ id: "p1", status: "active", startDate: "2026-05-01", endDate: undefined }),
        ],
      }),
    ];
    expect(resolveTimeScope({ kind: "phase", phaseId: "p1" }, roadmaps, TODAY)).toEqual({
      start: "2026-05-01",
      end: TODAY,
    });
  });

  it("program window = first-phase-start → last-phase-end (completed roadmap)", () => {
    const roadmaps = [
      makeRoadmap({
        id: "rm-1",
        status: "completed",
        phases: [
          makePhase({ id: "p1", startDate: "2026-01-10", endDate: "2026-02-20" }),
          makePhase({ id: "p2", startDate: "2026-02-21", endDate: "2026-04-05" }),
        ],
      }),
    ];
    expect(resolveTimeScope({ kind: "program", roadmapId: "rm-1" }, roadmaps, TODAY)).toEqual({
      start: "2026-01-10",
      end: "2026-04-05",
    });
  });

  it("program with an active (open-ended) phase → end = today", () => {
    const roadmaps = [
      makeRoadmap({
        id: "rm-1",
        phases: [
          makePhase({ id: "p1", status: "completed", startDate: "2026-03-01", endDate: "2026-04-15" }),
          makePhase({ id: "p2", status: "active", startDate: "2026-04-16", endDate: undefined }),
        ],
      }),
    ];
    expect(resolveTimeScope({ kind: "program", roadmapId: "rm-1" }, roadmaps, TODAY)).toEqual({
      start: "2026-03-01",
      end: TODAY,
    });
  });

  it("program with all phase dates null → falls back to roadmap span", () => {
    const roadmaps = [
      makeRoadmap({
        id: "rm-1",
        startedAt: "2026-01-01",
        targetEndDate: "2026-06-30",
        phases: [makePhase({ id: "p1", startDate: undefined, endDate: undefined })],
      }),
    ];
    expect(resolveTimeScope({ kind: "program", roadmapId: "rm-1" }, roadmaps, TODAY)).toEqual({
      start: "2026-01-01",
      end: "2026-06-30",
    });
  });

  it("unknown phase / program id → null bounds (no crash)", () => {
    expect(resolveTimeScope({ kind: "phase", phaseId: "missing" }, [], TODAY)).toEqual({
      start: null,
      end: null,
    });
    expect(resolveTimeScope({ kind: "program", roadmapId: "missing" }, [], TODAY)).toEqual({
      start: null,
      end: null,
    });
  });
});
