"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useUnits } from "@/contexts/units-context";
import { useHeightInput } from "@/hooks/use-unit-inputs";
import { computeEnergyPair } from "@/services/client-energy-calc";
import type { ActivityLevel, Client } from "@/types/check-in";

/**
 * Inline profile editing for the Overview's two client cards.
 *
 * This replaced a "Client settings" modal. The fields live in the cards and are
 * edited in place — the platform's standard editing gesture (the Journey blocks
 * swap a row for its form the same way) — so the state has to sit ABOVE both
 * cards rather than inside either. The cards stay presentational: they receive
 * this object and render an input wherever they would have rendered a value.
 *
 * The form is react-hook-form + zodResolver per CONVENTIONS §3; height is not
 * in the schema because it is composite for an imperial viewer and
 * `useHeightInput` owns the conversion plus the untouched-field guard.
 */

export const UNSET = "unset";

const profileFormSchema = z.object({
  gender: z.enum([UNSET, "male", "female", "other"]),
  dateOfBirth: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "Use a valid date" }),
  startDate: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "Use a valid date" }),
  phone: z.string().trim().max(30, "Phone must be less than 30 characters"),
  expectedCheckInDay: z.string(),
  workActivityLevel: z.enum([
    "sedentary",
    "lightly_active",
    "moderately_active",
    "very_active",
    "extremely_active",
  ]),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

function toDefaults(client: Client): ProfileFormValues {
  return {
    gender: client.gender ?? UNSET,
    dateOfBirth: client.dateOfBirth ?? "",
    startDate: client.startDate ?? "",
    phone: client.phone ?? "",
    expectedCheckInDay: client.expectedCheckInDay ?? UNSET,
    // Sedentary is the default everywhere — the column default and the
    // calculator's fallback for NULL both agree, so there is no "not set".
    workActivityLevel: client.workActivityLevel ?? "sedentary",
  };
}

async function sendJson(method: "PATCH" | "PUT", url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error || "Failed to save changes");
  }
}

export type ClientProfileEdit = ReturnType<typeof useClientProfileEdit>;

export function useClientProfileEdit(client: Client, onSaved: () => void) {
  const { toast } = useToast();
  const { preference } = useUnits();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [customTdee, setCustomTdee] = useState("");
  const [isCustomTdee, setIsCustomTdee] = useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: toDefaults(client),
  });

  const height = useHeightInput(preference, client.height);

  // Re-seed whenever editing opens, so a cancelled edit never leaks into the
  // next one and a background revalidation cannot overwrite a live edit.
  const { reset } = form;
  const resetHeight = height.reset;
  useEffect(() => {
    if (isEditing) {
      reset(toDefaults(client));
      resetHeight(client.height);
      setIsCustomTdee(client.tdeeManualOverride === true);
      setCustomTdee(client.tdee != null ? String(Math.round(client.tdee)) : "");
    }
  }, [isEditing, client, reset, resetHeight]);

  // The live preview runs the SAME pure calculator the server writes with, so
  // what the coach is shown while typing cannot disagree with what is stored.
  const watched = form.watch();
  const autoEnergy = computeEnergyPair({
    weightKg: client.currentWeight,
    heightCm: height.commitCm ?? client.height,
    gender: watched.gender === UNSET ? undefined : watched.gender,
    bodyFatPercentage: client.currentBodyFatPercentage,
    dateOfBirth: watched.dateOfBirth === "" ? null : watched.dateOfBirth,
    activityLevel: watched.workActivityLevel,
  });
  const autoEnergyReady = autoEnergy.status === "ready" ? autoEnergy : null;

  const parsedCustomTdee = Number(customTdee);
  const customTdeeBelowBmr =
    isCustomTdee &&
    customTdee.trim() !== "" &&
    Number.isFinite(parsedCustomTdee) &&
    autoEnergyReady != null &&
    parsedCustomTdee < autoEnergyReady.bmr;

  // Surfaced only where it changes the answer: Katch-McArdle uses lean mass and
  // has no age term, so a missing birth date costs nothing on that path.
  const showBirthDateNudge =
    watched.dateOfBirth === "" && autoEnergyReady?.ageSource === "assumed_default";

  const save = form.handleSubmit(async (values) => {
    if (height.hasParseError) {
      toast({
        title: "Save failed",
        description: "Enter a height above 0, or clear the field.",
        variant: "destructive",
      });
      return;
    }
    if (customTdeeBelowBmr) {
      toast({
        title: "Save failed",
        description: `TDEE can't be below BMR (${autoEnergyReady?.bmr} cal/day).`,
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const profile: Record<string, unknown> = {
        phone: values.phone,
        workActivityLevel: values.workActivityLevel,
      };
      if (values.gender !== UNSET) profile.gender = values.gender;
      // `commitCm` is the untouched seed unless the field was edited, so a save
      // that changed only the phone number cannot drift a stored 178 cm through
      // its rounded imperial display (5'10" parses back to 177.8).
      if (height.commitCm != null) profile.height = height.commitCm;
      if (values.startDate !== "") profile.startDate = values.startDate;
      if (values.dateOfBirth !== "") profile.dateOfBirth = values.dateOfBirth;

      // Recomputes BMR/TDEE server-side because it carries energy inputs. The
      // override below is applied after, so a coach setting both in one save
      // ends with their typed number rather than the recompute.
      await sendJson("PATCH", `/api/clients/${client.id}`, profile);

      const storedOverride = client.tdeeManualOverride === true;
      if (isCustomTdee && Number.isFinite(parsedCustomTdee) && parsedCustomTdee > 0) {
        await sendJson("PUT", `/api/clients/${client.id}/metrics`, { tdee: parsedCustomTdee });
      } else if (!isCustomTdee && storedOverride) {
        await sendJson("PUT", `/api/clients/${client.id}/metrics`, { tdeeManualOverride: false });
      }

      const nextDay = values.expectedCheckInDay === UNSET ? null : values.expectedCheckInDay;
      if (nextDay !== (client.expectedCheckInDay ?? null)) {
        // The check-in config schema requires frequency + reminder preferences
        // on every write, so the untouched ones are echoed back verbatim.
        await sendJson("PATCH", `/api/clients/${client.id}/check-in-config`, {
          checkInFrequency: client.checkInFrequency ?? "weekly",
          ...(client.checkInFrequencyDays != null
            ? { checkInFrequencyDays: client.checkInFrequencyDays }
            : {}),
          expectedCheckInDay: nextDay,
          reminderPreferences: client.reminderPreferences ?? {
            enabled: true,
            autoSend: false,
            sendBeforeHours: 24,
          },
        });
      }

      onSaved();
      setIsEditing(false);
      toast({ title: "Client updated" });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  });

  return {
    isEditing,
    isSaving,
    start: () => setIsEditing(true),
    cancel: () => setIsEditing(false),
    save,
    form,
    height,
    autoEnergy: autoEnergyReady,
    customTdee,
    setCustomTdee,
    isCustomTdee,
    setIsCustomTdee,
    customTdeeBelowBmr,
    showBirthDateNudge,
  };
}
