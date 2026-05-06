"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  useWatch,
  type Control,
  type UseFormGetValues,
  type UseFormRegister,
  type UseFormSetValue,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LogFormValues } from "./log-form-types";

type QuickLogControlsProps = {
  control: Control<LogFormValues>;
  register: UseFormRegister<LogFormValues>;
  setValue: UseFormSetValue<LogFormValues>;
  getValues: UseFormGetValues<LogFormValues>;
  isSubmitting: boolean;
};

const STATUS_OPTIONS: Array<{
  value: "full" | "partial" | "skipped";
  label: string;
}> = [
  { value: "full", label: "Mark complete" },
  { value: "partial", label: "Mark partial" },
  { value: "skipped", label: "Mark skipped" },
];

export function QuickLogControls({
  control,
  register,
  setValue,
  getValues,
  isSubmitting,
}: QuickLogControlsProps) {
  const completionQuality = useWatch({ control, name: "completionQuality" });
  const canSave = completionQuality !== "" && !isSubmitting;
  const initialNotes = getValues("notes") ?? "";
  const [notesOpen, setNotesOpen] = useState(initialNotes.trim().length > 0);

  return (
    <section className="space-y-3 rounded-[6px] bg-white p-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {STATUS_OPTIONS.map((opt) => {
          const active = completionQuality === opt.value;
          return (
            <Button
              key={opt.value}
              type="button"
              variant={active ? "default" : "outline"}
              size="lg"
              data-testid={`quick-log-${opt.value}`}
              aria-pressed={active}
              onClick={() =>
                setValue("completionQuality", opt.value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              className="w-full"
            >
              {opt.label}
            </Button>
          );
        })}
      </div>
      {notesOpen ? (
        <Textarea
          {...register("notes")}
          placeholder="Notes for this session (optional)"
          rows={3}
          aria-label="Session notes"
          data-testid="session-notes"
          className="text-[13px]"
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setNotesOpen(true)}
          data-testid="session-notes-toggle"
          className="h-auto justify-start px-0 text-[12px] font-medium text-[#5a7d82] hover:bg-transparent hover:text-[#0d9488]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add notes
        </Button>
      )}
      <Button
        type="submit"
        size="lg"
        disabled={!canSave}
        data-testid="save-button"
        className="w-full"
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Save workout
      </Button>
    </section>
  );
}
