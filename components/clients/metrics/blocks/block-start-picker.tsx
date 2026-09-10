"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BlockStartOption } from "@/lib/blocks/block-start-options";

/**
 * The Block field a setup surface mounts above its start date — the
 * apply-to-client dialog and the nutrition drawer's settings form, one
 * component so the two cannot list blocks differently. Controlled: the host
 * owns the pick and derives the date field's `min` / `max` from the selected
 * option's window (`buildBlockStartOptions`), so choosing a block here sets the
 * start and bounds the picker under it in the same render.
 *
 * Renders the `Select` alone; each host renders the label in its own form's
 * grammar and passes its sibling controls' classes so the field reads like the
 * ones around it. The option labels carry dates but are control options, not
 * data strings, so they stay sans (design system → Typography tie-break).
 */
type BlockStartPickerProps = {
  /** The trigger's id, for the host's `<label htmlFor>`. */
  id: string;
  options: readonly BlockStartOption[];
  value: string;
  onValueChange: (value: string) => void;
  triggerClassName?: string;
  itemClassName?: string;
};

export function BlockStartPicker({
  id,
  options,
  value,
  onValueChange,
  triggerClassName,
  itemClassName,
}: BlockStartPickerProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className={itemClassName}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
