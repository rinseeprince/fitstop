"use client";

import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import type { JourneySubtab } from "./metrics-view-types";

export type MetricsTopBarProps = {
  tab: JourneySubtab;
  onTabChange: (t: JourneySubtab) => void;
  onLogClick: () => void;
};

// The Journey tab's pane bar: the Training tab's TopContentBar silhouette.
export function MetricsTopBar({
  tab,
  onTabChange,
  onLogClick,
}: MetricsTopBarProps) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <SegmentedControl
        options={[
          { value: "body", label: "Physique" },
          { value: "training", label: "Training" },
          { value: "wellness", label: "Wellness" },
          { value: "blocks", label: "Blocks" },
        ]}
        value={tab}
        onChange={(value) => onTabChange(value as JourneySubtab)}
      />

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={onLogClick}
          className="rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75]"
        >
          Log measurement
        </button>
      </div>
    </div>
  );
}
