"use client";

import { MacroBalance } from "@/components/clients/nutrition/macro-balance";
import type { useEditTargetsForm } from "./use-edit-targets-form";

type SetTargetsTabProps = {
  form: ReturnType<typeof useEditTargetsForm>;
};

/** Absolute tab: the macro balancer, opened on the first selected day's
 * numbers. Every selected day gets the same calories and split. */
export function NutritionSetTargetsTab({ form }: SetTargetsTabProps) {
  const { seed } = form;

  return (
    <div className="space-y-3">
      {seed.calorieRange && (
        <div className="rounded-[6px] bg-[#f0f5f4] px-3 py-2 text-xs text-[#5a7d82]">
          Selected days currently range{" "}
          <span className="font-semibold">
            {seed.calorieRange.min.toLocaleString()} – {seed.calorieRange.max.toLocaleString()} kcal
          </span>
          .
        </div>
      )}

      <MacroBalance value={form.balance} onChange={form.setBalance} />
    </div>
  );
}
