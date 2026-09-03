import { createPortalClient } from "./client-portal-service";
import { CLIENT_MEASUREMENT_EMBEDS } from "./measurements-service";
import { getTrend, calculatePercentChange } from "@/utils/metric-shaping";
import { fetchAllPages } from "@/lib/paged-fetch";
import { dayValues, type MeasurementReading } from "@/lib/measurements/day-values";
import { isMeasurementKey, type MeasurementKey, type MeasurementSource } from "@/lib/measurements/keys";
import type { ClientMeasurementEmbed } from "@/lib/database-helpers";
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
type ProgressDataPoint = {
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

// The measurement-log row shape this read selects, under the client's own JWT.
type LiveMeasurementRow = {
  id: string | null;
  metric_key: string | null;
  value: number | null;
  recorded_on: string | null;
  recorded_at: string | null;
  updated_at: string | null;
  measured_at: string | null;
  source: string | null;
  source_id: string | null;
  note: string | null;
};

type ClientProgressRow = {
  current_streak: number | null;
  check_in_adherence_rate: number | null;
  goal_weight: number | null;
  goal_body_fat_percentage: number | null;
  client_current_measurements: ClientMeasurementEmbed[] | null;
  client_baseline_measurements: ClientMeasurementEmbed[] | null;
};

function embeddedReading(
  rows: ClientMeasurementEmbed[] | null | undefined,
  metricKey: "weight" | "bodyFat"
): number | undefined {
  const row = rows?.find((candidate) => candidate.metric_key === metricKey);
  return row?.value == null ? undefined : Number(row.value);
}

// The history arrays are keyed by the wire's field names, the log by its keys.
const HISTORY_FIELD: Record<MeasurementKey, keyof ProgressDataPoint> = {
  weight: "weight",
  bodyFat: "bodyFatPercentage",
  waist: "waist",
  hips: "hips",
  chest: "chest",
  arms: "arms",
  thighs: "thighs",
};

// Get progress data for charts
export async function getClientProgressData(
  clientId: string,
  days: number = 90
): Promise<ProgressData> {
  const supabase = await createPortalClient();

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const fromDay = startDate.toISOString().slice(0, 10);

  // Three independent reads, under the client's JWT: the check-ins' wellness
  // averages, the measurement log's live rows (the D6 policy is what lets this
  // client see their own — every reading about them, of any source) and the
  // client row with its two reading views embedded. The log read is paged: it
  // feeds a series and must be complete past PostgREST's row cap.
  const [{ data: checkIns }, readingRows, { data: clientData, error: clientError }] =
    await Promise.all([
      supabase
        .from("check_ins")
        .select("created_at, mood, energy, sleep, stress, soreness")
        .eq("client_id", clientId)
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: true }),
      fetchAllPages<LiveMeasurementRow>(
        (from, to) =>
          supabase
            .from("client_measurements_live")
            .select("id, metric_key, value, recorded_on, recorded_at, updated_at, measured_at, source, source_id, note")
            .eq("client_id", clientId)
            .gte("recorded_on", fromDay)
            .order("recorded_on", { ascending: true })
            .order("updated_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        { errorLabel: "client measurements" }
      ),
      supabase
        .from("clients")
        .select(`current_streak, check_in_adherence_rate, goal_weight, goal_body_fat_percentage, ${CLIENT_MEASUREMENT_EMBEDS}`)
        .eq("id", clientId)
        .single(),
    ]);

  // Surface a failed client fetch instead of swallowing it. A silent failure
  // here is exactly what made every weight/measurement default to lbs/in for
  // metric clients: a previous version of this query selected a column that does
  // not exist on `clients`, so PostgREST rejected the whole query and
  // `clientData` came back null — with the error logged and the request
  // continuing. The four weight columns left this select with the measurement
  // log (their readings ride in from the two embedded views); do not
  // reintroduce a column here without checking it against the live schema.
  if (clientError) {
    console.error(
      `Failed to load client unit/goal fields for ${clientId}:`,
      clientError.message,
    );
  }
  const client = (clientData ?? null) as ClientProgressRow | null;

  // The seven physique histories: one value per day by rule 2, of any source —
  // the client sees every reading about them (D6).
  const readings: MeasurementReading[] = readingRows.flatMap((row) =>
    row.id && row.metric_key && isMeasurementKey(row.metric_key) && row.value != null &&
    row.recorded_on && row.recorded_at && row.updated_at && row.source
      ? [{
          id: row.id,
          metricKey: row.metric_key,
          value: Number(row.value),
          date: row.recorded_on,
          recordedAt: row.recorded_at,
          updatedAt: row.updated_at,
          measuredAt: row.measured_at,
          source: row.source as MeasurementSource,
          sourceId: row.source_id,
          note: row.note,
        }]
      : []
  );
  const byMetric = dayValues(readings);
  const history = (key: MeasurementKey): ProgressDataPoint[] =>
    (byMetric.get(key) ?? []).map((value) => ({ date: value.date, [HISTORY_FIELD[key]]: value.value }));

  const weightHistory = history("weight");
  const bodyFatHistory = history("bodyFat");
  const waistHistory = history("waist");
  const hipsHistory = history("hips");
  const chestHistory = history("chest");
  const armsHistory = history("arms");
  const thighsHistory = history("thighs");
  const moodHistory: ProgressDataPoint[] = [];
  const energyHistory: ProgressDataPoint[] = [];
  const sleepHistory: ProgressDataPoint[] = [];
  const stressHistory: ProgressDataPoint[] = [];
  const sorenessHistory: ProgressDataPoint[] = [];

  if (checkIns) {
    for (const checkIn of checkIns) {
      const date = checkIn.created_at.split("T")[0];

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
    currentStreak: client?.current_streak ?? 0,
    adherenceRate: client?.check_in_adherence_rate ?? 0,
    client: {
      goalWeight: client?.goal_weight ?? undefined,
      goalBodyFatPercentage: client?.goal_body_fat_percentage ?? undefined,
      startingWeight: embeddedReading(client?.client_baseline_measurements, "weight"),
      startingBodyFatPercentage: embeddedReading(client?.client_baseline_measurements, "bodyFat"),
      currentWeight: embeddedReading(client?.client_current_measurements, "weight"),
      currentBodyFatPercentage: embeddedReading(client?.client_current_measurements, "bodyFat"),
    },
  };
}
