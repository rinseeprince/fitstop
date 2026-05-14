"use client";

import { useMemo } from "react";
import { Controller, useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import useSWR, { type SWRResponse } from "swr";

import { useToast } from "@/hooks/use-toast";
import { swrFetcher } from "@/lib/swr-fetcher";
import {
  updateSettingsSchema,
  type UpdateSettingsInput,
} from "@/lib/validations/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { TimezoneCombobox } from "@/components/client-portal/settings/timezone-combobox";
import type { Client } from "@/types/check-in";

type MeResponse = { success: boolean; data: Client };

export default function SettingsPage() {
  const { data, error, isLoading, mutate } = useSWR<MeResponse>(
    "/api/client/me",
    swrFetcher,
    { revalidateOnFocus: false, errorRetryCount: 3, errorRetryInterval: 1000 },
  );

  if (isLoading) return <SettingsSkeleton />;
  if (error || !data?.data) return <SettingsError onRetry={() => mutate()} />;

  return <SettingsForm client={data.data} mutate={mutate} />;
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4 py-4" aria-label="Loading settings">
      <Skeleton className="h-8 w-32" />
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SettingsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-destructive">We couldn&apos;t load your settings.</p>
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

function SettingsForm({
  client,
  mutate,
}: {
  client: Client;
  mutate: SWRResponse<MeResponse>["mutate"];
}) {
  const { toast } = useToast();

  const detectedTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);

  const form = useForm<UpdateSettingsInput>({
    resolver: zodResolver(updateSettingsSchema),
    defaultValues: {
      unitPreference: client.unitPreference ?? "imperial",
      timezone: client.timezone,
    },
  });

  const currentTimezone = form.watch("timezone") ?? "UTC";
  const showDetectedHint =
    currentTimezone === "UTC" &&
    detectedTimezone !== undefined &&
    detectedTimezone !== "UTC";

  const onSubmit = async (values: UpdateSettingsInput) => {
    const dirty = form.formState.dirtyFields;
    const body: Partial<UpdateSettingsInput> = {};
    if (dirty.unitPreference) body.unitPreference = values.unitPreference;
    if (dirty.timezone) body.timezone = values.timezone;

    let res: Response;
    try {
      res = await fetch("/api/client/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      toast({
        title: "Couldn't save settings",
        description: "Network error. Please try again.",
        variant: "destructive",
      });
      return;
    }

    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: Client; error?: string }
      | null;

    if (!res.ok || !json?.success || !json.data) {
      toast({
        title: "Couldn't save settings",
        description: json?.error ?? "Please try again.",
        variant: "destructive",
      });
      return;
    }

    // Authoritative response — skip the SWR refetch to avoid a second reset.
    await mutate({ success: true, data: json.data }, { revalidate: false });
    form.reset(values);
    toast({ title: "Settings saved" });
  };

  // Surfaces validation errors that would otherwise be swallowed by handleSubmit.
  // Without this, a Zod failure on submit results in no toast, no fetch, no fix path.
  const onInvalid = (errors: FieldErrors<UpdateSettingsInput>) => {
    console.error("Settings form validation failed:", errors);
    toast({
      title: "Couldn't save settings",
      description: "Please check the form values and try again.",
      variant: "destructive",
    });
  };

  return (
    <div className="flex flex-col gap-4 py-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <form
        onSubmit={form.handleSubmit(onSubmit, onInvalid)}
        className="flex flex-col gap-4"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{client.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{client.email}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Units</CardTitle>
          </CardHeader>
          <CardContent>
            <Controller
              control={form.control}
              name="unitPreference"
              render={({ field }) => (
                <RadioGroup value={field.value} onValueChange={field.onChange}>
                  <Label
                    htmlFor="unit-imperial"
                    className="flex items-center gap-3 cursor-pointer font-normal"
                  >
                    <RadioGroupItem value="imperial" id="unit-imperial" />
                    <span>Imperial (lbs, in)</span>
                  </Label>
                  <Label
                    htmlFor="unit-metric"
                    className="flex items-center gap-3 cursor-pointer font-normal"
                  >
                    <RadioGroupItem value="metric" id="unit-metric" />
                    <span>Metric (kg, cm)</span>
                  </Label>
                </RadioGroup>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timezone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Controller
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <TimezoneCombobox
                  value={field.value ?? "UTC"}
                  onChange={(tz) => field.onChange(tz)}
                />
              )}
            />
            {showDetectedHint && (
              <button
                type="button"
                onClick={() =>
                  form.setValue("timezone", detectedTimezone, {
                    shouldDirty: true,
                  })
                }
                className="text-xs text-primary underline"
              >
                Use detected: {detectedTimezone}
              </button>
            )}
          </CardContent>
        </Card>

        <Button
          type="submit"
          disabled={!form.formState.isDirty || form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Saving..." : "Save"}
        </Button>
      </form>
    </div>
  );
}
