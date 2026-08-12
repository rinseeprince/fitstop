"use client";

import { Check, Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  FOCUS_RING,
  MONO_INPUT_CLASS,
  STAT_VALUE_DARK_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { ClientProfileEdit } from "./use-client-profile-edit";

/**
 * The inline-edit primitives shared by the Overview's two client cards.
 *
 * Editing happens in place rather than in a modal — the same gesture as a
 * Journey block, and the platform's standard. These keep the two cards' inputs
 * identical without either card importing the other.
 */

const TRIGGER_CLASS =
  "bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all hover:border-[rgba(13,148,136,0.25)] [&>svg]:text-[#93b0b4] [&>svg]:hover:text-[#0d9488] [&>svg]:transition-colors";

export const ITEM_CLASS =
  "rounded-[6px] cursor-pointer text-[13px] text-[#0c1a1e] focus:bg-[rgba(13,148,136,0.05)]";

/** Rail actions: pencil when idle, save + cancel while editing. */
export function EditRailActions({ edit }: { edit: ClientProfileEdit }) {
  if (!edit.isEditing) {
    return (
      <button
        type="button"
        onClick={edit.start}
        aria-label="Edit client details"
        title="Edit client details"
        className="shrink-0 rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={edit.cancel}
        disabled={edit.isSaving}
        aria-label="Cancel editing"
        title="Cancel"
        className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0c1a1e] disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        onClick={() => void edit.save()}
        disabled={edit.isSaving}
        aria-label="Save client details"
        title="Save"
        className="rounded p-1 text-[#0d9488] transition-colors hover:text-[#0b7f75] disabled:opacity-50"
      >
        {edit.isSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
        ) : (
          <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}

export function InlineTextInput({
  value,
  onChange,
  type = "text",
  placeholder,
  isNumeric,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  type?: "text" | "date" | "tel" | "number";
  placeholder?: string;
  isNumeric?: boolean;
  ariaLabel: string;
}) {
  return (
    <Input
      type={type}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(FOCUS_RING, isNumeric && MONO_INPUT_CLASS, "h-8 text-[13px]")}
    />
  );
}

export function InlineSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className={cn(TRIGGER_CLASS, "h-8")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-1 shadow-lg">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className={ITEM_CLASS}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Dark-card variant — the Client status card sits on #0f2027. */
export function InlineDarkInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        STAT_VALUE_DARK_CLASS,
        FOCUS_RING,
        "h-9 w-full rounded-[6px] border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.06)] px-2 text-[20px] leading-tight text-white outline-none transition-colors focus:border-[rgba(13,148,136,0.6)]"
      )}
    />
  );
}

export function InlineDarkSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          FOCUS_RING,
          "h-8 rounded-[6px] border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.06)] text-[13px] font-medium text-white [&>svg]:text-[rgba(255,255,255,0.5)]"
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-1 shadow-lg">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className={ITEM_CLASS}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const ACTIVITY_OPTIONS = [
  { value: "sedentary", label: "Sedentary (desk job)" },
  { value: "lightly_active", label: "Lightly active" },
  { value: "moderately_active", label: "Moderately active" },
  { value: "very_active", label: "Very active" },
  { value: "extremely_active", label: "Extremely active" },
];
