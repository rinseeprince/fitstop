import { createPortalClient } from "./client-portal-service";
import { getTrend, calculatePercentChange } from "@/utils/metric-shaping";
import type { TrendDirection } from "@/types/check-in";

// Render-ready, locale-neutral metric series emitted by the API. `chartData[].date`
// is the RAW ISO date (YYYY-MM-DD) from each history point — the client formats it
// at render (date-fns "MMM d"). This is the source of truth for the series type;
// the browser transform hook re-exports it for back-compat.
export type ClientMetricSeries = {
  id: string;
  name: string;
  /** CANONICAL kg/cm. The unit label and the conversion both resolve at the
   *  render boundary from `id` — the server does not know the viewer. */
  currentValue: number | null;
  percentChange: number | null;
  trend: TrendDirection;
  chartData: Array<{ date: string; value: number }>;
};

// Progress data for charts
export type ProgressDataPoint = {
  date: string;
  weight?: number;
  bodyFatPercentage?: number;
  waist?: number;
  hips?: number;
  chest?: number;
  arms?: number;
  thighs?: number;
  mood?: number;
  energy?: number;
  sleep?: number;
  stress?: number;
  soreness?: number;
};

export type ProgressData = {
  weightHistory: ProgressDataPoint[];
  bodyFatHistory: ProgressDataPoint[];
  bodyMeasurements: {
    waistHistory: ProgressDataPoint[];
    hipsHistory: ProgressDataPoint[];
    chestHistory: ProgressDataPoint[];
    armsHistory: ProgressDataPoint[];
    thighsHistory: ProgressDataPoint[];
  };
  // Render-ready series built server-side from the raw history arrays above. The
  // browser hook is a thin reader of these. The flat body raw arrays + goals
  // remain for the stat tiles / goals section that read them directly. The
  // wellness raw container is superseded by `wellnessMetrics` (its only reader
  // was the transform hook, now collapsed), so it is no longer carried.
  bodyMetrics: ClientMetricSeries[];
  wellnessMetrics: ClientMetricSeries[];
  checkInCount: number;
  currentStreak: number;
  adherenceRate: number;
  client: {
    goalWeight?: number;
    goalBodyFatPercentage?: number;
    startingWeight?: number;
    startingBodyFatPercentage?: number;
    currentWeight?: number;
    currentBodyFatPercentage?: number;
    weightUnit?: "lbs" | "kg";
    measurementUnit?: "in" | "cm";
  };
};

// Build one render-ready series from an already-assembled history array.
// `chartData[].date` is the raw ISO date string from each point — NOT formatted.
function buildMetricSeries(
  history: ProgressDataPoint[],
  metricKey: keyof ProgressDataPoint,
  id: string,
  name: string,
): ClientMetricSeries {
  const chartData = history.map((point) => ({
    date: point.date,
    value: point[metricKey] as number,
  }));

  const latestPoint = history[history.length - 1];
  const previousPoint = history[history.length - 2];

  const currentValue = latestPoint
    ? (latestPoint[metricKey] as number)
    : null;
  const previousValue = previousPoint
    ? (previousPoint[metricKey] as number)
    : null;

  return {
    id,
    name,
    currentValue,
    percentChange: calculatePercentChange(currentValue, previousValue),
    trend: getTrend(currentValue, previousValue),
    chartData,
  };
}

// Get progress data for charts
export async function getClientProgressData(
  clientId: string,
  days: number = 90
): Promise<ProgressData> {
  const supabase = await createPortalClient();

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { data: checkIns } = await supabase
    .from("check_ins")
    .select(`
      created_at,
      weight,
      body_fat_percentage,
      waist,
      hips,
      chest,
      arms,
      thighs,
      mood,
      energy,
      sleep,
      stress,
      soreness
    `)
    .eq("client_id", clientId)
    .gte("created_at", startDate.toISOString())
    .order("created_at", { ascending: true });

  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select(`
      current_streak,
      check_in_adherence_rate,
      goal_weight,
      goal_body_fat_percentage,
      starting_weight,
      starting_body_fat_percentage,
      current_weight,
      current_body_fat_percentage
    `)
    .eq("id", clientId)
    .single();

  // Surface a failed client fetch instead of swallowing it. A silent failure
  // here is exactly what made every weight/measurement default to lbs/in for
  // metric clients: a previous version of this query selected a column that does
  // not exist on `clients`, so PostgREST rejected the whole query and
  // `clientData` came back null — with the error logged and the request
  // continuing. `weight_unit` was removed from this select for the same reason
  // when migration 141 dropped it; do not reintroduce a column here without
  // checking it against the live schema.
  if (clientError) {
    console.error(
      `Failed to load client unit/goal fields for ${clientId}:`,
      clientError.message,
    );
  }

  // Stored values are canonical kg/cm (migration 141), so these describe the
  // STORED unit, not a preference. Phase 3 converts for the viewer at render.

  const weightHistory: ProgressDataPoint[] = [];
  const bodyFatHistory: ProgressDataPoint[] = [];
  const waistHistory: ProgressDataPoint[] = [];
  const hipsHistory: ProgressDataPoint[] = [];
  const chestHistory: ProgressDataPoint[] = [];
  const armsHistory: ProgressDataPoint[] = [];
  const thighsHistory: ProgressDataPoint[] = [];
  const moodHistory: ProgressDataPoint[] = [];
  const energyHistory: ProgressDataPoint[] = [];
  const sleepHistory: ProgressDataPoint[] = [];
  const stressHistory: ProgressDataPoint[] = [];
  const sorenessHistory: ProgressDataPoint[] = [];

  if (checkIns) {
    for (const checkIn of checkIns) {
      const date = checkIn.created_at.split("T")[0];

      if (checkIn.weight) {
        weightHistory.push({ date, weight: checkIn.weight });
      }
      if (checkIn.body_fat_percentage) {
        bodyFatHistory.push({ date, bodyFatPercentage: checkIn.body_fat_percentage });
      }
      if (checkIn.waist) {
        waistHistory.push({ date, waist: checkIn.waist });
      }
      if (checkIn.hips) {
        hipsHistory.push({ date, hips: checkIn.hips });
      }
      if (checkIn.chest) {
        chestHistory.push({ date, chest: checkIn.chest });
      }
      if (checkIn.arms) {
        armsHistory.push({ date, arms: checkIn.arms });
      }
      if (checkIn.thighs) {
        thighsHistory.push({ date, thighs: checkIn.thighs });
      }
      if (checkIn.mood) {
        moodHistory.push({ date, mood: checkIn.mood });
      }
      if (checkIn.energy) {
        energyHistory.push({ date, energy: checkIn.energy });
      }
      if (checkIn.sleep) {
        sleepHistory.push({ date, sleep: checkIn.sleep });
      }
      if (checkIn.stress) {
        stressHistory.push({ date, stress: checkIn.stress });
      }
      if (checkIn.soreness) {
        sorenessHistory.push({ date, soreness: checkIn.soreness });
      }
    }
  }

  // Series values stay CANONICAL (kg/cm). The unit label and the conversion are
  // both resolved at the render boundary from the metric id — the server cannot
  // know the viewer's preference, and resolving it here is what let girths ship
  // labelled "in" over centimetre values. See metrics-hub.tsx.

  const bodyMetrics: ClientMetricSeries[] = [
    buildMetricSeries(weightHistory, "weight", "weight", "Weight"),
    buildMetricSeries(bodyFatHistory, "bodyFatPercentage", "bodyFat", "Body Fat"),
    buildMetricSeries(waistHistory, "waist", "waist", "Waist"),
    buildMetricSeries(hipsHistory, "hips", "hips", "Hips"),
    buildMetricSeries(chestHistory, "chest", "chest", "Chest"),
    buildMetricSeries(armsHistory, "arms", "arms", "Arms"),
    buildMetricSeries(thighsHistory, "thighs", "thighs", "Thighs"),
  ];

  const wellnessMetrics: ClientMetricSeries[] = [
    buildMetricSeries(moodHistory, "mood", "mood", "Mood"),
    buildMetricSeries(energyHistory, "energy", "energy", "Energy"),
    buildMetricSeries(sleepHistory, "sleep", "sleep", "Sleep"),
    buildMetricSeries(stressHistory, "stress", "stress", "Stress"),
    buildMetricSeries(sorenessHistory, "soreness", "soreness", "Soreness"),
  ];

  return {
    weightHistory,
    bodyFatHistory,
    bodyMeasurements: {
      waistHistory,
      hipsHistory,
      chestHistory,
      armsHistory,
      thighsHistory,
    },
    bodyMetrics,
    wellnessMetrics,
    checkInCount: checkIns?.length ?? 0,
    currentStreak: clientData?.current_streak ?? 0,
    adherenceRate: clientData?.check_in_adherence_rate ?? 0,
    client: {
      goalWeight: clientData?.goal_weight ?? undefined,
      goalBodyFatPercentage: clientData?.goal_body_fat_percentage ?? undefined,
      startingWeight: clientData?.starting_weight ?? undefined,
      startingBodyFatPercentage: clientData?.starting_body_fat_percentage ?? undefined,
      currentWeight: clientData?.current_weight ?? undefined,
      currentBodyFatPercentage: clientData?.current_body_fat_percentage ?? undefined,
    },
  };
}
