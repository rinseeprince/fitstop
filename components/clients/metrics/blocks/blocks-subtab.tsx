"use client";

import { useMemo } from "react";
import { Flag } from "lucide-react";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";
import { getTodayDateString } from "@/lib/date-helpers";
import { derivePace } from "@/lib/blocks/block-derivations";
import { useBlockFacts, useClientBlocks } from "../hooks/use-client-blocks";
import { blockColor } from "./block-colors";
import { deriveBlockWeightFacts } from "./block-weight";
import { BlockCard } from "./block-card";
import type { MetricSummary } from "../metrics-view-types";

// The Journey tab's Blocks pane: the chain (decorated server-side in the
// CLIENT's timezone — state is never re-derived here) + per-block facts +
// the weight story from the SAME merged series as the chart and log beside
// it, so the numbers cannot disagree. Add (3.3) and delete (3.4) mount here.

const round1 = (n: number): number => Math.round(n * 10) / 10;

type BlocksSubtabProps = {
  clientId: string;
  /** The weight MetricSummary from useMergedMetrics (viewer units), or null
   *  while metrics load / when nothing is logged. */
  weightMetric: MetricSummary | null;
};

export function BlocksSubtab({ clientId, weightMetric }: BlocksSubtabProps) {
  const { blocks, isLoading, isError } = useClientBlocks(clientId);
  const {
    facts,
    isLoading: factsLoading,
    isError: factsError,
  } = useBlockFacts(clientId);
  const { preference } = useUnits();

  const factsById = useMemo(
    () => new Map(facts.map((fact) => [fact.blockId, fact])),
    [facts]
  );

  const weightPoints = weightMetric?.points ?? [];
  const weightUnit =
    weightMetric?.unit ?? (preference === "imperial" ? "lbs" : "kg");
  // Device today, for the pace interpolation fraction ONLY — block state
  // always comes from the wire, derived in the client's timezone.
  const today = getTodayDateString();

  const totalWeeks = blocks.reduce((sum, block) => sum + block.weeks, 0);
  const meta =
    blocks.length > 0
      ? `${blocks.length} ${blocks.length === 1 ? "block" : "blocks"} · ${totalWeeks} weeks`
      : undefined;

  return (
    <div>
      <SectionLabel label="Blocks" meta={meta} />

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-[42px] w-full rounded-[6px]" />
          <Skeleton className="h-[42px] w-full rounded-[6px]" />
        </div>
      ) : isError ? (
        <p className="py-12 text-center text-[13px] text-[#93b0b4]">
          Failed to load blocks.
        </p>
      ) : blocks.length === 0 ? (
        <div className="rounded-[6px] bg-white px-5 py-12 text-center">
          <Flag
            className="mx-auto h-8 w-8 text-[#93b0b4] opacity-50"
            strokeWidth={1.5}
          />
          <p className="mt-2 text-sm text-[#5a7d82]">No blocks yet</p>
          <p className="mt-1 text-xs text-[#93b0b4]">
            Blocks are named stretches of this client&apos;s journey — a cut, a
            build, a deload — with the training, nutrition and weight story of
            each.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map((block, index) => {
            const weight = deriveBlockWeightFacts(weightPoints, block);
            const targetDisplay =
              block.targetWeightKg != null
                ? round1(formatWeight(block.targetWeightKg, preference).value)
                : null;
            const pace =
              targetDisplay != null
                ? derivePace({
                    startsOn: block.startsOn,
                    endsOn: block.endsOn,
                    targetWeight: targetDisplay,
                    startWeight: weight.start?.value ?? null,
                    currentWeight: weight.end?.value ?? null,
                    today,
                  })
                : null;
            return (
              <BlockCard
                key={block.id}
                block={block}
                color={blockColor(index)}
                facts={factsById.get(block.id)}
                factsLoading={factsLoading}
                factsError={factsError}
                weight={weight}
                pace={pace}
                targetDisplay={targetDisplay}
                weightUnit={weightUnit}
                defaultOpen={block.state === "current"}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
