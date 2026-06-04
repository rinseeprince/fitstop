import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TimeScopeSelector } from "./time-scope-selector";
import type { RoadmapWithPhases, TimeScope } from "@/lib/metrics/resolve-time-scope";
import type { Phase } from "@/types/roadmap";

// Radix Select needs these jsdom shims to open its listbox.
Element.prototype.scrollIntoView = vi.fn();
const elProto = Element.prototype as unknown as Record<string, unknown>;
if (!elProto.hasPointerCapture) elProto.hasPointerCapture = () => false;
if (!elProto.releasePointerCapture) elProto.releasePointerCapture = () => {};

function makePhase(overrides: Partial<Phase> = {}): Phase {
  return {
    id: "p1",
    roadmapId: "rm-1",
    clientId: "client-1",
    name: "Cut",
    orderIndex: 0,
    status: "completed",
    milestones: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRoadmap(overrides: Partial<RoadmapWithPhases> = {}): RoadmapWithPhases {
  return {
    id: "rm-1",
    clientId: "client-1",
    coachId: "coach-1",
    name: "2026 Recomp",
    status: "active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    phases: [],
    ...overrides,
  };
}

const ALL: TimeScope = { kind: "all" };

describe("TimeScopeSelector", () => {
  beforeEach(() => cleanup());

  it("always offers All time + relative presets", async () => {
    const user = userEvent.setup();
    render(<TimeScopeSelector scope={ALL} onChange={vi.fn()} roadmaps={[]} />);

    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByRole("option", { name: "All time" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Last 7 days" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Last 30 days" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Last 90 days" })).toBeInTheDocument();
  });

  it("hides Program/Phase tiers when the client has no roadmap", async () => {
    const user = userEvent.setup();
    render(<TimeScopeSelector scope={ALL} onChange={vi.fn()} roadmaps={[]} />);

    await user.click(screen.getByRole("combobox"));
    await screen.findByRole("option", { name: "All time" });

    expect(screen.queryByText("2026 Recomp")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Whole program" })).not.toBeInTheDocument();
  });

  it("renders a Program group with phase children for a multi-phase roadmap", async () => {
    const user = userEvent.setup();
    const roadmaps = [
      makeRoadmap({
        phases: [
          makePhase({ id: "p1", name: "Cut", orderIndex: 0 }),
          makePhase({ id: "p2", name: "Bulk", orderIndex: 1, status: "active" }),
        ],
      }),
    ];
    render(<TimeScopeSelector scope={ALL} onChange={vi.fn()} roadmaps={roadmaps} />);

    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByText("2026 Recomp")).toBeInTheDocument(); // group label
    expect(screen.getByRole("option", { name: "Whole program" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cut" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bulk" })).toBeInTheDocument();
  });

  it("collapses a single-phase program to one row (no parent+child)", async () => {
    const user = userEvent.setup();
    const roadmaps = [makeRoadmap({ phases: [makePhase({ id: "p1", name: "Cut" })] })];
    render(<TimeScopeSelector scope={ALL} onChange={vi.fn()} roadmaps={roadmaps} />);

    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByRole("option", { name: "2026 Recomp" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Whole program" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Cut" })).not.toBeInTheDocument();
  });

  it("calls onChange with the decoded scope on selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const roadmaps = [
      makeRoadmap({
        phases: [
          makePhase({ id: "p1", name: "Cut", orderIndex: 0 }),
          makePhase({ id: "p2", name: "Bulk", orderIndex: 1 }),
        ],
      }),
    ];
    render(<TimeScopeSelector scope={ALL} onChange={onChange} roadmaps={roadmaps} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Bulk" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "phase", phaseId: "p2" });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Last 7 days" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "relative", days: 7 });
  });
});
