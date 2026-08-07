"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { useToast } from "@/hooks/use-toast";
import { useInvalidateUnitPreference, useUnits } from "@/contexts/units-context";
import type { UnitSystem } from "@/utils/unit-conversions";

/**
 * The coach's own display units.
 *
 * Storage is canonical kg/cm — this only decides what THIS coach is shown. A
 * metric coach and an imperial client work on the same rows and each see their
 * own unit, so nothing here reaches a client's data
 * (CONVENTIONS.md §20 Units). It replaces the nutrition
 * drawer's toggle, which wrote the CLIENT's preference from the coach's screen.
 */

const UNIT_OPTIONS = [
  { value: "metric", label: "Metric (kg, cm)" },
  { value: "imperial", label: "Imperial (lbs, in)" },
] as const;

export function SettingsUnitsCard() {
  const { toast } = useToast();
  const { preference, isLoading, error } = useUnits();
  const invalidateUnitPreference = useInvalidateUnitPreference();

  // Seeded from the resolved preference, then owned locally so the segmented
  // control responds immediately. `preference ?? metric` is a fallback while
  // loading, not a choice, so the control is disabled until it settles.
  const [selected, setSelected] = useState<UnitSystem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const value = selected ?? preference;
  const isDirty = selected !== null && selected !== preference;
  const isBlocked = isLoading || Boolean(error);

  const handleSave = async () => {
    if (!isDirty) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/coach/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitPreference: selected }),
      });
      const payload = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;

      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error ?? "Please try again.");
      }

      // BOTH caches carry the coach's preference: /api/me/unit-preference and
      // /api/auth/me (inside coach.unitPreference). Clearing one leaves
      // useAuth().coach stale with nothing erroring.
      await invalidateUnitPreference();
      setSelected(null);
      toast({ title: "Units saved" });
    } catch (err) {
      toast({
        title: "Couldn't save units",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="bg-white border-0 shadow-none rounded-[6px]">
      <CardHeader className="px-5 py-4 border-b border-[rgba(13,148,136,0.08)] flex items-center justify-between min-h-[64px]">
        <h3 className="text-[15px] font-semibold tracking-tight text-[#0c1a1e]">
          Units
        </h3>
        <span className={LABEL_CLASS}>How weights and measurements display</span>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        {/* Disabled until the preference settles: `useUnits()` falls back to
            metric while loading or on error, and a fallback presented as the
            active segment invites the coach to "confirm" a unit they never
            chose. */}
        <SegmentedControl
          options={UNIT_OPTIONS.map((option) => ({
            ...option,
            disabled: isBlocked || isSaving,
            title: isBlocked ? "Loading your current units…" : undefined,
          }))}
          value={value}
          onChange={(next) => setSelected(next as UnitSystem)}
        />
        <p className="text-[12px] text-[#5a7d82] leading-[1.5]">
          Only changes what you see. Each client sets their own units, and their
          data is stored the same way either way.
        </p>
        {error ? (
          <p className="text-[12px] text-[#c06060]">
            We couldn&apos;t load your current units. Reload the page to try
            again.
          </p>
        ) : null}
        <Button
          onClick={handleSave}
          disabled={!isDirty || isSaving || isBlocked}
          className="bg-[#0d9488] hover:bg-[#0b7f75] text-white rounded-[6px]"
        >
          {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save Changes
        </Button>
      </CardContent>
    </Card>
  );
}
