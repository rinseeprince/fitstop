import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import { HabitsSection } from "./habits-section";
import { clientHabitProgressKey, useClientHabitProgress } from "@/hooks/use-client-portal-habits";
import type { ClientHabitProgress } from "@/types/habits";

// The Journey's habits pane arriving (CONVENTIONS §7 → "No frame disagrees",
// rule 4; docs/newdesignsystem.md → "Loading & async states"), over the real
// read and a real SWR cache. Until the read settles every commit holds the
// cards' places and says nothing about the habits — never "No habits yet",
// never a blank pane — and the cards land in one commit.

const PROGRESS: ClientHabitProgress = {
  clientToday: "2026-09-30",
  habits: [
    {
      habit: { id: "h1", name: "Mobility", howTo: null, measure: "tick", unit: null, direction: null },
      words: { schedule: "Mon, Wed, Fri", target: null },
      weeks: [
        { start: "2026-09-17", end: "2026-09-23", planned: 3, done: 3, met: 3 },
        { start: "2026-09-24", end: "2026-09-30", planned: 3, done: 2, met: 2 },
      ],
      span: { planned: 6, done: 5, met: 5 },
      days: [],
    },
  ],
};

function Pane() {
  const { progress, error, retry } = useClientHabitProgress(2);
  return <HabitsSection progress={progress} error={error} onRetry={retry} />;
}

type Frame = { placeholders: boolean; saysNone: boolean; cards: number; failed: boolean };
let frames: Frame[] = [];
const snapshot = (): Frame => ({
  placeholders: document.querySelector('[aria-busy="true"] [data-slot="skeleton"]') !== null,
  saysNone: screen.queryByText("No habits yet") !== null,
  cards: document.querySelectorAll('section[aria-label]').length,
  failed: screen.queryByText(/couldn.t load your habits/i) !== null,
});

let answer: (response: Response) => void = () => {};

beforeEach(() => {
  frames = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      expect(url).toBe(clientHabitProgressKey(2));
      return new Promise<Response>((resolve) => (answer = resolve));
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPane() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0 }}>
      <Profiler id="journey-habits" onRender={() => frames.push(snapshot())}>
        <Pane />
      </Profiler>
    </SWRConfig>
  );
}

describe("the Journey's habits pane arriving", () => {
  it("holds the cards' places until the read settles, then shows the cards in one commit", async () => {
    renderPane();
    // The read goes once no habit entry is on its way.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame).toEqual({ placeholders: true, saysNone: false, cards: 0, failed: false });

    frames = [];
    await act(async () => {
      answer(new Response(JSON.stringify({ success: true, data: PROGRESS }), { status: 200 }));
      await Promise.resolve();
    });
    await screen.findByRole("region", { name: "Mobility" });
    // No commit between shows anything but the placeholders or the cards.
    for (const frame of frames) {
      expect(frame.saysNone).toBe(false);
      expect(frame.placeholders || frame.cards === 1).toBe(true);
    }
    expect(frames.at(-1)).toEqual({ placeholders: false, saysNone: false, cards: 1, failed: false });
  });

  it("says the read failed, never that there are no habits", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPane();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    frames = [];
    await act(async () => {
      answer(new Response(JSON.stringify({ success: false }), { status: 500 }));
      await Promise.resolve();
    });
    await screen.findByText(/couldn.t load your habits/i);
    expect(frames.some((frame) => frame.saysNone)).toBe(false);
  });
});
