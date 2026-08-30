"use client";

import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { cn } from "@/lib/utils";
import {
  CHECK_IN_FORM_FIELDS,
  CHECK_IN_FORM_STEPS,
  CHECK_IN_STEP_LABELS,
  type CheckInFormFieldKey,
} from "@/lib/check-in/form-fields";
import { LABEL_CLASS } from "@/components/clients/training/program-builder/builder-tokens";

/**
 * The fourteen built-in fields, one On/Off row each (D4.4, D4.7 per column).
 *
 * The control is `<SegmentedControl>` because the design system has exactly one
 * two-way toggle and this is it — `components/ui/switch.tsx` is un-migrated
 * OKLCH and pill-shaped, which "no pill shapes" forbids outright.
 *
 * Grouped by the wizard STEP each field sits on, using the kernel's own step
 * order and labels, so the coach is toggling rows under the same words their
 * client sees at the top of the wizard.
 */

const ON_OFF = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

export function CheckInFormFieldsCard({
  fields,
  onToggle,
  clientName,
}: {
  fields: readonly CheckInFormFieldKey[];
  onToggle: (key: CheckInFormFieldKey) => void;
  clientName: string;
}) {
  const enabled = new Set<string>(fields);

  return (
    <div className="mb-5 rounded-[6px] bg-white px-[18px] py-4">
      {CHECK_IN_FORM_STEPS.map((step, stepIndex) => (
        <div
          key={step}
          className={cn(
            stepIndex > 0 && "mt-3.5 border-t border-[rgba(13,148,136,0.06)] pt-3.5"
          )}
        >
          <p className={LABEL_CLASS}>{CHECK_IN_STEP_LABELS[step]}</p>
          <div className="mt-1.5 flex flex-col">
            {CHECK_IN_FORM_FIELDS.filter((field) => field.step === step).map((field) => (
              <div
                key={field.key}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="min-w-0 truncate text-[13px] text-[#0c1a1e]">
                  {field.label}
                </span>
                {/* The segmented control's two buttons carry no name of their
                    own; the group gives the pair one without reaching into the
                    shared primitive. */}
                <div role="group" aria-label={field.label} className="shrink-0">
                  <SegmentedControl
                    options={ON_OFF}
                    value={enabled.has(field.key) ? "on" : "off"}
                    onChange={() => onToggle(field.key)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {enabled.size === 0 && (
        <p className="mt-3.5 border-t border-[rgba(13,148,136,0.06)] pt-3.5 text-[11px] text-[#93b0b4]">
          With everything off, {clientName} still gets a two-step check-in
          confirming their week — there is just nothing to type.
        </p>
      )}
    </div>
  );
}
