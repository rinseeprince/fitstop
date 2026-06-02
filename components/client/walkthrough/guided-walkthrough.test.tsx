import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

import { WalkthroughStep } from "./walkthrough-step";
import type { WalkthroughStepConfig } from "./walkthrough-steps";
// vi.mock below is hoisted above this import, so the shell reads the mutable
// WALKTHROUGH_STEPS getter rather than the static array.
import { GuidedWalkthrough } from "./guided-walkthrough";

// The GuidedWalkthrough shell finishes only on its last step. Embla does not
// advance scroll snaps in jsdom, so rather than build a carousel-navigation
// harness we make the steps array overridable: setting it to [] leaves the
// inline welcome as the single (and therefore last) step, so one button click
// runs handleFinish. `override === null` falls back to the real copy list,
// which the copy-module tests assert against via `realSteps`.
const { steps } = vi.hoisted(() => ({
  steps: {
    real: [] as readonly WalkthroughStepConfig[],
    override: null as readonly WalkthroughStepConfig[] | null,
  },
}));

vi.mock("./walkthrough-steps", async (importActual) => {
  const actual = await importActual<typeof import("./walkthrough-steps")>();
  steps.real = actual.WALKTHROUGH_STEPS;
  return {
    ...actual,
    get WALKTHROUGH_STEPS() {
      return steps.override ?? steps.real;
    },
  };
});

const realSteps = () => steps.real;

// Embla + Radix primitives need these browser APIs that jsdom omits.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver =
  IntersectionObserverMock as unknown as typeof IntersectionObserver;

globalThis.matchMedia =
  globalThis.matchMedia ||
  ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList);

/** Render a single static step's body via the real presentational wrapper. */
function renderStep(key: string) {
  const step = realSteps().find((s) => s.key === key);
  if (!step) throw new Error(`No walkthrough step with key "${key}"`);
  render(
    <WalkthroughStep icon={step.icon} title={step.title}>
      {step.body}
    </WalkthroughStep>,
  );
  return step;
}

describe("WALKTHROUGH_STEPS copy module", () => {
  beforeEach(() => {
    cleanup();
  });

  it("holds the six day-centric steps (2–7) in order, no welcome", () => {
    expect(realSteps().map((s) => s.key)).toEqual([
      "nav",
      "home",
      "log",
      "swipe",
      "program",
      "get-started",
    ]);
  });

  it("nav step names all four tabs and points to Settings behind the photo", () => {
    renderStep("nav");
    for (const tab of ["Home", "Metrics", "Program", "Content"]) {
      expect(screen.getByText(tab)).toBeInTheDocument();
    }
    expect(
      screen.getByText(/Settings lives behind your photo in the top-right/i),
    ).toBeInTheDocument();
  });

  it("home step describes the day-at-a-glance cards", () => {
    const step = renderStep("home");
    expect(step.title).toBe("Your day at a glance");
    expect(
      screen.getByText(/training, nutrition, wellness and habits as\s+cards/i),
    ).toBeInTheDocument();
  });

  it("log step carries the exact alt-session callout sentence", () => {
    renderStep("log");
    expect(
      screen.getByText(
        /On a rest day you can tap the training card to log a workout anyway, and on a planned day you can pick .Do a different session. if you switched things up\./i,
      ),
    ).toBeInTheDocument();
  });

  it("swipe step explains day navigation via swipe/arrows", () => {
    const step = renderStep("swipe");
    expect(step.title).toBe("Move between days");
    expect(
      screen.getByText(/Swipe left or right, or use the arrows/i),
    ).toBeInTheDocument();
  });

  it("program step points to the phase banner and Program tab", () => {
    const step = renderStep("program");
    expect(step.title).toBe("See your roadmap");
    expect(
      screen.getByText(/banner at the top of home shows your current phase/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Program tab/i)).toBeInTheDocument();
  });

  it("get-started step is an encouraging closing line", () => {
    const step = renderStep("get-started");
    expect(step.title).toBe("You're all set");
    expect(
      screen.getByText(/log your first day, and your coach will/i),
    ).toBeInTheDocument();
  });
});

describe("GuidedWalkthrough smoke", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // Default to the real (full) step list; smoke finish tests override to [].
    steps.override = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    steps.override = null;
  });

  it("renders the inline welcome with coach name and message", () => {
    render(
      <GuidedWalkthrough
        coachName="Coach Sam"
        welcomeMessage="Glad you're here"
        onComplete={() => {}}
      />,
    );
    expect(screen.getByText("Welcome!")).toBeInTheDocument();
    expect(
      screen.getByText(/Coach Sam has set everything up for you/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Glad you're here/i)).toBeInTheDocument();
  });

  it("falls back to the generic welcome when no coach data is supplied", () => {
    render(<GuidedWalkthrough onComplete={() => {}} />);
    expect(
      screen.getByText(/Your coach has set everything up/i),
    ).toBeInTheDocument();
  });

  it("POSTs to /api/client/walkthrough-seen and calls onComplete on finish", async () => {
    // Collapse to the single inline welcome step so it is the last step;
    // this avoids needing Embla to advance snaps in jsdom.
    steps.override = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const onComplete = vi.fn();

    render(<GuidedWalkthrough onComplete={onComplete} />);
    screen.getByRole("button", { name: /get started/i }).click();

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/client/walkthrough-seen", {
        method: "POST",
      });
    });
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it("still calls onComplete when the walkthrough-seen POST rejects (non-blocking)", async () => {
    steps.override = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network down"));
    const onComplete = vi.fn();

    render(<GuidedWalkthrough onComplete={onComplete} />);
    screen.getByRole("button", { name: /get started/i }).click();

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/client/walkthrough-seen", {
        method: "POST",
      });
    });
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
