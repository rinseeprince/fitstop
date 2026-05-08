import type { ExerciseProgressionPoint } from "@/types/training";

type TrendMetric = "weight" | "e1rm" | "volume" | "rpe" | "compliance";

// ---------------------------------------------------------------------------
// KPI types
// ---------------------------------------------------------------------------

export type KpiCard = {
  label: string;
  value: string;
  unit?: string;
  meta?: string;
  trend?: "up" | "down" | "flat";
};

// ---------------------------------------------------------------------------
// KPI computation
// ---------------------------------------------------------------------------

export function computeKpis(
  metric: TrendMetric,
  data: ExerciseProgressionPoint[],
): KpiCard[] {
  if (data.length === 0) return [];

  switch (metric) {
    case "weight":
      return weightKpis(data);
    case "e1rm":
      return e1rmKpis(data);
    case "volume":
      return volumeKpis(data);
    case "rpe":
      return rpeKpis(data);
    case "compliance":
      return complianceKpis(data);
  }
}

function weightKpis(data: ExerciseProgressionPoint[]): KpiCard[] {
  const withWeight = data.filter((p) => p.topSetWeight != null);
  if (withWeight.length === 0) return [];

  const latest = withWeight[withWeight.length - 1];
  const first = withWeight[0];
  const topSet = latest.topSetWeight!;
  const delta = topSet - (first.topSetWeight ?? topSet);

  const bestE1rm = Math.max(
    ...withWeight.map((p) => p.estimatedOneRepMax ?? 0),
  );

  // Find most recent PR-worthy session (highest weight)
  const maxWeight = Math.max(...withWeight.map((p) => p.topSetWeight!));
  const prSession = [...withWeight].reverse().find(
    (p) => p.topSetWeight === maxWeight,
  );
  const prDaysAgo = prSession
    ? Math.floor(
        (Date.now() - new Date(prSession.date).getTime()) / 86400000,
      )
    : null;

  return [
    {
      label: "Top Set",
      value: String(topSet),
      unit: "kg",
      meta: delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} over period` : undefined,
      trend: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    },
    {
      label: "Estimated 1RM",
      value: bestE1rm > 0 ? bestE1rm.toFixed(0) : "-",
      unit: "kg",
      meta: blockTrendText(withWeight, (p) => p.estimatedOneRepMax),
      trend: blockTrend(withWeight, (p) => p.estimatedOneRepMax),
    },
    {
      label: "Last PR",
      value: String(maxWeight),
      unit: "kg",
      meta:
        prDaysAgo != null
          ? prDaysAgo === 0
            ? "Today"
            : `${prDaysAgo} day${prDaysAgo === 1 ? "" : "s"} ago`
          : undefined,
    },
  ];
}

function e1rmKpis(data: ExerciseProgressionPoint[]): KpiCard[] {
  const withE1rm = data.filter((p) => p.estimatedOneRepMax != null);
  if (withE1rm.length === 0) return [];

  const latest = withE1rm[withE1rm.length - 1].estimatedOneRepMax!;
  const best = Math.max(...withE1rm.map((p) => p.estimatedOneRepMax!));

  return [
    {
      label: "Current e1RM",
      value: latest.toFixed(0),
      unit: "kg",
    },
    {
      label: "Best e1RM",
      value: best.toFixed(0),
      unit: "kg",
      meta: latest >= best ? "Current best" : undefined,
    },
    {
      label: "Trend",
      value: blockTrendPct(withE1rm, (p) => p.estimatedOneRepMax),
      meta: blockTrendText(withE1rm, (p) => p.estimatedOneRepMax),
      trend: blockTrend(withE1rm, (p) => p.estimatedOneRepMax),
    },
  ];
}

function volumeKpis(data: ExerciseProgressionPoint[]): KpiCard[] {
  const withVol = data.filter((p) => p.totalVolume != null);
  if (withVol.length === 0) return [];

  const total = withVol.reduce((s, p) => s + (p.totalVolume ?? 0), 0);
  const avg = Math.round(total / withVol.length);
  const peak = Math.max(...withVol.map((p) => p.totalVolume!));

  return [
    { label: "Total Volume", value: total.toLocaleString(), unit: "kg" },
    { label: "Avg per Session", value: avg.toLocaleString(), unit: "kg" },
    { label: "Peak Session", value: peak.toLocaleString(), unit: "kg" },
  ];
}

function rpeKpis(data: ExerciseProgressionPoint[]): KpiCard[] {
  const withRpe = data.filter((p) => p.topSetRpe != null);
  if (withRpe.length === 0) return [];

  const avg = withRpe.reduce((s, p) => s + p.topSetRpe!, 0) / withRpe.length;
  const last = withRpe[withRpe.length - 1].topSetRpe!;

  // RPE drift: compare last 3 vs first 3
  const driftText = rpeDriftText(withRpe);

  return [
    { label: "Avg RPE", value: avg.toFixed(1) },
    { label: "Last Session", value: String(last) },
    {
      label: "RPE Drift",
      value: driftText.value,
      meta: driftText.meta,
      trend: driftText.trend,
    },
  ];
}

function complianceKpis(data: ExerciseProgressionPoint[]): KpiCard[] {
  const withPrescription = data.filter((p) => p.prescribedSets != null);
  if (withPrescription.length === 0) return [];

  const hit = withPrescription.filter(
    (p) => p.actualSets >= (p.prescribedSets ?? 0),
  ).length;
  const rate = Math.round((hit / withPrescription.length) * 100);

  // Streak: count consecutive hits from the end
  let streak = 0;
  for (let i = withPrescription.length - 1; i >= 0; i--) {
    if (withPrescription[i].actualSets >= (withPrescription[i].prescribedSets ?? 0)) {
      streak++;
    } else {
      break;
    }
  }

  return [
    { label: "Compliance Rate", value: `${rate}`, unit: "%" },
    {
      label: "Sessions Hit",
      value: `${hit}/${withPrescription.length}`,
    },
    {
      label: "Current Streak",
      value: String(streak),
      unit: streak === 1 ? "session" : "sessions",
    },
  ];
}

// ---------------------------------------------------------------------------
// Insight text
// ---------------------------------------------------------------------------

export function computeInsight(
  metric: TrendMetric,
  data: ExerciseProgressionPoint[],
): string | null {
  if (data.length < 2) return null;

  switch (metric) {
    case "weight": {
      const withW = data.filter((p) => p.topSetWeight != null);
      if (withW.length < 2) return null;
      const first = withW[0].topSetWeight!;
      const last = withW[withW.length - 1].topSetWeight!;
      const dir = last > first ? "Upward" : last < first ? "Downward" : "Flat";
      const maxW = Math.max(...withW.map((p) => p.topSetWeight!));
      const prIdx = withW.findIndex((p) => p.topSetWeight === maxW);
      const isPrRecent = prIdx >= withW.length - 3;
      return `${dir} trend${isPrRecent ? ` with new PR of ${maxW}kg in recent sessions` : ""}. ${last > first ? "No regression sessions in this block." : ""}`.trim();
    }
    case "e1rm": {
      const withE = data.filter((p) => p.estimatedOneRepMax != null);
      if (withE.length < 2) return null;
      const first = withE[0].estimatedOneRepMax!;
      const last = withE[withE.length - 1].estimatedOneRepMax!;
      const pct = ((last - first) / first * 100).toFixed(0);
      return last >= first
        ? `e1RM increased ${pct}% across this block.`
        : `e1RM decreased ${Math.abs(Number(pct))}% across this block.`;
    }
    case "volume": {
      const withV = data.filter((p) => p.totalVolume != null);
      if (withV.length < 2) return null;
      const peak = Math.max(...withV.map((p) => p.totalVolume!));
      const peakIdx = withV.findIndex((p) => p.totalVolume === peak);
      const isRecent = peakIdx >= withV.length - 3;
      const avg = withV.reduce((s, p) => s + (p.totalVolume ?? 0), 0) / withV.length;
      const last = withV[withV.length - 1].totalVolume!;
      return last >= avg
        ? `Volume trending above average${isRecent ? " with peak in recent sessions" : ""}.`
        : `Volume below average - ${isRecent ? "recent peak may indicate recovery" : "potential deload period"}.`;
    }
    case "rpe": {
      const withR = data.filter((p) => p.topSetRpe != null);
      if (withR.length < 2) return null;
      const drift = rpeDriftText(withR);
      if (drift.trend === "up") return "RPE rising for similar weights - possible accumulated fatigue.";
      if (drift.trend === "down") return "RPE falling - strength adaptation progressing well.";
      return "RPE stable across sessions.";
    }
    case "compliance": {
      const withP = data.filter((p) => p.prescribedSets != null);
      if (withP.length < 2) return null;
      const hit = withP.filter((p) => p.actualSets >= (p.prescribedSets ?? 0)).length;
      const rate = Math.round((hit / withP.length) * 100);
      let streak = 0;
      for (let i = withP.length - 1; i >= 0; i--) {
        if (withP[i].actualSets >= (withP[i].prescribedSets ?? 0)) streak++;
        else break;
      }
      return `${rate}% compliance rate${streak >= 3 ? ` with a ${streak}-session streak` : ""}.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blockTrend(
  data: ExerciseProgressionPoint[],
  getter: (p: ExerciseProgressionPoint) => number | null,
): "up" | "down" | "flat" {
  if (data.length < 4) return "flat";
  const mid = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, mid);
  const secondHalf = data.slice(mid);
  const avg1 = average(firstHalf, getter);
  const avg2 = average(secondHalf, getter);
  if (avg2 > avg1 * 1.02) return "up";
  if (avg2 < avg1 * 0.98) return "down";
  return "flat";
}

function blockTrendPct(
  data: ExerciseProgressionPoint[],
  getter: (p: ExerciseProgressionPoint) => number | null,
): string {
  if (data.length < 4) return "-";
  const mid = Math.floor(data.length / 2);
  const avg1 = average(data.slice(0, mid), getter);
  const avg2 = average(data.slice(mid), getter);
  if (avg1 === 0) return "-";
  const pct = ((avg2 - avg1) / avg1) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function blockTrendText(
  data: ExerciseProgressionPoint[],
  getter: (p: ExerciseProgressionPoint) => number | null,
): string | undefined {
  const t = blockTrend(data, getter);
  if (t === "up") return "vs previous block";
  if (t === "down") return "vs previous block";
  return undefined;
}

function average(
  data: ExerciseProgressionPoint[],
  getter: (p: ExerciseProgressionPoint) => number | null,
): number {
  const vals = data.map(getter).filter((v): v is number => v != null);
  if (vals.length === 0) return 0;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function rpeDriftText(
  data: ExerciseProgressionPoint[],
): { value: string; meta?: string; trend?: "up" | "down" | "flat" } {
  if (data.length < 4) return { value: "-", meta: "Not enough data" };
  const n = Math.min(3, Math.floor(data.length / 2));
  const early = data.slice(0, n);
  const late = data.slice(-n);
  const avgEarly = early.reduce((s, p) => s + (p.topSetRpe ?? 0), 0) / early.length;
  const avgLate = late.reduce((s, p) => s + (p.topSetRpe ?? 0), 0) / late.length;
  const diff = avgLate - avgEarly;
  if (diff > 0.5) return { value: `+${diff.toFixed(1)}`, meta: "Rising", trend: "up" };
  if (diff < -0.5) return { value: diff.toFixed(1), meta: "Falling", trend: "down" };
  return { value: "Stable", trend: "flat" };
}
