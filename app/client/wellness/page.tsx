"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { Loader2 } from "lucide-react";

import { LockedDayNotice } from "@/components/client-portal/day/locked-day-notice";
import { MoodPicker } from "@/components/client-portal/wellness/mood-picker";
import { WellnessScale } from "@/components/client-portal/wellness/wellness-scale";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientProfile } from "@/hooks/use-client-profile";
import { useToast } from "@/hooks/use-toast";
import { canEditDay } from "@/lib/daily-log-permissions";
import { getTodayDateString, parseDateParamOrToday } from "@/lib/date-helpers";
import { swrFetcher } from "@/lib/swr-fetcher";

type WellnessForDate = {
  mood: number | null;
  energy: number | null;
  sleep: number | null;
  stress: number | null;
  editable: boolean;
  loggedStatus: "logged" | "never-logged";
};

type WellnessResponse = { success: boolean; data: WellnessForDate };

type WellnessInputs = {
  mood: number | null;
  energy: number | null;
  sleep: number | null;
  stress: number | null;
};

// null = untouched (omitted from the PATCH); a number = the client set it.
const EMPTY_INPUTS: WellnessInputs = { mood: null, energy: null, sleep: null, stress: null };

// Bounds mirror lib/validations/daily-log-cards.ts (wellnessCardSchema). The server remains
// the source of truth; clamping here just keeps inputs from tripping a 400.
const BOUNDS = {
  mood: { min: 1, max: 5 },
  energy: { min: 1, max: 10 },
  sleep: { min: 1, max: 10 },
  stress: { min: 1, max: 10 },
} as const;

/** Clamp a set value to [min, max] as an integer; undefined when unset so JSON.stringify drops it. */
function toBoundedInt(v: number | null, min: number, max: number): number | undefined {
  if (v === null) return undefined;
  return Math.min(Math.max(Math.round(v), min), max);
}

function formatHeading(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function WellnessLogInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const date = parseDateParamOrToday(searchParams?.get("date") ?? null);

  const { toast } = useToast();
  const { client } = useClientProfile();
  const timezone = client?.timezone ?? "UTC";

  const { data, error, isLoading, mutate } = useSWR<WellnessResponse>(
    `/api/client/daily-logs/${date}/wellness`,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      dedupingInterval: 2000,
      onError: (err) => console.error("[wellness-log] fetch failed:", err),
    },
  );

  const wellness = data?.data;
  // loggedStatus is server-authoritative (child-row existence); canEditDay then renders the lock
  // in the client's timezone. `wellness.editable` is the server's parallel answer (enforced on
  // write by assertCanEdit) — we intentionally drive the UI off canEditDay per the redesign.
  const loggedStatus = wellness?.loggedStatus ?? "never-logged";
  const isLocked = !canEditDay(date, loggedStatus, timezone);

  const [inputs, setInputs] = useState<WellnessInputs>(EMPTY_INPUTS);
  const [saving, setSaving] = useState(false);

  // Seed the form once per date when data first arrives; a background revalidation must not
  // clobber in-progress edits. On a 403 we reset the ref so the fresh server snapshot re-seeds
  // (and a backfilled past day flips to locked).
  const seededDate = useRef<string | null>(null);
  useEffect(() => {
    if (!wellness || seededDate.current === date) return;
    seededDate.current = date;
    setInputs({
      mood: wellness.mood,
      energy: wellness.energy,
      sleep: wellness.sleep,
      stress: wellness.stress,
    });
  }, [wellness, date]);

  const hasAnyValue = (["mood", "energy", "sleep", "stress"] as const).some(
    (k) => inputs[k] !== null,
  );

  const setField = (key: keyof WellnessInputs) => (value: number) =>
    setInputs((prev) => ({ ...prev, [key]: value }));

  async function handleSave() {
    setSaving(true);
    try {
      const body = {
        mood: toBoundedInt(inputs.mood, BOUNDS.mood.min, BOUNDS.mood.max),
        energy: toBoundedInt(inputs.energy, BOUNDS.energy.min, BOUNDS.energy.max),
        sleep: toBoundedInt(inputs.sleep, BOUNDS.sleep.min, BOUNDS.sleep.max),
        stress: toBoundedInt(inputs.stress, BOUNDS.stress.min, BOUNDS.stress.max),
      };

      const res = await fetch(`/api/client/daily-logs/${date}/wellness`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body), // JSON.stringify drops undefined fields (partial update)
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;

      if (!res.ok || !json?.success) {
        toast({
          title: "Couldn't save wellness",
          description: json?.error ?? "Please try again.",
          variant: "destructive",
        });
        if (res.status === 403) {
          // The day locked underneath us — refresh to reflect the true state.
          seededDate.current = null;
          void mutate();
        }
        return;
      }

      toast({ title: "Wellness saved" });
      // Refresh the home day-summary so its wellness card reflects the new log, then return home.
      void globalMutate(`/api/client/day-summary?date=${date}`);
      router.push(date === getTodayDateString() ? "/client" : `/client?date=${date}`);
    } catch (err) {
      console.error("[wellness-log] save failed:", err);
      toast({
        title: "Couldn't save wellness",
        description: "Network error. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-destructive">We couldn&apos;t load your wellness.</p>
        <button
          type="button"
          onClick={() => mutate()}
          className="text-sm text-primary underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (isLoading || !wellness) {
    return <WellnessLogSkeleton />;
  }

  return (
    <div>
      <h1 className="text-base font-semibold text-foreground">Log wellness</h1>
      <p className="mt-1 text-sm text-muted-foreground">{formatHeading(date)}</p>

      {isLocked ? <LockedDayNotice reason="past-logged" /> : null}

      <Card className="mt-4">
        <CardContent className="space-y-6 py-6">
          <MoodPicker
            value={inputs.mood}
            disabled={isLocked || saving}
            onChange={setField("mood")}
          />
          <WellnessScale
            id="energy"
            label="Energy level"
            value={inputs.energy ?? 5}
            disabled={isLocked || saving}
            onChange={setField("energy")}
          />
          <WellnessScale
            id="sleep"
            label="Sleep quality"
            value={inputs.sleep ?? 5}
            disabled={isLocked || saving}
            onChange={setField("sleep")}
          />
          <WellnessScale
            id="stress"
            label="Stress level"
            value={inputs.stress ?? 5}
            disabled={isLocked || saving}
            onChange={setField("stress")}
          />
        </CardContent>
      </Card>

      {!isLocked ? (
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving || !hasAnyValue}
          className="mt-4 w-full"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      ) : null}
    </div>
  );
}

function WellnessLogSkeleton() {
  return (
    <>
      <Skeleton className="h-7 w-48" />
      <Card className="mt-4">
        <CardContent className="space-y-6 py-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    </>
  );
}

export default function ClientWellnessLogPage() {
  return (
    <Suspense fallback={<WellnessLogSkeleton />}>
      <WellnessLogInner />
    </Suspense>
  );
}
