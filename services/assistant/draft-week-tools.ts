import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { makeRestWeek } from "@/components/clients/training/program-builder/program-builder-types";
import { cloneWeek } from "@/components/clients/training/program-builder/program-builder-model";
import type { DraftWorkspace } from "./draft-workspace";
import { commitOp, resolveWeek } from "./draft-tool-helpers";

// Week-level WRITE tools: add, duplicate, delete and move a week. A duplicate is
// an exact copy; a progression or a deload is the copies edited afterwards with
// the exercise tools.

export function buildWeekTools(ws: DraftWorkspace) {
  const addWeek = betaTool({
    name: "add_week",
    description: "Append a new empty week (7 rest days) at the end of the program.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } as const,
    run: () => {
      const week = makeRestWeek(ws.draft.weeks.length);
      const err = commitOp(ws, {
        type: "insert_week",
        afterWeekUid: null,
        week,
        label: `Added week ${ws.draft.weeks.length + 1} (rest)`,
      });
      return err ?? `Added empty week ${ws.draft.weeks.length}.`;
    },
  });

  const duplicateWeek = betaTool({
    name: "duplicate_week",
    description:
      "Copy a week exactly, one or more times — every session, exercise and set. The copies land after the source week, or after insertAfterWeek, in order. To progress or deload the copies, edit them afterwards with the exercise tools.",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1, description: "1-based source week — what gets cloned" },
        count: { type: "integer", minimum: 1, maximum: 12, description: "How many copies (default 1)" },
        insertAfterWeek: {
          type: "integer",
          minimum: 1,
          description:
            "1-based week the copies are placed AFTER (default: the source week). Lets you clone one week's content but position the copies elsewhere.",
        },
      },
      required: ["week"],
      additionalProperties: false,
    } as const,
    run: ({ week, count, insertAfterWeek }) => {
      const source = resolveWeek(ws, week);
      if (!source.ok) return source.error;

      // Each copy lands after the one before it, so the copies keep their order.
      let anchorUid = source.value.uid;
      if (insertAfterWeek != null) {
        const anchor = resolveWeek(ws, insertAfterWeek);
        if (!anchor.ok) return anchor.error;
        anchorUid = anchor.value.uid;
      }

      const copies = count ?? 1;
      for (let made = 0; made < copies; made++) {
        const copy = cloneWeek(source.value);
        const err = commitOp(ws, {
          type: "insert_week",
          afterWeekUid: anchorUid,
          week: copy,
          label: `Week ${week} duplicated`,
        });
        if (err) return made > 0 ? `Stopped after ${made} copies: ${err}` : err;
        anchorUid = copy.uid;
      }
      const placedAfter = insertAfterWeek ?? week;
      return `Inserted ${copies} week(s) after week ${placedAfter}${insertAfterWeek != null && insertAfterWeek !== week ? ` (cloned from week ${week})` : ""}. The program now has ${ws.draft.weeks.length} weeks.`;
    },
  });

  const deleteWeek = betaTool({
    name: "delete_week",
    description: "Delete a whole week and everything in it. The program keeps at least one week.",
    inputSchema: {
      type: "object",
      properties: { week: { type: "integer", minimum: 1 } },
      required: ["week"],
      additionalProperties: false,
    } as const,
    run: ({ week }) => {
      const w = resolveWeek(ws, week);
      if (!w.ok) return w.error;
      const err = commitOp(ws, {
        type: "remove_week",
        weekUid: w.value.uid,
        label: `Deleted week ${week}`,
      });
      return err ?? `Deleted week ${week}. The program now has ${ws.draft.weeks.length} weeks.`;
    },
  });

  const moveWeek = betaTool({
    name: "move_week",
    description: "Move a week to a different position (weeks renumber automatically).",
    inputSchema: {
      type: "object",
      properties: {
        week: { type: "integer", minimum: 1 },
        toPosition: { type: "integer", minimum: 1 },
      },
      required: ["week", "toPosition"],
      additionalProperties: false,
    } as const,
    run: ({ week, toPosition }) => {
      const w = resolveWeek(ws, week);
      if (!w.ok) return w.error;
      // Clamp HERE, not just in applyDraftOp: an out-of-range toIndex is
      // schema-invalid on the client, which would discard the entire turn
      // while this tool reported success.
      const target = Math.min(Math.max(toPosition, 1), ws.draft.weeks.length);
      const err = commitOp(ws, {
        type: "move_week",
        weekUid: w.value.uid,
        toIndex: target - 1,
        label: `Moved week ${week} to position ${target}`,
      });
      return err ?? `Moved week ${week} to position ${target}.`;
    },
  });

  return [addWeek, duplicateWeek, deleteWeek, moveWeek];
}
