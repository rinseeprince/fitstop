import { describe, expect, it } from "vitest";

import {
  findLabelViolations,
  isWhitelisted,
  SEGMENTED_CONTROL_MODULE,
  TOKEN_MODULES,
} from "./check-labels";

const WL = ["components/client-portal/", "app/layout.tsx"] as const;

describe("findLabelViolations", () => {
  it("flags a raw font-mono-display literal with its line number", () => {
    const content = `const a = 1\nconst cls = "font-mono-display text-[11px]"\n`;
    const hits = findLabelViolations("components/foo.tsx", content, WL);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ line: 2, clause: "1 (raw mono literal)" });
  });

  it("flags a hand-rolled uppercase + tracking label string", () => {
    const content = `<span className="text-[10px] uppercase tracking-[0.06em]" />`;
    const hits = findLabelViolations("components/foo.tsx", content, WL);
    expect(hits).toHaveLength(1);
    expect(hits[0].clause).toBe("2 (hand-rolled uppercase label)");
  });

  it("does not flag uppercase composed with the tracking-normal reset", () => {
    const content = `cn(MONO_LABEL_CLASS, "normal-case tracking-normal uppercase")`;
    expect(findLabelViolations("components/foo.tsx", content, WL)).toEqual([]);
  });

  it("does not flag the CSS-variable form var(--font-mono-display)", () => {
    const content = `const TICK_STYLE = { fontFamily: "var(--font-mono-display), ui-monospace, monospace" }`;
    expect(findLabelViolations("components/foo.tsx", content, WL)).toEqual([]);
  });

  it("does not flag uppercase without a tracking value (badges)", () => {
    const content = `<span className="text-[9px] font-semibold uppercase" />`;
    expect(findLabelViolations("components/foo.tsx", content, WL)).toEqual([]);
  });

  it("reports both clauses when one line trips both", () => {
    const content = `"font-mono-display text-[10px] uppercase tracking-[0.08em]"`;
    const hits = findLabelViolations("components/foo.tsx", content, WL);
    expect(hits.map((h) => h.clause)).toEqual([
      "1 (raw mono literal)",
      "2 (hand-rolled uppercase label)",
    ]);
  });

  it("skips token modules entirely", () => {
    const content = `export const MONO = "font-mono-display"`;
    for (const mod of TOKEN_MODULES) {
      expect(findLabelViolations(mod, content, WL)).toEqual([]);
    }
  });

  it("skips whitelisted prefixes and exact files", () => {
    const content = `"font-mono-display uppercase tracking-wide"`;
    expect(
      findLabelViolations("components/client-portal/day/card.tsx", content, WL),
    ).toEqual([]);
    expect(findLabelViolations("app/layout.tsx", content, WL)).toEqual([]);
  });
});

// Clause 3 — the segmented control. Five hand-rolled copies existed at five
// sizes before this clause; the tint alone appears ~60 times legitimately, so
// the test that matters most is the one proving it does NOT fire on those.
describe("findLabelViolations — segmented control", () => {
  it("flags a hand-rolled track (tint + the 2px inset, same line)", () => {
    const content = `<div className="bg-[rgba(13,148,136,0.05)] rounded-[6px] p-[2px] inline-flex">`;
    const hits = findLabelViolations("components/foo.tsx", content, WL);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      line: 1,
      clause: "3 (hand-rolled segmented control)",
    });
  });

  it("flags the Radix-TabsList spelling of the same track (p-0.5)", () => {
    const content = `<TabsList className="bg-[rgba(13,148,136,0.05)] p-0.5 rounded-[6px] inline-flex">`;
    expect(findLabelViolations("components/foo.tsx", content, WL)).toHaveLength(1);
  });

  it("does NOT flag the brand tint on its own — hover washes, chips, badges", () => {
    const content = [
      `<div className="rounded-[6px] bg-[rgba(13,148,136,0.05)] p-6" />`,
      `<span className="rounded-[4px] bg-[rgba(13,148,136,0.05)] px-2 py-0.5" />`,
      `"hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0d9488]"`,
    ].join("\n");
    expect(findLabelViolations("components/foo.tsx", content, WL)).toEqual([]);
  });

  it("does not flag a 2px inset that carries no brand tint", () => {
    const content = `<div className="rounded-[6px] bg-white p-[2px] inline-flex" />`;
    expect(findLabelViolations("components/foo.tsx", content, WL)).toEqual([]);
  });

  it("exempts the component itself", () => {
    const content = `<div className="rounded-[6px] bg-[rgba(13,148,136,0.05)] p-[2px]">`;
    expect(findLabelViolations(SEGMENTED_CONTROL_MODULE, content, WL)).toEqual([]);
  });
});

describe("isWhitelisted", () => {
  it("matches by prefix, not substring", () => {
    expect(isWhitelisted("components/client-portal/x.tsx", WL)).toBe(true);
    expect(isWhitelisted("components/clients/x.tsx", WL)).toBe(false);
  });
});
