"use client";

import { cn } from "@/lib/utils";
import {
  MONO,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/components/clients/training/program-builder/builder-tokens";
import type { GroupSettings } from "@/utils/exercise-groups";
import { groupHeading } from "@/utils/exercise-group-display";

type HeadingGroup = GroupSettings & { exercises: ReadonlyArray<unknown> };

// A linked group's heading as a coach reads it: its name and rounds, its rests
// and its notes, in the words utils/exercise-group-display.ts gives every
// screen. Shared by the workout log view and the session editor, so the group
// a coach builds reads exactly as the group they later review. The notes are
// the coach's instructions to the client, so the log view leaves them out
// (`withNotes={false}`; owner, 2026-09-19): the coach wrote them.
export function GroupHeadingLines({
  group,
  withNotes = true,
}: {
  group: HeadingGroup;
  withNotes?: boolean;
}) {
  const heading = groupHeading(group);
  return (
    <>
      <GroupHeadingTitle group={group} />
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
      {withNotes && heading.notes && (
        <p className={cn("mt-0.5 whitespace-pre-wrap text-[12px]", TEXT_MUTED)}>
          {heading.notes}
        </p>
      )}
    </>
  );
}

/**
 * The heading's first line — its name, its rounds and, for a timed group, its
 * cap or interval ("AMRAP · 12m", "For time · 3 rounds · 12m cap", "EMOM · 8
 * rounds · every 1m") — also what a dragged group shows.
 */
export function GroupHeadingTitle({ group }: { group: HeadingGroup }) {
  const heading = groupHeading(group);
  return (
    <p className={cn("text-[13px] font-semibold", TEXT_PRIMARY)}>
      {heading.name}
      {heading.rounds && (
        <span className={cn("font-normal", TEXT_SECONDARY)}>
          <span className="mx-1.5">·</span>
          <span className={MONO}>{heading.rounds.count}</span> {heading.rounds.words}
        </span>
      )}
      {heading.timing && (
        <span className={cn("font-normal", TEXT_SECONDARY)}>
          <span className="mx-1.5">·</span>
          {heading.timing.words === null ? (
            <span className={MONO}>{heading.timing.duration}</span>
          ) : heading.timing.before ? (
            <>
              {heading.timing.words} <span className={MONO}>{heading.timing.duration}</span>
            </>
          ) : (
            <>
              <span className={MONO}>{heading.timing.duration}</span> {heading.timing.words}
            </>
          )}
        </span>
      )}
    </p>
  );
}
