"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Flame, TrendingUp, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { swrFetcher } from "@/lib/swr-fetcher";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientProgressMetrics } from "@/hooks/use-client-progress-metrics";
import { MetricChartCard } from "@/components/metrics/metric-chart-card";
import { getDateString, getTodayDateString } from "@/lib/date-helpers";
import type { ProgressData } from "@/services/client-portal-progress";
import type { DailyHabit, DailyHabitLog } from "@/types/daily-habit";
import { GoalsSection } from "./goals-section";
import { DateRangeSelector } from "./date-range-selector";
import { HabitsSection } from "./habits-section";
import { PerformanceView } from "./performance/performance-view";
import { useUnits } from "@/contexts/units-context";
import { formatLength, formatWeight, type UnitSystem } from "@/utils/unit-conversions";

// The series arrives canonical (kg/cm) with no unit — the server cannot know the
// viewer. Both the label and the conversion resolve here, keyed on the metric
// id, so the client portal and the coach Metrics page cannot disagree.
const WEIGHT_METRICS = new Set(["weight"]);
const LENGTH_METRICS = new Set(["waist", "hips", "chest", "arms", "thighs"]);

// Wellness scores and body fat are unitless scales, identical for every viewer.
const STATIC_UNITS: Record<string, string> = {
  bodyFat: "%",
  mood: "/5",
  energy: "/10",
  sleep: "/10",
  stress: "/10",
  soreness: "/10",
};

function viewerUnit(id: string, viewer: UnitSystem): string {
  if (WEIGHT_METRICS.has(id)) return formatWeight(0, viewer).unit;
  if (LENGTH_METRICS.has(id)) return formatLength(0, viewer).unit;
  return STATIC_UNITS[id] ?? "";
}

function toViewerValue(id: string, value: number, viewer: UnitSystem): number {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  if (WEIGHT_METRICS.has(id)) return round1(formatWeight(value, viewer).value);
  if (LENGTH_METRICS.has(id)) return round1(formatLength(value, viewer).value);
  return value;
}


export type MetricsTab = "physique" | "performance" | "wellness" | "habits";

const TABS: { key: MetricsTab; label: string }[] = [
  { key: "physique", label: "Physique" },
  { key: "performance", label: "Performance" },
  { key: "wellness", label: "Wellness" },
  { key: "habits", label: "Habits" },
];

const SWR_CONFIG = {
  revalidateOnFocus: false,
  errorRetryCount: 3,
  errorRetryInterval: 1000,
  dedupingInterval: 2000,
};

type MetricsHubProps = {
  initialTab?: MetricsTab;
};

// Swipeable client metrics hub: Physique / Performance / Wellness / Habits.
// Physique, Wellness and Habits reuse the components consolidated out of the
// retired /client/progress page; Performance is the net-new exercise analytics.
export function MetricsHub({ initialTab = "physique" }: MetricsHubProps) {
  const [dateRange, setDateRange] = useState("90");
  const [api, setApi] = useState<CarouselApi>();
  const initialIndex = Math.max(
    0,
    TABS.findIndex((t) => t.key === initialTab),
  );
  const [active, setActive] = useState(initialIndex);
  const didInit = useRef(false);

  const days = dateRange === "all" ? 365 : parseInt(dateRange, 10);

  const { data: progressResp, isLoading: progressLoading } = useSWR<{
    success: boolean;
    data: ProgressData;
  }>(`/api/client/progress?days=${days}`, swrFetcher, {
    ...SWR_CONFIG,
    onError: (err) => console.error("Failed to load progress data:", err),
  });

  const habitWindow = useMemo(() => {
    const endDate = getTodayDateString();
    const startDate = getDateString(new Date(Date.now() - 28 * 24 * 60 * 60 * 1000));
    return { startDate, endDate };
  }, []);

  const { data: habitsResp } = useSWR<{ data: DailyHabit[] }>(
    "/api/client/habits",
    swrFetcher,
    SWR_CONFIG,
  );
  const { data: habitLogsResp } = useSWR<{ data: DailyHabitLog[] }>(
    `/api/client/habits/logs?startDate=${habitWindow.startDate}&endDate=${habitWindow.endDate}`,
    swrFetcher,
    SWR_CONFIG,
  );

  const progressData = progressResp?.data ?? null;
  const habits = habitsResp?.data ?? [];
  const habitLogs = habitLogsResp?.data ?? [];

  const { bodyMetrics, wellnessMetrics } = useClientProgressMetrics(progressData);

  // Swipe -> active tab.
  useEffect(() => {
    if (!api) return;
    const onSelect = () => setActive(api.selectedScrollSnap());
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  // Honor a deep-linked initial tab once the carousel is ready (jump, no anim).
  useEffect(() => {
    if (!api || didInit.current) return;
    didInit.current = true;
    if (initialIndex > 0) api.scrollTo(initialIndex, true);
  }, [api, initialIndex]);

  const goTo = (i: number) => {
    setActive(i);
    api?.scrollTo(i);
  };

  const lastWeight =
    progressData?.weightHistory?.[progressData.weightHistory.length - 1]?.weight;
  const lastBodyFat =
    progressData?.bodyFatHistory?.[progressData.bodyFatHistory.length - 1]
      ?.bodyFatPercentage;

  return (
    <div className="space-y-4">
      <h1 className="text-[18px] font-semibold text-[#0c1a1e]">Metrics</h1>

      <div role="tablist" aria-label="Metrics categories" className="flex border-b border-[rgba(13,148,136,0.12)]">
        {TABS.map((tab, i) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === i}
            onClick={() => goTo(i)}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2 text-[13px] transition-colors",
              active === i
                ? "border-[#0d9488] font-medium text-[#0d9488]"
                : "border-transparent text-[#5a7d82] hover:text-[#0c1a1e]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Carousel setApi={setApi} opts={{ watchDrag: true }} className="w-full">
        <CarouselContent>
          <CarouselItem>
            <div className="space-y-4">
              <div className="flex justify-end">
                <DateRangeSelector value={dateRange} onChange={setDateRange} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Streak" value={progressData?.currentStreak ?? 0} suffix="wks" icon={Flame} />
                <StatTile label="Adherence" value={Math.round(progressData?.adherenceRate ?? 0)} suffix="%" icon={TrendingUp} />
                <StatTile label="Check-ins" value={progressData?.checkInCount ?? 0} suffix="" icon={Calendar} />
              </div>
              {progressData && (
                <GoalsSection
                  client={progressData.client}
                  latestWeight={lastWeight}
                  latestBodyFat={lastBodyFat}
                />
              )}
              <MetricList metrics={bodyMetrics} isLoading={progressLoading} />
            </div>
          </CarouselItem>

          <CarouselItem>
            <PerformanceView />
          </CarouselItem>

          <CarouselItem>
            <MetricList metrics={wellnessMetrics} isLoading={progressLoading} />
          </CarouselItem>

          <CarouselItem>
            <HabitsSection habits={habits} habitLogs={habitLogs} />
          </CarouselItem>
        </CarouselContent>
      </Carousel>
    </div>
  );
}

function MetricList({
  metrics,
  isLoading,
}: {
  metrics: ReturnType<typeof useClientProgressMetrics>["bodyMetrics"];
  isLoading: boolean;
}) {
  const { preference } = useUnits();
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[140px] w-full rounded-[8px]" />
        <Skeleton className="h-[140px] w-full rounded-[8px]" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {metrics.map((metric) => (
        <MetricChartCard
          key={metric.id}
          id={metric.id}
          name={metric.name}
          currentValue={
            metric.currentValue === null
              ? null
              : toViewerValue(metric.id, metric.currentValue, preference)
          }
          unit={viewerUnit(metric.id, preference)}
          percentChange={metric.percentChange}
          trend={metric.trend}
          chartData={metric.chartData}
        />
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  suffix,
  icon: Icon,
}: {
  label: string;
  value: number;
  suffix: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-[8px] bg-white p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[#93b0b4]">
        <Icon className="h-3.5 w-3.5 text-[#0d9488]" />
        {label}
      </div>
      <p className="mt-1 font-mono-display text-[20px] font-medium text-[#0c1a1e]">
        {value}
        {suffix && <span className="ml-1 text-[12px] text-[#93b0b4]">{suffix}</span>}
      </p>
    </div>
  );
}
