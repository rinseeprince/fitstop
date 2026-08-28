import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { WellnessSparkline } from "./wellness-sparkline";

const DOMAIN: [number, number] = [1, 10];

function series(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i % 9) + 1);
}

beforeEach(() => cleanup());

describe("WellnessSparkline", () => {
  it("draws every point at the window it was built for", () => {
    const { container } = render(
      <WellnessSparkline points={series(7)} domain={DOMAIN} tone="good" />
    );

    expect(container.querySelectorAll("circle")).toHaveLength(7);
  });

  // The Overview's window now reaches 60. At 60 points in a 120px viewBox the
  // 4-5px dots sit ~2px apart and render as a solid teal bar — the line shape,
  // the only thing a sparkline is for, disappears under its own markers.
  it("drops the interior dots on a long window, keeping only the last one", () => {
    const { container } = render(
      <WellnessSparkline points={series(60)} domain={DOMAIN} tone="attention" />
    );

    expect(container.querySelectorAll("circle")).toHaveLength(1);
    // The line itself is unchanged — all 60 points still shape it.
    const polyline = container.querySelector("polyline");
    expect(polyline?.getAttribute("points")?.split(" ")).toHaveLength(60);
  });

  it("keeps the last-point marker, because it is the one carrying tone", () => {
    const { container } = render(
      <WellnessSparkline points={series(60)} domain={DOMAIN} tone="attention" />
    );

    // #d97706 is the attention tone; a hollow interior dot would be white.
    expect(container.querySelector("circle")?.getAttribute("fill")).toBe("#d97706");
  });

  it("draws a dashed rule rather than nothing when the window has no entries", () => {
    const { container } = render(
      <WellnessSparkline points={[null, null, null]} domain={DOMAIN} tone="none" />
    );

    expect(container.querySelector("line")).not.toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });
});
