"use client";

import { WELLNESS_TONE_COLOR, type WellnessTone } from "@/utils/wellness-color-thresholds";

type WellnessSparklineProps = {
  /** Oldest → newest; null is a day with no entry. */
  points: (number | null)[];
  /** Scale bounds for the metric (mood 1–5, everything else 1–10). */
  domain: [number, number];
  /** Tone of the most recent value — carries the stress/soreness inversion. */
  tone: WellnessTone;
};

// Intrinsic geometry, drawn at 1:1 inside an h-7 box (viewBox height === 28), so
// the default preserveAspectRatio never squashes the dots into ellipses. No
// chart library: seven points do not justify one.
const WIDTH = 120;
const HEIGHT = 28;
const PAD_X = 4;
const PAD_Y = 5;
const LINE_COLOR = "#0d9488";
const EMPTY_LINE_COLOR = "rgba(13,148,136,0.20)";

export function WellnessSparkline({ points, domain, tone }: WellnessSparklineProps) {
  const [min, max] = domain;
  const span = Math.max(1, max - min);
  const step = points.length > 1 ? (WIDTH - PAD_X * 2) / (points.length - 1) : 0;

  const plotted = points
    .map((value, i) =>
      value === null
        ? null
        : {
            x: PAD_X + i * step,
            y:
              HEIGHT -
              PAD_Y -
              ((Math.min(max, Math.max(min, value)) - min) / span) * (HEIGHT - PAD_Y * 2),
            isLast: i === points.length - 1,
          }
    )
    .filter((point): point is { x: number; y: number; isLast: boolean } => point !== null);

  if (plotted.length === 0) {
    return (
      <svg
        className="h-7 w-full"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="presentation"
        aria-hidden
      >
        <line
          x1={PAD_X}
          y1={HEIGHT / 2}
          x2={WIDTH - PAD_X}
          y2={HEIGHT / 2}
          stroke={EMPTY_LINE_COLOR}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const latest = plotted[plotted.length - 1];
  const latestColor = WELLNESS_TONE_COLOR[tone === "none" ? "good" : tone];

  return (
    <svg className="h-7 w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="presentation" aria-hidden>
      {plotted.length > 1 && (
        <polyline
          points={plotted.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {plotted.map((point) => (
        <circle
          key={point.x}
          cx={point.x}
          cy={point.y}
          r={point === latest ? 2.5 : 2}
          fill={point === latest ? latestColor : "#fff"}
          stroke={point === latest ? latestColor : LINE_COLOR}
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}
