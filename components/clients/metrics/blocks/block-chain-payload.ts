import { weeksSpanned } from "@/lib/blocks/block-chain";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type {
  BlockChainEntryInput,
  ReplaceBlockChainInput,
} from "@/types/client-blocks";

// The PUT payload builders. Every block carries its OWN window (migration 164),
// so a save echoes the stored set with each row's own dates and changes only the
// row the coach touched — editing one block never moves another, and a gap
// between two of them is a legitimate state rather than something to walk away.
//
// The echo discipline is the service's elapsed-pin contract: elapsed rows are
// pinned and OMIT their dates (those come from storage, never from the payload);
// current and future rows carry both dates verbatim. Name and focus echo
// verbatim, nulls included, because the service echo-checks them.

/** Echo one stored block back unchanged. */
function echo(view: ClientBlockView): BlockChainEntryInput {
  return {
    id: view.id,
    name: view.name,
    ...(view.state !== "past" ? { startsOn: view.startsOn, endsOn: view.endsOn } : {}),
    focus: view.focus,
  };
}

interface NewBlockEntry {
  name: string;
  startsOn: string;
  endsOn: string;
  focus: string | null;
}

/** The add-block PUT: the stored set echoed, with the new row appended. */
export function buildAppendPayload(
  views: ClientBlockView[],
  entry: NewBlockEntry
): ReplaceBlockChainInput {
  return {
    blocks: [
      ...views.map(echo),
      {
        name: entry.name,
        startsOn: entry.startsOn,
        endsOn: entry.endsOn,
        focus: entry.focus,
      },
    ],
  };
}

/** An edit-form submission. Dates are present only for current/future blocks —
 *  an elapsed edit is fields-only, because its window is pinned history. */
interface BlockEdit {
  name: string;
  focus: string | null;
  startsOn?: string;
  endsOn?: string;
}

/**
 * The edit PUT: the stored set echoed with one row's fields replaced.
 *
 * No shift and no `changes` to preview — a block owning its own window means an
 * edit has no consequence for any other block. `journeyWeeks` is the new total
 * for the live sentence (per-block ceil, matching the rail meta); it is a SUM of
 * the blocks' own spans, so a gap between them counts for nothing, which is what
 * a coach means by "how long is this journey".
 */
export function buildEditPayload(
  views: ClientBlockView[],
  blockId: string,
  edit: BlockEdit
): { payload: ReplaceBlockChainInput; journeyWeeks: number } {
  const target = views.find((view) => view.id === blockId);
  if (!target) {
    throw new Error("Unknown block id");
  }

  const editable = target.state !== "past";
  const startsOn = editable ? edit.startsOn ?? target.startsOn : target.startsOn;
  const endsOn = editable ? edit.endsOn ?? target.endsOn : target.endsOn;

  const blocks: BlockChainEntryInput[] = views.map((view) =>
    view.id === blockId
      ? {
          id: view.id,
          name: edit.name,
          ...(editable ? { startsOn, endsOn } : {}),
          focus: edit.focus,
        }
      : echo(view)
  );

  const journeyWeeks = views.reduce(
    (sum, view) =>
      sum +
      (view.id === blockId
        ? weeksSpanned(startsOn, endsOn)
        : weeksSpanned(view.startsOn, view.endsOn)),
    0
  );

  return { payload: { blocks }, journeyWeeks };
}
