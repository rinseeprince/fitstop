"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";

import { DayHeader } from "@/components/client-portal/day/day-header";
import { PhaseBanner } from "@/components/client-portal/day/phase-banner";
import { TrainingCardSummary } from "@/components/client-portal/day/training-card-summary";
import { NutritionCardSummary } from "@/components/client-portal/day/nutrition-card-summary";
import { WellnessCardSummary } from "@/components/client-portal/day/wellness-card-summary";
import { HabitsCardSummary } from "@/components/client-portal/day/habits-card-summary";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { swrFetcher } from "@/lib/swr-fetcher";
import {
  getDateDaysFrom,
  getDateString,
  getTodayDateString,
} from "@/lib/date-helpers";
import type { DaySummary } from "@/types/client-day";

const DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SWIPE_PX = 50;
const SWIPE_AXIS_RATIO = 1.5;
const CARD_LABELS = ["Training", "Nutrition", "Wellness", "Habits"] as const;

function parseDateOrToday(raw: string | null): string {
  if (!raw || !DATE_SHAPE_RE.test(raw)) return getTodayDateString();
  const parsed = new Date(raw + "T00:00:00");
  if (Number.isNaN(parsed.getTime())) return getTodayDateString();
  if (getDateString(parsed) !== raw) return getTodayDateString();
  return raw;
}

function ClientHomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const date = useMemo(
    () => parseDateOrToday(searchParams?.get("date") ?? null),
    [searchParams],
  );

  const { data, error, isLoading, mutate } = useSWR<{
    success: boolean;
    data: DaySummary;
  }>(`/api/client/day-summary?date=${date}`, swrFetcher, {
    dedupingInterval: 2000,
    revalidateOnFocus: false,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    keepPreviousData: true,
  });

  const goTo = useCallback(
    (next: string) => {
      const href = next === getTodayDateString() ? "/client" : `/client?date=${next}`;
      router.replace(href, { scroll: false });
    },
    [router],
  );

  const onPrev = useCallback(() => {
    goTo(getDateDaysFrom(new Date(date + "T00:00:00"), -1));
  }, [date, goTo]);

  const onNext = useCallback(() => {
    goTo(getDateDaysFrom(new Date(date + "T00:00:00"), 1));
  }, [date, goTo]);

  const onToday = useCallback(() => {
    goTo(getTodayDateString());
  }, [goTo]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "ArrowLeft") onPrev();
      else if (event.key === "ArrowRight") onNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onPrev, onNext]);

  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (event: React.TouchEvent) => {
    const t = event.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return;
    if (dx > 0) onPrev();
    else onNext();
  };

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <PhaseBanner phase={data?.data.phase ?? null} />
      <DayHeader date={date} onPrev={onPrev} onNext={onNext} onToday={onToday} />

      {error ? (
        <DayLoadError onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <PlaceholderGrid loading />
      ) : (
        <div className="flex flex-col gap-3 pb-6">
          <TrainingCardSummary events={data.data.training} date={date} />
          <NutritionCardSummary nutrition={data.data.nutrition} date={date} />
          <WellnessCardSummary wellness={data.data.wellness} date={date} />
          <HabitsCardSummary habits={data.data.habits} date={date} />
        </div>
      )}
    </div>
  );
}

function PlaceholderGrid({ loading }: { loading: boolean }) {
  return (
    <div className="flex flex-col gap-3 pb-6">
      {CARD_LABELS.map((label) => (
        <Card key={label} aria-label={`${label} card placeholder`}>
          <CardContent className="space-y-3">
            <div className="text-sm font-medium text-muted-foreground">{label}</div>
            <Skeleton className={loading ? "h-16" : "h-16 opacity-60"} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DayLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-destructive">We couldn&apos;t load your day.</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm text-primary underline"
      >
        Try again
      </button>
    </div>
  );
}

export default function ClientHomePage() {
  return (
    <Suspense fallback={<PlaceholderGrid loading />}>
      <ClientHomePageInner />
    </Suspense>
  );
}
