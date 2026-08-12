import { addDaysToDateString } from "@/lib/date-helpers";
import { inclusiveDays, weeksSpanned } from "@/lib/blocks/block-chain";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type {
  BlockChainEntryInput,
  BlockDateChange,
  ReplaceBlockChainInput,
} from "@/types/client-blocks";

// The add-block PUT payload: the stored chain echoed + the new row appended.
// The echo discipline is the service's elapsed-pin contract (Session 2):
// elapsed rows are pinned verbatim and OMIT `endsOn` (their dates come from
// storage, never the walk); current/future rows echo their stored `endsOn`
// verbatim, reproducing their windows exactly. Name, focus and target echo
// verbatim (nulls included) because the service echo-checks them.

export interface NewBlockEntry {
  name: string;
  endsOn: string;
  focus: string | null;
  targetWeightKg: number | null;
}

export function buildAppendPayload(
  views: ClientBlockView[],
  entry: NewBlockEntry,
  /** Required for the FIRST block only — an existing chain anchors at its
   *  stored start (immovable while past blocks exist). */
  firstStartsOn?: string
): ReplaceBlockChainInput {
  const startsOn = views[0]?.startsOn ?? firstStartsOn;
  if (!startsOn) {
    throw new Error("The first block needs a start date");
  }

  const echoed: BlockChainEntryInput[] = views.map((view) => ({
    id: view.id,
    name: view.name,
    ...(view.state !== "past" ? { endsOn: view.endsOn } : {}),
    focus: view.focus,
    targetWeightKg: view.targetWeightKg,
  }));

  return {
    startsOn,
    blocks: [
      ...echoed,
      {
        name: entry.name,
        endsOn: entry.endsOn,
        focus: entry.focus,
        targetWeightKg: entry.targetWeightKg,
      },
    ],
  };
}

/** An edit-form submission. `endsOn` present only for current/future blocks —
 *  elapsed edits are fields-only (their dates are pinned). `startsOn` moves
 *  the chain ANCHOR and is legal only when the edited block is the chain's
 *  first with nothing lived (the service's floor enforces). */
export interface BlockEdit {
  name: string;
  focus: string | null;
  targetWeightKg: number | null;
  endsOn?: string;
  startsOn?: string;
}

/**
 * How moving one block's END pushes (or pulls) the blocks after it: every
 * later block keeps its DURATION and re-anchors at the new preceding end —
 * the same duration-preserving walk computeDeleteShift does. Returns [] when
 * nothing after the edited block moves (last block, elapsed edit, or an
 * unchanged end).
 */
export function computeEditShift(
  views: ClientBlockView[],
  blockId: string,
  newEndsOn: string
): BlockDateChange[] {
  const index = views.findIndex((view) => view.id === blockId);
  if (index === -1) return [];

  const changes: BlockDateChange[] = [];
  let cursor = addDaysToDateString(newEndsOn, 1);
  for (const view of views.slice(index + 1)) {
    const days = inclusiveDays(view.startsOn, view.endsOn);
    const next = {
      startsOn: cursor,
      endsOn: addDaysToDateString(cursor, days - 1),
    };
    if (next.startsOn !== view.startsOn || next.endsOn !== view.endsOn) {
      changes.push({
        id: view.id,
        name: view.name,
        previous: { startsOn: view.startsOn, endsOn: view.endsOn },
        next,
      });
    }
    cursor = addDaysToDateString(next.endsOn, 1);
  }
  return changes;
}

/**
 * The edit-a-block PUT payload: the chain echoed with the edited row's fields
 * substituted; when the edit moves the block's end, every later row's echoed
 * `endsOn` is re-anchored duration-preserved (computeEditShift), which is
 * exactly what the service's derived-starts walk will execute — so the
 * preview and the result cannot differ. `journeyWeeks` is the new total for
 * the live sentence (per-block ceil, matching the rail meta).
 */
export function buildEditPayload(
  views: ClientBlockView[],
  blockId: string,
  edit: BlockEdit
): {
  payload: ReplaceBlockChainInput;
  changes: BlockDateChange[];
  journeyWeeks: number;
} {
  const target = views.find((view) => view.id === blockId);
  if (!target) {
    throw new Error("Unknown block id");
  }

  const newEndsOn =
    edit.endsOn !== undefined && target.state !== "past"
      ? edit.endsOn
      : target.endsOn;
  const changes =
    newEndsOn !== target.endsOn
      ? computeEditShift(views, blockId, newEndsOn)
      : [];
  const shiftedById = new Map(changes.map((change) => [change.id, change.next]));

  const blocks: BlockChainEntryInput[] = views.map((view) => {
    const isTarget = view.id === blockId;
    const endsOn = isTarget ? newEndsOn : shiftedById.get(view.id)?.endsOn ?? view.endsOn;
    return {
      id: view.id,
      name: isTarget ? edit.name : view.name,
      ...(view.state !== "past" ? { endsOn } : {}),
      focus: isTarget ? edit.focus : view.focus,
      targetWeightKg: isTarget ? edit.targetWeightKg : view.targetWeightKg,
    };
  });

  const anchorMove =
    edit.startsOn !== undefined && views[0].id === blockId
      ? edit.startsOn
      : null;

  const journeyWeeks = views.reduce((sum, view) => {
    const endsOn =
      view.id === blockId
        ? newEndsOn
        : shiftedById.get(view.id)?.endsOn ?? view.endsOn;
    const startsOn =
      view.id === blockId
        ? (anchorMove ?? view.startsOn)
        : shiftedById.get(view.id)?.startsOn ?? view.startsOn;
    return sum + weeksSpanned(startsOn, endsOn);
  }, 0);

  return {
    payload: { startsOn: anchorMove ?? views[0].startsOn, blocks },
    changes,
    journeyWeeks,
  };
}
