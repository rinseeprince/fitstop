import { formatDateOnlyShort } from "@/lib/date-helpers";
import type { ClientBlock } from "@/types/client-blocks";

// The Block field on both setup surfaces — the apply-to-client dialog and the
// nutrition drawer — picks the block a plan starts in. A chosen block FIXES the
// start: the plan begins on the block's first available day and the date field
// under it is disabled. With no block chosen (the dash) the date field is the
// coach's own, floored at the surface's floor — the deletion floor on the apply
// dialog (a workout logged today moves it to tomorrow), the client's today on
// the nutrition drawer (targets ask no floor; owner, 2026-09-11). Pure: the
// options and the day each one fixes are derived here from the chain payload
// and the floor, and nothing else spells either rule.
//
// Purely UX, the same on both tracks: each placement resolves its own window
// from the block covering its START (ARCHITECTURE → "The window is the row" /
// "Whole-program placement"), so the field only starts the plan where the block
// the coach means begins. Nothing here is stored or sent.

/** The value of the no-block option — the field's empty state, a bare dash.
 *  Block ids are UUIDs, so the word cannot collide with one. */
export const NO_BLOCK_OPTION = "none";

const NO_BLOCK_LABEL = "—";

export interface BlockStartOption {
  /** The block's id, or `NO_BLOCK_OPTION`. */
  value: string;
  /** "Cut · 6 Oct – 2 Nov", or the dash. */
  label: string;
  /** The day a plan starts with this option chosen: the later of the surface's
   *  floor and the block's start — a block already under way starts the plan
   *  at the floor, never on the day it began (the placement refuses a start
   *  before its floor; a version starts no earlier than the client's today).
   *  For the dash, the floor itself: the earliest day the coach may pick. */
  startsOn: string;
}

type BlockStartSource = Pick<ClientBlock, "id" | "name" | "startsOn" | "endsOn">;

/**
 * The Block field's options: the dash first — the field's empty state — then
 * every block whose last day is on or after the floor (a block that ended
 * before it holds no day a plan can start on), in the order the chain payload
 * lists them (date order), each labelled with its range. Never empty: the dash
 * is always there, so a client with no blocks still has a field that reads as
 * unset.
 */
export function buildBlockStartOptions(
  blocks: readonly BlockStartSource[],
  floor: string
): BlockStartOption[] {
  const listed: BlockStartOption[] = blocks
    .filter((block) => block.endsOn >= floor)
    .map((block) => ({
      value: block.id,
      label: `${block.name} · ${formatDateOnlyShort(block.startsOn)} – ${formatDateOnlyShort(block.endsOn)}`,
      startsOn: block.startsOn > floor ? block.startsOn : floor,
    }));
  return [{ value: NO_BLOCK_OPTION, label: NO_BLOCK_LABEL, startsOn: floor }, ...listed];
}

/**
 * The option a surface shows: the coach's own pick when it names a listed
 * option, else the block they came from (the Journey round trip's block,
 * preselected — a coach who clicked "place one" / "set targets" has already
 * said which days they mean) when it is listed, else the dash. A pick or a
 * trip naming a block the list no longer holds — deleted, or ended before the
 * floor — falls through rather than selecting nothing.
 *
 * `options` is `buildBlockStartOptions`' output, which always carries the
 * dash; anything else is a caller bug and fails loudly.
 */
export function selectBlockStartOption(
  options: readonly BlockStartOption[],
  pick: string | null,
  preselected: string | null
): BlockStartOption {
  const listed = (value: string | null) =>
    value ? options.find((option) => option.value === value) : undefined;
  const noBlock = listed(NO_BLOCK_OPTION);
  if (!noBlock) {
    throw new Error("Block start options must carry the no-block option");
  }
  return listed(pick) ?? listed(preselected) ?? noBlock;
}
