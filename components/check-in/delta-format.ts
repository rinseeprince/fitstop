import { trendOfChange } from "@/utils/metric-shaping";

export type DeltaInfo = { text: string; type: "positive" | "negative" | "neutral" };

/**
 * Every delta on the check-in review page goes through here, so the band's
 * weight cell and the wellness row's five scores cannot disagree about what a
 * change means. The colour follows the number shown: rounded to one decimal
 * like the value beside it, good or bad by direction (`invert` for the metrics
 * where down is good), and neutral only when it rounds to 0.0.
 */
export function formatDeltaValue(val: number, invert: boolean): DeltaInfo {
  const rounded = Number(val.toFixed(1));
  const trend = trendOfChange(val);
  const sign = rounded > 0 ? "+" : "";
  const text = `${sign}${rounded % 1 === 0 ? rounded : rounded.toFixed(1)}`;
  const type =
    trend === "stable" ? "neutral" : (trend === "up") !== invert ? "positive" : "negative";
  return { text, type };
}
