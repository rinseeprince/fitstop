"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  MONO,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { SessionLogPrescribedGroup } from "@/types/training";
import { groupHeading, groupHeadingText } from "@/utils/exercise-group-display";

// A linked group in the coach's workout log view: a slim heading naming the
// group and its settings, then the group's exercise cards on one rail. A lone
// exercise never gets one — coaches never see a group around a single exercise
// (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.2).
export function SessionLogGroup({
  group,
  children,
}: {
  group: SessionLogPrescribedGroup;
  children: ReactNode;
}) {
  const heading = groupHeading(group);
  return (
    <section aria-label={groupHeadingText(heading).title} className="flex flex-col gap-2">
      <div className="px-1">
        <p className={cn("text-[13px] font-semibold", TEXT_PRIMARY)}>
          {heading.name}
          {heading.rounds && (
            <span className={cn("font-normal", TEXT_SECONDARY)}>
              <span className="mx-1.5">·</span>
              <span className={MONO}>{heading.rounds.count}</span> {heading.rounds.words}
            </span>
          )}
        </p>
        {heading.rests.length > 0 && (
          <p className={cn("mt-0.5 text-[12px]", TEXT_SECONDARY)}>
            {heading.rests.map((rest, index) => (
              <span key={rest.words}>
                {index > 0 && <span className="mx-1.5">·</span>}
                {rest.duration && (
                  <>
                    <span className={MONO}>{rest.duration}</span>{" "}
                  </>
                )}
                {rest.words}
              </span>
            ))}
          </p>
        )}
        {heading.notes && (
          <p className={cn("mt-0.5 whitespace-pre-wrap text-[12px]", TEXT_MUTED)}>
            {heading.notes}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-[10px] border-l-2 border-[rgba(13,148,136,0.15)] pl-3">
        {children}
      </div>
    </section>
  );
}
