import { formatDateOnlyShort } from "@/lib/date-helpers";
import type { ClientBlock } from "@/types/client-blocks";

// The Block field on both setup surfaces — the apply-to-client dialog and the
// nutrition drawer — picks the block a plan starts in, and the date field under
// it is then bounded to that block's window. Pure: the options and the window
// each one constrains the date to are derived here from the chain payload and
// the shared deletion floor, and nothing else spells either rule.
//
// Purely UX, the same on both tracks: each placement resolves its own window
// from the block covering its START (ARCHITECTURE → "The window is the row" /
// "Whole-program placement"), so the field only helps the coach pick a valid
// start inside the block they mean. Nothing here is stored or sent.

/** The value of the "No block — pick a date" option. Block ids are UUIDs, so
 *  the word cannot collide with one. */
export const NO_BLOCK_OPTION = "none";

const NO_BLOCK_LABEL = "No block — pick a date";

/** The bounds a start-date input takes: `max` is null when nothing caps it. */
export interface StartWindow {
  min: string;
  max: string | null;
}

export interface BlockStartOption {
  /** The block's id, or `NO_BLOCK_OPTION`. */
  value: string;
  /** "Cut · 6 Oct – 2 Nov", or the No-block label. */
  label: string;
  window: StartWindow;
}

type BlockStartSource = Pick<ClientBlock, "id" | "name" | "startsOn" | "endsOn">;

/**
 * The window a start date is confined to once a block is chosen: from the later
 * of the deletion floor and the block's start (a block already under way
 * offers the floor, not the day it began — the placement and the nutrition
 * save both refuse a start before it) to the block's last day. With no block
 * the floor alone bounds the date, with no ceiling.
 */
function blockStartWindow(
  block: Pick<ClientBlock, "startsOn" | "endsOn"> | null,
  floor: string
): StartWindow {
  if (!block) return { min: floor, max: null };
  return {
    min: block.startsOn > floor ? block.startsOn : floor,
    max: block.endsOn,
  };
}

/**
 * The Block field's options: every block whose last day is on or after the
 * floor — a block that ended before it holds no day a plan can start on — in
 * the order the chain payload lists them (date order), each labelled with its
 * range, then the No-block option last. Never empty: the No-block option is
 * always there, so a client with no blocks still has a field that says so.
 */
export function buildBlockStartOptions(
  blocks: readonly BlockStartSource[],
  floor: string
): BlockStartOption[] {
  const options: BlockStartOption[] = blocks
    .filter((block) => block.endsOn >= floor)
    .map((block) => ({
      value: block.id,
      label: `${block.name} · ${formatDateOnlyShort(block.startsOn)} – ${formatDateOnlyShort(block.endsOn)}`,
      window: blockStartWindow(block, floor),
    }));
  options.push({
    value: NO_BLOCK_OPTION,
    label: NO_BLOCK_LABEL,
    window: blockStartWindow(null, floor),
  });
  return options;
}

/**
 * The option a surface shows: the coach's own pick when it names a listed
 * option, else the block they came from (the Journey round trip's block,
 * preselected — a coach who clicked "place one" / "set targets" has already
 * said which days they mean) when it is listed, else No block. A pick or a
 * trip naming a block the list no longer holds — deleted, or ended before the
 * floor — falls through rather than selecting nothing.
 *
 * `options` is `buildBlockStartOptions`' output, which always carries the
 * No-block option; anything else is a caller bug and fails loudly.
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
    throw new Error("Block start options must carry the No-block option");
  }
  return listed(pick) ?? listed(preselected) ?? noBlock;
}
