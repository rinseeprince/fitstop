"use client";

import type { ReactNode } from "react";
import { GripVertical, Unlink2 } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { groupHeading, groupHeadingText, groupName } from "@/utils/exercise-group-display";
import { GroupHeadingLines } from "@/components/clients/training/group-heading-lines";
import type { ExerciseGroupDraft } from "./program-builder-types";
import type { GroupSettingsPatch } from "./program-builder-groups";
import { GroupSettingsPopover } from "./group-settings-popover";
import { DropLine, type DropLineEdge } from "./drop-line";
import {
  groupDragId,
  itemDropId,
  railDropId,
  type ExerciseDragData,
  type ExerciseDropData,
} from "./exercise-drop";
import { FOCUS_RING, TEXT_MUTED } from "./builder-tokens";

// A linked group in the session editor — a superset, circuit or linked
// straight sets: a slim heading that reads exactly as the client and the
// workout log view read it (GroupHeadingLines), then the group's exercise
// cards on one rail. A lone exercise never gets one. In edit mode the heading
// carries a grip that drags the whole group, the settings popover and Unlink.
type ExerciseGroupBlockProps = {
  group: ExerciseGroupDraft;
  /** The group's place among the session's groups. */
  index: number;
  editable: boolean;
  picking: boolean;
  /** Where a drop would land against the whole group, drawn as a line. */
  dropLine: DropLineEdge | null;
  onUpdate: (patch: GroupSettingsPatch) => void;
  onUnlink: () => void;
  children: ReactNode;
};

const ICON_ACTION = cn("rounded p-1 transition-colors hover:text-[#0d9488]", TEXT_MUTED, FOCUS_RING);

export function ExerciseGroupBlock({
  group,
  index,
  editable,
  picking,
  dropLine,
  onUpdate,
  onUnlink,
  children,
}: ExerciseGroupBlockProps) {
  const title = groupHeadingText(groupHeading(group)).title;
  const name = groupName(group.format, group.exercises.length);

  const dragData: ExerciseDragData = { type: "group", groupUid: group.uid };
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    transform,
    isDragging,
  } = useDraggable({ id: groupDragId(group.uid), data: dragData, disabled: !editable || picking });
  const itemData: ExerciseDropData = { type: "item", index, linked: true };
  const { setNodeRef: setDropRef } = useDroppable({
    id: itemDropId(group.uid),
    data: itemData,
    disabled: !editable,
  });
  const railData: ExerciseDropData = { type: "rail", groupUid: group.uid };
  const { setNodeRef: setRailRef } = useDroppable({
    id: railDropId(group.uid),
    data: railData,
    disabled: !editable,
  });
  const actions = editable && !picking;

  return (
    <section
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      aria-label={title}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("group/grp relative flex flex-col gap-2", isDragging && "z-10 opacity-40")}
    >
      {dropLine && <DropLine edge={dropLine} />}
      <div className="flex items-start gap-2 px-1">
        {actions && (
          <button
            type="button"
            aria-label={`Drag ${name.toLowerCase()}`}
            className={cn(
              "-ml-0.5 mt-px cursor-grab rounded p-0.5 opacity-0 transition-opacity hover:bg-[rgba(13,148,136,0.08)] active:cursor-grabbing group-hover/grp:opacity-100 group-focus-within/grp:opacity-100",
              TEXT_MUTED,
            )}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <GroupHeadingLines group={group} />
        </div>
        {actions && (
          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/grp:opacity-100 group-focus-within/grp:opacity-100 has-[[data-state=open]]:opacity-100">
            <GroupSettingsPopover group={group} onUpdate={onUpdate} />
            <button
              type="button"
              aria-label={`Unlink ${name.toLowerCase()}`}
              title="Unlink"
              className={ICON_ACTION}
              onClick={onUnlink}
            >
              <Unlink2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>
      <div
        ref={setRailRef}
        className="flex flex-col gap-[10px] border-l-2 border-[rgba(13,148,136,0.15)] pl-3"
      >
        {children}
      </div>
    </section>
  );
}
