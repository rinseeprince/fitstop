"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FOCUS_RING, MONO_INPUT_CLASS } from "@/components/clients/training/program-builder/builder-tokens";
import { DAY_NAMES } from "@/lib/date-helpers";
import type { Client, DayOfWeek } from "@/types/check-in";

// Select recipes match the Metrics "Log measurement" dialog so every
// Teal-Summit dialog field reads the same.
const TRIGGER_CLASS =
  "bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all hover:border-[rgba(13,148,136,0.25)] [&>svg]:text-[#93b0b4] [&>svg]:hover:text-[#0d9488] [&>svg]:transition-colors";

const ITEM_CLASS =
  "rounded-[6px] cursor-pointer text-[13px] text-[#0c1a1e] focus:bg-[rgba(13,148,136,0.05)]";

const UNSET = "unset";

// Monday-first, off the shared weekday map so the names cannot drift.
const DAY_OPTIONS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0].map((n) => DAY_NAMES[n]);

/**
 * Coercing mirror of the profile slice of `updateClientSchema` — the API schema
 * takes a number for height, but an <input> hands back a string, so the form
 * needs its own coercion layer. Bounds stay in step with the API's.
 */
const settingsFormSchema = z.object({
  gender: z.enum([UNSET, "male", "female", "other"]),
  height: z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) > 0), {
      message: "Enter a height above 0",
    }),
  heightUnit: z.enum(["in", "cm"]),
  startDate: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "Use a valid date" }),
  phone: z.string().trim().max(30, "Phone must be less than 30 characters"),
  expectedCheckInDay: z.string(),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

type ClientSettingsDialogProps = {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Revalidates the client record and the brief (check-in day drives timing). */
  onSaved: () => void;
};

function toDefaults(client: Client): SettingsFormValues {
  return {
    gender: client.gender ?? UNSET,
    height: client.height != null ? String(client.height) : "",
    heightUnit: client.heightUnit ?? "in",
    startDate: client.startDate ?? "",
    phone: client.phone ?? "",
    expectedCheckInDay: client.expectedCheckInDay ?? UNSET,
  };
}

async function patchJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error || "Failed to save changes");
  }
}

export function ClientSettingsDialog({
  client,
  open,
  onOpenChange,
  onSaved,
}: ClientSettingsDialogProps) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: toDefaults(client),
  });

  // Always-mounted dialog: re-seed from the live client record on each open so
  // a cancelled edit never persists into the next one.
  const { reset } = form;
  useEffect(() => {
    if (open) reset(toDefaults(client));
  }, [open, client, reset]);

  const onSubmit = async (values: SettingsFormValues) => {
    setIsSaving(true);
    try {
      const profile: Record<string, unknown> = { phone: values.phone };
      if (values.gender !== UNSET) profile.gender = values.gender;
      if (values.height !== "") {
        profile.height = Number(values.height);
        profile.heightUnit = values.heightUnit;
      }
      if (values.startDate !== "") profile.startDate = values.startDate;

      await patchJson(`/api/clients/${client.id}`, profile);

      // The check-in config schema requires frequency + reminder preferences on
      // every write, so the untouched ones are echoed back verbatim.
      const nextDay = values.expectedCheckInDay === UNSET ? null : values.expectedCheckInDay;
      if (nextDay !== (client.expectedCheckInDay ?? null)) {
        await patchJson(`/api/clients/${client.id}/check-in-config`, {
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
      onOpenChange(false);
      toast({ title: "Client settings saved" });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Client settings</DialogTitle>
          <DialogDescription>
            Profile details and the day this client is expected to check in.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="settings-gender">Gender</Label>
              <Select
                value={form.watch("gender")}
                onValueChange={(v) => form.setValue("gender", v as SettingsFormValues["gender"])}
              >
                <SelectTrigger id="settings-gender" className={TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-1 shadow-lg">
                  <SelectItem value={UNSET} className={ITEM_CLASS}>
                    Not set
                  </SelectItem>
                  <SelectItem value="male" className={ITEM_CLASS}>
                    Male
                  </SelectItem>
                  <SelectItem value="female" className={ITEM_CLASS}>
                    Female
                  </SelectItem>
                  <SelectItem value="other" className={ITEM_CLASS}>
                    Other
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-height">Height</Label>
              <div className="flex gap-2">
                <Input
                  id="settings-height"
                  inputMode="decimal"
                  placeholder="Not set"
                  {...form.register("height")}
                  className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 flex-1 text-[13px]")}
                />
                <Select
                  value={form.watch("heightUnit")}
                  onValueChange={(v) =>
                    form.setValue("heightUnit", v as SettingsFormValues["heightUnit"])
                  }
                >
                  <SelectTrigger
                    aria-label="Height unit"
                    className={cn(TRIGGER_CLASS, "h-8 w-[80px]")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-1 shadow-lg">
                    <SelectItem value="in" className={ITEM_CLASS}>
                      in
                    </SelectItem>
                    <SelectItem value="cm" className={ITEM_CLASS}>
                      cm
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.formState.errors.height && (
                <p className="text-[11px] text-[#c06060]">
                  {form.formState.errors.height.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-start-date">Started</Label>
              <Input
                id="settings-start-date"
                type="date"
                {...form.register("startDate")}
                className={cn(FOCUS_RING, "h-8 text-[13px]")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-phone">Phone</Label>
              <Input
                id="settings-phone"
                type="tel"
                placeholder="Not set"
                {...form.register("phone")}
                className={cn(FOCUS_RING, "h-8 text-[13px]")}
              />
              {form.formState.errors.phone && (
                <p className="text-[11px] text-[#c06060]">{form.formState.errors.phone.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-check-in-day">Check-in day</Label>
              <Select
                value={form.watch("expectedCheckInDay")}
                onValueChange={(v) => form.setValue("expectedCheckInDay", v)}
              >
                <SelectTrigger id="settings-check-in-day" className={TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-1 shadow-lg">
                  <SelectItem value={UNSET} className={ITEM_CLASS}>
                    Any day
                  </SelectItem>
                  {DAY_OPTIONS.map((day) => (
                    <SelectItem key={day} value={day} className={cn(ITEM_CLASS, "capitalize")}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
              disabled={isSaving}
            >
              {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
