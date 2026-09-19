"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  MONO,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { GroupScore, SessionLogPrescribedGroup } from "@/types/training";
import { formatGroupScore, groupHeading, groupHeadingText } from "@/utils/exercise-group-display";
import { takesScore } from "@/utils/group-scores";
import { GroupHeadingLines } from "./group-heading-lines";

// A group in the coach's workout log view: a slim heading naming the group and
// its settings, the timed group's score under it, then the group's exercise
// cards on one rail. A straight-sets group of one never gets one — coaches
// never see a group around a single exercise (docs/TRAINING-UPGRADE-EXECUTION-
// PLAN.md section 4.2) — while a timed group always does, its cap and its
// score being the point.
export function SessionLogGroup({
  group,
  score = null,
  children,
}: {
  group: SessionLogPrescribedGroup;
  /** The log's score for this group, where the format takes one. */
  score?: GroupScore | null;
  children: ReactNode;
}) {
  return (
    <section aria-label={groupHeadingText(groupHeading(group)).title} className="flex flex-col gap-2">
      <div className="px-1">
        <GroupHeadingLines group={group} />
        {takesScore(group.format) && (
          <p data-testid="group-score" className={cn("mt-0.5 text-[12px]", TEXT_PRIMARY)}>
            {score ? (
              // The score's words are numbers with their nouns, so the whole
              // line is one mono datum ("7 rounds + 12 reps", "Finished in 8:32").
              <span className={MONO}>{formatGroupScore(group.format, score)}</span>
            ) : (
              <span className={TEXT_MUTED}>Not scored</span>
            )}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-[10px] border-l-2 border-[rgba(13,148,136,0.15)] pl-3">
        {children}
      </div>
    </section>
  );
}
