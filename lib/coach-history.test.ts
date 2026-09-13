import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hasCoachHistory,
  hasEntryBeforePage,
  leaveCoachPage,
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
const here = () => window.location.pathname + window.location.search;

beforeEach(() => {
  resetCoachHistoryForTests();
  // Every case starts from the root: a pathname left by the previous case
  // would make its first push a same-page push.
  window.history.replaceState({}, "", "/");
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
    window.history.pushState({}, "", "/clients");
    // Landed here by a traverse: the replace carries the entry's own address.
    window.history.replaceState({ __NA: true, coachDepth: 3, coachPage: 2 }, "", "/clients");
    expect(hasCoachHistory()).toBe(true);
    expect(window.history.state).toMatchObject({ coachDepth: 3, coachPage: 2 });
  });

  it("keeps every key a navigation carried in its state", () => {
    trackCoachHistory();
    window.history.pushState({ __NA: true, tree: [1] }, "", "/clients");
    expect(window.history.state).toEqual({ __NA: true, tree: [1], coachDepth: 1, coachPage: 1 });
  });

  it("starts again from the entry's own stamp — a reload keeps its place", () => {
    const stop = trackCoachHistory();
    window.history.pushState({}, "", "/clients");
    window.history.pushState({}, "", "/clients/c-1?tab=overview");
    window.history.pushState({}, "", "/clients/c-1?tab=metrics");
    stop();

    trackCoachHistory();
    expect(hasCoachHistory()).toBe(true);
    expect(window.history.state).toMatchObject({ coachDepth: 3, coachPage: 2 });
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
    expect(window.history.state).toMatchObject({ coachDepth: 0, coachPage: 0 });
  });
});

describe("the page a run of entries belongs to", () => {
  it("a push to another pathname begins a page; one on the same pathname belongs to it", () => {
    trackCoachHistory();
    window.history.pushState({}, "", "/clients");
    expect(window.history.state).toMatchObject({ coachDepth: 1, coachPage: 1 });
    window.history.pushState({}, "", "/clients?view=overdue");
    expect(window.history.state).toMatchObject({ coachDepth: 2, coachPage: 1 });
    window.history.pushState({}, "", "/clients/c-1?tab=overview");
    expect(window.history.state).toMatchObject({ coachDepth: 3, coachPage: 3 });
    window.history.pushState({}, "", "/clients/c-1?tab=metrics&journey=blocks");
    expect(window.history.state).toMatchObject({ coachDepth: 4, coachPage: 3 });
  });

  it("leaving the page goes back over every entry of it to the one before it began", async () => {
    trackCoachHistory();
    window.history.pushState({}, "", "/clients?view=overdue");
    window.history.pushState({}, "", "/clients/c-1?tab=overview");
    window.history.pushState({}, "", "/clients/c-1?tab=metrics");
    window.history.pushState({}, "", "/clients/c-1?tab=metrics&journey=blocks");
    expect(hasEntryBeforePage()).toBe(true);

    const fallback = vi.fn();
    leaveCoachPage(fallback);
    await settle();

    expect(fallback).not.toHaveBeenCalled();
    expect(here()).toBe("/clients?view=overdue");
    expect(window.history.state).toMatchObject({ coachDepth: 1, coachPage: 1 });
    expect(hasEntryBeforePage()).toBe(true);
  });

  it("falls back to the parent when the page began the count — a pasted address", () => {
    trackCoachHistory();
    // Tabs and panes inside the page do not change that.
    window.history.pushState({}, "", `${window.location.pathname}?tab=metrics`);
    window.history.pushState({}, "", `${window.location.pathname}?tab=metrics&journey=blocks`);
    expect(hasCoachHistory()).toBe(true);
    expect(hasEntryBeforePage()).toBe(false);

    const fallback = vi.fn();
    leaveCoachPage(fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("a replace that changes the pathname begins a page", async () => {
    trackCoachHistory();
    window.history.pushState({}, "", "/clients");
    window.history.pushState({}, "", "/clients?view=overdue");
    window.history.replaceState({ __NA: true }, "", "/dashboard");
    expect(window.history.state).toMatchObject({ coachDepth: 2, coachPage: 2 });

    leaveCoachPage();
    await settle();
    expect(here()).toBe("/clients");
  });

  it("a reload keeps the page start with the count", () => {
    const stop = trackCoachHistory();
    window.history.pushState({}, "", "/clients");
    window.history.pushState({}, "", "/clients/c-1?tab=overview");
    window.history.pushState({}, "", "/clients/c-1?tab=metrics");
    stop();

    trackCoachHistory();
    expect(hasEntryBeforePage()).toBe(true);
    expect(window.history.state).toMatchObject({ coachDepth: 3, coachPage: 2 });
  });
});
