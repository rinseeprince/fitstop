"use client";

import type { ReactNode } from "react";
import type { SessionLogPrescribedGroup } from "@/types/training";
import { groupHeading, groupHeadingText } from "@/utils/exercise-group-display";
import { GroupHeadingLines } from "./group-heading-lines";

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
  return (
    <section aria-label={groupHeadingText(groupHeading(group)).title} className="flex flex-col gap-2">
      <div className="px-1">
        <GroupHeadingLines group={group} />
      </div>
      <div className="flex flex-col gap-[10px] border-l-2 border-[rgba(13,148,136,0.15)] pl-3">
        {children}
      </div>
    </section>
  );
}
