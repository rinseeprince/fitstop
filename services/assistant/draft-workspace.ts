import type { ExerciseRow } from "@/lib/database-helpers";
import { fetchCatalogRowsForResolve } from "@/services/exercise-catalog-service";
import type {
  BuilderTarget,
  ProgramDraft,
} from "@/components/clients/training/program-builder/program-builder-types";
import { normalizeDraft } from "@/components/clients/training/program-builder/program-builder-model";
import type { DraftOp } from "@/components/clients/training/program-builder/program-builder-ops";

// Per-request working state for one assistant turn (builder S6a). The server
// holds NO cross-turn draft state — every turn uploads a fresh snapshot, so
// manual edits between turns are automatically visible and there is nothing to
// reconcile. Tool executors read and mutate `draft` (via applyDraftOp) and
// append the DraftOps the client will replay.

export type DraftWorkspace = {
  draft: ProgramDraft;
  target: BuilderTarget;
  ops: DraftOp[];
  // Executor-level notes surfaced to the coach alongside the reply (skipped
  // edits, sweep discards) — independent of the model's own narration.
  notes: string[];
  catalog: ExerciseRow[];
  isCompound: (ex: { exerciseId: string | null; name: string }) => boolean;
  // Entry-state fingerprints for the pre-return defense sweeps.
  entry: {
    programName: string;
    programSplitType: string | null;
    sessionIdentity: Map<string, { name: string; focus: string | null }>;
    exerciseUids: Set<string>;
    exerciseNames: Set<string>; // lowercase — clones of pre-existing content
  };
};

// Same classifier the duplicate-week dialog uses (progression-preview-model's
// buildIsCompound), rebuilt over raw catalog rows: category "compound"
// case-insensitively; id-first, name-fallback; unknown = NOT compound.
function buildIsCompoundFromRows(
  rows: ExerciseRow[],
): DraftWorkspace["isCompound"] {
  const byId = new Map<string, boolean>();
  const byName = new Map<string, boolean>();
  for (const row of rows) {
    const compound = (row.category ?? "").trim().toLowerCase() === "compound";
    byId.set(row.id, compound);
    byName.set(row.name.trim().toLowerCase(), compound);
  }
  return (ex) =>
    ex.exerciseId != null
      ? (byId.get(ex.exerciseId) ?? false)
      : (byName.get(ex.name.trim().toLowerCase()) ?? false);
}

export async function createDraftWorkspace(opts: {
  coachId: string;
  target: BuilderTarget;
  draft: ProgramDraft;
}): Promise<DraftWorkspace> {
  const catalog = await fetchCatalogRowsForResolve(opts.coachId);
  return buildWorkspaceFromRows({ target: opts.target, draft: opts.draft, catalog });
}

/** Pure assembly (split out so tests build workspaces from fixture rows). */
export function buildWorkspaceFromRows(opts: {
  target: BuilderTarget;
  draft: ProgramDraft;
  catalog: ExerciseRow[];
}): DraftWorkspace {
  const { catalog } = opts;
  const draft = normalizeDraft(opts.draft);

  const sessionIdentity = new Map<string, { name: string; focus: string | null }>();
  const exerciseUids = new Set<string>();
  const exerciseNames = new Set<string>();
  for (const week of draft.weeks) {
    for (const slot of week.days) {
      if (!slot.session) continue;
      sessionIdentity.set(slot.session.uid, {
        name: slot.session.name,
        focus: slot.session.focus,
      });
      for (const ex of slot.session.exercises) {
        exerciseUids.add(ex.uid);
        exerciseNames.add(ex.name.trim().toLowerCase());
      }
    }
  }

  return {
    draft,
    target: opts.target,
    ops: [],
    notes: [],
    catalog,
    isCompound: buildIsCompoundFromRows(catalog),
    entry: {
      programName: draft.name,
      programSplitType: draft.splitType,
      sessionIdentity,
      exerciseUids,
      exerciseNames,
    },
  };
}

/**
 * Pre-return defense sweeps — the last belts behind the per-tool guards, so a
 * bulk-tool or executor bug can never leak past the route boundary:
 * 1. CATALOG: every exercise the turn INTRODUCED (uid not present at entry)
 *    must either carry a catalog-verified exerciseId or be a clone of content
 *    that already existed in the draft (same name). Otherwise the whole turn's
 *    ops are discarded — "never return an unresolved exercise to the client".
 * 2. IDENTITY (client-draft): the final working copy must keep the entry
 *    program name/focus and every pre-existing session's name/focus
 *    (the b2b970f template-identity rule).
 * Returns the ops to ship, or [] with an explanatory note.
 */
export function finalizeAssistantOps(ws: DraftWorkspace): {
  ops: DraftOp[];
  notes: string[];
} {
  const catalogIds = new Set(ws.catalog.map((r) => r.id));

  for (const week of ws.draft.weeks) {
    for (const slot of week.days) {
      for (const ex of slot.session?.exercises ?? []) {
        if (ws.entry.exerciseUids.has(ex.uid)) continue;
        const resolved = ex.exerciseId != null && catalogIds.has(ex.exerciseId);
        const cloneOfExisting = ws.entry.exerciseNames.has(
          ex.name.trim().toLowerCase(),
        );
        if (!resolved && !cloneOfExisting) {
          return {
            ops: [],
            notes: [
              ...ws.notes,
              `Discarded this turn's edits: "${ex.name}" is not in your exercise library.`,
            ],
          };
        }
      }
    }
  }

  if (ws.target === "client-draft") {
    const identityBroken =
      ws.draft.name !== ws.entry.programName ||
      ws.draft.splitType !== ws.entry.programSplitType ||
      ws.draft.weeks.some((week) =>
        week.days.some((slot) => {
          if (!slot.session) return false;
          const entry = ws.entry.sessionIdentity.get(slot.session.uid);
          if (!entry) return false; // session added this turn — its own name is fine
          return entry.name !== slot.session.name || entry.focus !== slot.session.focus;
        }),
      );
    if (identityBroken) {
      return {
        ops: [],
        notes: [
          ...ws.notes,
          "Discarded this turn's edits: program and session names are template identity and can't change in the client editor.",
        ],
      };
    }
  }

  return { ops: ws.ops, notes: ws.notes };
}
