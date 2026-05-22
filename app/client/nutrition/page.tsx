"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ArrowLeft,
  Beef,
  Droplets,
  Flame,
  Loader2,
  Wheat,
  type LucideIcon,
} from "lucide-react";

import { NutrientRow } from "@/components/client-portal/nutrition/nutrient-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientProfile } from "@/hooks/use-client-profile";
import { useToast } from "@/hooks/use-toast";
import { canEditDay } from "@/lib/daily-log-permissions";
import { parseDateParamOrToday } from "@/lib/date-helpers";
import { swrFetcher } from "@/lib/swr-fetcher";

type NutrientValues = {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

type NutritionForDate = {
  consumed: NutrientValues | null;
  target: NutrientValues | null;
  source: "log" | "event" | null;
  editable: boolean;
};

type NutritionResponse = { success: boolean; data: NutritionForDate };

type InputState = {
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
};

const EMPTY_INPUTS: InputState = {
  calories: "",
  proteinG: "",
  carbsG: "",
  fatG: "",
};

// Bounds mirror lib/validations/daily-log-cards.ts (nutritionCardSchema). The server
// remains the source of truth; clamping here just keeps inputs from tripping a 400.
const BOUNDS = {
  calories: { min: 1, max: 10000 },
  proteinG: { min: 0, max: 1000 },
  carbsG: { min: 0, max: 2000 },
  fatG: { min: 0, max: 500 },
} as const;

const FIELDS: ReadonlyArray<{
  key: keyof InputState;
  id: string;
  label: string;
  icon: LucideIcon;
  iconColorClass: string;
  barColorClass: string;
  unit: string;
  min: number;
  max: number;
}> = [
  { key: "calories", id: "calories", label: "Calories", icon: Flame, iconColorClass: "text-primary", barColorClass: "bg-primary", unit: "kcal", ...BOUNDS.calories },
  { key: "proteinG", id: "protein", label: "Protein", icon: Beef, iconColorClass: "text-protein", barColorClass: "bg-protein", unit: "g", ...BOUNDS.proteinG },
  { key: "carbsG", id: "carbs", label: "Carbs", icon: Wheat, iconColorClass: "text-carbs", barColorClass: "bg-carbs", unit: "g", ...BOUNDS.carbsG },
  { key: "fatG", id: "fat", label: "Fat", icon: Droplets, iconColorClass: "text-fat", barColorClass: "bg-fat", unit: "g", ...BOUNDS.fatG },
];

/** Coerce a raw input string to an integer within [min, max]; undefined when blank/invalid. */
function toBoundedInt(raw: string, min: number, max: number): number | undefined {
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(n, min), max);
}

function toInputValue(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

function formatHeading(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function NutritionLogInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const date = parseDateParamOrToday(searchParams?.get("date") ?? null);

  const { toast } = useToast();
  const { client } = useClientProfile();
  const timezone = client?.timezone ?? "UTC";

  const { data, error, isLoading, mutate } = useSWR<NutritionResponse>(
    `/api/client/daily-logs/${date}/nutrition`,
    swrFetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      dedupingInterval: 2000,
      onError: (err) => console.error("[nutrition-log] fetch failed:", err),
    },
  );

  const nutrition = data?.data;
  const target = nutrition?.target ?? null;
  const loggedStatus = nutrition?.source === "log" ? "logged" : "never-logged";
  const isLocked = !canEditDay(date, loggedStatus, timezone);

  const [inputs, setInputs] = useState<InputState>(EMPTY_INPUTS);
  const [saving, setSaving] = useState(false);

  // Seed the form once per date when data first arrives; a background revalidation
  // must not clobber in-progress edits. After a save we reset the ref so the fresh
  // server snapshot re-seeds (and a backfilled past day flips to locked).
  const seededDate = useRef<string | null>(null);
  useEffect(() => {
    if (!nutrition || seededDate.current === date) return;
    seededDate.current = date;
    setInputs({
      calories: toInputValue(nutrition.consumed?.calories),
      proteinG: toInputValue(nutrition.consumed?.proteinG),
      carbsG: toInputValue(nutrition.consumed?.carbsG),
      fatG: toInputValue(nutrition.consumed?.fatG),
    });
  }, [nutrition, date]);

  const hasAnyValue = Object.values(inputs).some((v) => v.trim() !== "");

  const setField = (key: keyof InputState) => (value: string) =>
    setInputs((prev) => ({ ...prev, [key]: value }));

  async function handleSave() {
    setSaving(true);
    try {
      // GET reads consumed.calories; the PATCH schema names the field caloriesConsumed.
      const body = {
        caloriesConsumed: toBoundedInt(inputs.calories, BOUNDS.calories.min, BOUNDS.calories.max),
        proteinG: toBoundedInt(inputs.proteinG, BOUNDS.proteinG.min, BOUNDS.proteinG.max),
        carbsG: toBoundedInt(inputs.carbsG, BOUNDS.carbsG.min, BOUNDS.carbsG.max),
        fatG: toBoundedInt(inputs.fatG, BOUNDS.fatG.min, BOUNDS.fatG.max),
      };

      const res = await fetch(`/api/client/daily-logs/${date}/nutrition`, {
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
          title: "Couldn't save nutrition",
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

      toast({ title: "Nutrition saved" });
      seededDate.current = null;
      void mutate();
    } catch (err) {
      console.error("[nutrition-log] save failed:", err);
      toast({
        title: "Couldn't save nutrition",
        description: "Network error. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const backLink = (
    <button
      type="button"
      onClick={() => router.push(`/client?date=${date}`)}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
      Back
    </button>
  );

  if (error) {
    return (
      <div>
        <div className="mb-3">{backLink}</div>
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-destructive">We couldn&apos;t load your nutrition.</p>
          <button
            type="button"
            onClick={() => mutate()}
            className="text-sm text-primary underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !nutrition) {
    return (
      <div>
        <div className="mb-3">{backLink}</div>
        <NutritionLogSkeleton />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3">{backLink}</div>
      <h1 className="text-base font-semibold text-foreground">Log nutrition</h1>
      <p className="mt-1 text-sm text-muted-foreground">{formatHeading(date)}</p>

      {isLocked ? (
        <div
          role="status"
          className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          This day&apos;s log is locked and can&apos;t be edited.
        </div>
      ) : null}

      <Card className="mt-4">
        <CardContent className="space-y-6 py-6">
          {FIELDS.map((f) => (
            <NutrientRow
              key={f.key}
              id={f.id}
              label={f.label}
              icon={f.icon}
              iconColorClass={f.iconColorClass}
              barColorClass={f.barColorClass}
              value={inputs[f.key]}
              target={target?.[f.key] ?? null}
              unit={f.unit}
              min={f.min}
              max={f.max}
              disabled={isLocked || saving}
              onChange={setField(f.key)}
            />
          ))}
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

function NutritionLogSkeleton() {
  return (
    <>
      <Skeleton className="h-7 w-48" />
      <Card className="mt-4">
        <CardContent className="space-y-6 py-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    </>
  );
}

export default function ClientNutritionLogPage() {
  return (
    <Suspense fallback={<NutritionLogSkeleton />}>
      <NutritionLogInner />
    </Suspense>
  );
}
