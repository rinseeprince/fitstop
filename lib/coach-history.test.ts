import { describe, it, expect, beforeEach } from "vitest";
import {
  hasCoachHistory,
  resetCoachHistoryForTests,
  trackCoachHistory,
} from "./coach-history";

// jsdom keeps a real session history: pushState adds an entry, back() and
// forward() traverse it and fire popstate, and each entry keeps the state it
// was given — so the count is driven the way a browser drives it, through the
// history itself, not through a mock of it. A traversal is queued as two
// nested tasks (jsdom's SessionHistory.traverseByDelta), so settling waits two.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  await tick();
  await tick();
};

beforeEach(() => {
  resetCoachHistoryForTests();
});

describe("the coach history count", () => {
  it("counts a push and keeps the count on a replace", () => {
    trackCoachHistory();
    expect(hasCoachHistory()).toBe(false);

    window.history.pushState({}, "", "/clients");
    expect(hasCoachHistory()).toBe(true);
    expect(window.history.state.coachDepth).toBe(1);

    // A refinement: the router rewrites the entry's state without the stamp.
    window.history.replaceState({ __NA: true }, "", "/clients?view=overdue");
    expect(window.history.state.coachDepth).toBe(1);
    expect(hasCoachHistory()).toBe(true);
  });

  it("reads the entry it lands on after Back and Forward", async () => {
    trackCoachHistory();
    window.history.pushState({}, "", "/clients");
    window.history.pushState({}, "", "/clients/c-1?tab=overview");
    expect(window.history.state.coachDepth).toBe(2);

    window.history.back();
    await settle();
    expect(window.history.state.coachDepth).toBe(1);
    expect(hasCoachHistory()).toBe(true);

    window.history.back();
    await settle();
    expect(hasCoachHistory()).toBe(false);

    window.history.forward();
    await settle();
    expect(hasCoachHistory()).toBe(true);
  });

  it("a replace carrying the entry's own stamp is taken as the count", () => {
    // Back/Forward through Next: it spreads the restored entry's state, stamp
    // included, into its own replace.
    trackCoachHistory();
    window.history.replaceState({ __NA: true, coachDepth: 3 }, "", "/clients");
    expect(hasCoachHistory()).toBe(true);
    expect(window.history.state.coachDepth).toBe(3);
  });

  it("keeps every key a navigation carried in its state", () => {
    trackCoachHistory();
    window.history.pushState({ __NA: true, tree: [1] }, "", "/clients");
    expect(window.history.state).toEqual({ __NA: true, tree: [1], coachDepth: 1 });
  });

  it("starts again from the entry's own stamp — a reload keeps its place", () => {
    const stop = trackCoachHistory();
    window.history.pushState({}, "", "/clients");
    stop();

    trackCoachHistory();
    expect(hasCoachHistory()).toBe(true);
  });

  it("a push while no coach page is mounted starts a fresh count", () => {
    const stop = trackCoachHistory();
    window.history.pushState({}, "", "/clients");
    stop();

    // Sign out, then the login page pushes the first coach screen.
    window.history.pushState({}, "", "/login");
    window.history.pushState({}, "", "/dashboard");
    trackCoachHistory();
    expect(hasCoachHistory()).toBe(false);
    expect(window.history.state.coachDepth).toBe(0);
  });
});
