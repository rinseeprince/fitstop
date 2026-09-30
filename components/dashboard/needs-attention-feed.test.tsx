import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AttentionAlert } from "@/types/attention-feed";

const { feed } = vi.hoisted(() => ({
  feed: { data: undefined as unknown, error: undefined as unknown, isLoading: false, mutate: vi.fn() },
}));
vi.mock("@/hooks/use-attention-feed", () => ({ useAttentionFeed: () => feed }));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    motion: {
      div: ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => {
        const { initial: _i, animate: _a, transition: _t, ...props } = rest;
        return React.createElement("div", props, children);
      },
    },
  };
});

import { NeedsAttentionFeed } from "./needs-attention-feed";

const missed = (habitId: string, name: string, days: number): AttentionAlert => ({
  type: "habit_missed",
  severity: "medium",
  message: `Missed ${name} ${days} days`,
  affectedDays: ["2026-09-24", "2026-09-26", "2026-09-28"],
  metricData: [],
  habitId,
});

beforeEach(() => {
  feed.mutate.mockReset();
  feed.data = {
    clients: [{ clientId: "c1", clientName: "Sam", clientAvatar: null, alerts: [missed("h-water", "Water", 4), missed("h-walk", "Walk", 3)] }],
    totalClientCount: 2,
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NeedsAttentionFeed — missed habits (D4)", () => {
  it("lists each missed habit as its own line under the client's row, and dismisses one by its habit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) } as Response);
    const user = userEvent.setup();
    render(<NeedsAttentionFeed />);

    // The row names the first line and counts the rest, until the coach expands it.
    expect(screen.getByText("Missed Water 4 days +1")).toBeInTheDocument();
    await user.click(screen.getByText("Sam"));
    expect(screen.getByText("Missed Walk 3 days")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss: Missed Walk 3 days" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/dashboard/attention-feed/dismiss");
    expect(JSON.parse(init?.body as string)).toEqual({ clientId: "c1", alertType: "habit_missed:h-walk" });
    await waitFor(() => expect(feed.mutate).toHaveBeenCalled());
  });
});
