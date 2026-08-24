# Dead-Code Sweep — Execution Plan

Find every piece of refactor residue in the repo and remove it. **No behaviour change anywhere** — if removing something changes what a coach or client sees, it was not dead and does not belong in this workstream.

**Why this exists.** The codebase has been through several architecture reversals in a short window: events-as-SOT (migrations 113-118), migration 121 giving every placed day its own session row, the placed-plan editing overhaul deleting the whole legacy calendar drawer, nutrition plans moving from one durable row to date-ranged versions (144), roadmaps/phases removed entirely (133). Each left something behind.

The cost is not disk space. **Unmarked dead code reads as live and gets reasoned from.** During the per-set-completion review (2026-08-24/25) three separate wrong conclusions were drawn from unreferenced code that still looks current, each costing the owner a turn to unpick. That is the problem this fixes.

> **Scope note.** This is repo-wide, not scoped to any feature. It was found during the per-set-completion workstream (`docs/PER-SET-COMPLETION-EXECUTION-PLAN.md`) but is deliberately NOT a phase of it: that file is deleted once its workstream ships, and a sweep's record of what was kept and why has to outlive the sweep.

---

## Two kinds of dead code. Only one is in scope.

**Deliberately kept** — a recorded decision, with a doc entry saying what it is and why it stays:

- `components/clients/daily-pulse/` — frozen legacy, unmounted, "no deletion scheduled"
- the `upsert_daily_log_atomic()` RPC — "remains in the DB as an unused function… must not be used for new writes"
- `styles/globals.css` — "DEAD. imported by nothing"
- the `training_data` / `activityStatuses` JSONB — "orphaned cache", legacy rows only
- `/dashboard/training-library`, `/dashboard/programs/sessions`, `/dashboard/programs/exercises` — `redirect()` stubs kept so old links resolve

**Leave every one of these alone.** They have never misled anybody, precisely because they are marked — and that is the evidence for this workstream's central rule. The list above is illustrative, not exhaustive: **CONVENTIONS.md and docs/ARCHITECTURE.md are the authority**, and anything with an entry there explaining why it stays is category one.

**Refactor residue** — nothing references it, nothing decided it should stay, no note explains it. **This is the target.**

---

## Known seed

Verified during the per-set-completion Phase 2 review. Confirm each still holds, then extend — this is a starting point, not the scope.

1. **`app/api/clients/[id]/training/[planId]/sessions/[sessionId]/exercises/[exerciseId]/route.ts`** — **both** PATCH and DELETE handlers, no caller in `app/`, `components/` or `hooks/`. Orphaned when the legacy drawer was deleted in the placed-plan overhaul. Highest-risk item in the seed: the DELETE is an unguarded soft-delete, exactly the shape someone wires back up assuming it is safe because it exists. It also predates two conventions (`apiRateLimit` rather than `coachApiRateLimit`, and `getAuthenticatedCoachId()` without `request`), so it would fail review the day anyone did.
2. **The placed-session tray's scope dialog** — `placed-session-editor.tsx:236-280` ("All occurrences") and its trigger at `use-placed-session-editor.ts:106` (`>1 FUTURE SCHEDULED occurrence`). Since migration 121 every placed day owns its own session row, so that count is always 1 and the dialog can never open. This is the specific shape that produced two of the three wrong conclusions. If the dialog goes, check whether `getSessionEventLinks`' list-shaped return still earns its plurality.
3. **`set-tracker.tsx:508`'s `?? view` fallback** — `prescribedViews[i]` is defined for every prescribed index, and the unplanned branch takes `view` directly at `:514`, so the fallback is unreachable.

---

## Method

Mechanical first, judgement second:

- API routes with no `fetch` caller in `app/`, `components/`, `hooks/`.
- Exported functions, components, types and hooks with no importer.
- Unreachable branches, and predicates a documented invariant makes always-true or always-false (the `?? view` shape).
- Cross-check every candidate against CONVENTIONS.md and docs/ARCHITECTURE.md before proposing it — a doc entry means it is category one.

### Four false-positive classes. Handle each by hand.

1. **`/api/client/**` is the React Native contract.** No web caller does NOT mean dead — RN calls it, or is being built to. Exclude the namespace from the mechanical pass and reason about it separately, naming anything genuinely unused rather than deleting it. A generic dead-code tool reports this entire surface as dead; that would be the single worst outcome of this workstream.
2. **`/api/check-in/**` is public and token-based**, reached from an emailed link rather than from app code.
3. **`waitlist_signups` and anything around it is written by a different repo** (`atletafit-marketing`) — see ARCHITECTURE → External Consumers. It looks dead to any grep of this repo and is not. Its `types/database.ts` entry is a mechanical `gen types` mirror, not evidence of a reader.
4. **Test-only exports.** A function whose only importer is its own test file is dead product code, but deleting it breaks a green test. Delete both, or say why the test still earns its place — do not leave an export alive purely to keep a test compiling, and do not delete a test to make a removal possible without saying so.

---

## Rules for the removal

- **Delete, never comment out.** Commented-out code is the same failure this workstream exists to fix, with worse ergonomics. Git history is the archive.
- **If a doc references what you delete, update the doc in the same commit.** CONVENTIONS.md and docs/ARCHITECTURE.md are the surviving record.
- **Anything KEPT despite being unreferenced gets a one-line marker at the code**, saying what it is and why. This is the actual fix for the reasoning problem: the five category-one items above prove marked dead code is safe, and the three seed items prove unmarked dead code is not. A marker at the code beats a doc entry, because the next reader is looking at the code.
- **Report before deleting.** The list is the deliverable of the first half; the deletions are the second. A candidate you are unsure about is reported, not removed.
- **The permanent record is the markers and the docs, not this file.** This file is deleted once the sweep ships, like every other completed execution plan. Anything that must survive it goes into a code comment, CONVENTIONS.md, or docs/ARCHITECTURE.md.

**Completion protocol:** at commit time, append a STATUS block to the end of this file — what was swept, what was removed, what was kept and why, and the test results.

---

## Pasteable prompt

```
Read CONVENTIONS.md (repo root) and docs/ARCHITECTURE.md in full before doing anything else — they are the authority on which unreferenced code is DELIBERATELY kept, and you cross-check every candidate against them. Then read docs/DEAD-CODE-SWEEP.md in full; it is the spec for this session.

This is a repo-wide sweep, not scoped to any feature. Two halves, and I want the first one before you touch anything.

HALF ONE — the sweep. Find every unreferenced API route, exported function, component, type and hook, plus branches a documented invariant makes unreachable. Start from the three verified seed items and extend well past them. Cross-check every candidate against the docs: anything with an entry explaining why it stays is DELIBERATELY kept and is not a candidate. Watch the four false-positive classes named in the plan — /api/client/** is the React Native contract and has no web caller by design, /api/check-in/** is reached from emailed links, waitlist_signups is written by a separate repo, and a function whose only importer is its own test is a judgement call. Report the full list — found, proposed action, and your reasoning per item — and WAIT for my approval.

HALF TWO — the removal, only for what I approve. Delete rather than comment out. Update any doc that references what you remove, in the same commit. Anything I tell you to KEEP gets a one-line marker at the code saying what it is and why it is still there — that marker is the whole point, so do not skip it.

Hard constraints: no behaviour change anywhere — if a removal changes what a coach or client sees, it was not dead and comes straight back out. Do not touch anything on the "deliberately kept" list. Do not delete a test to make a removal possible without telling me. Do not use `as any` or a type escape to make something compile after a removal — that means the removal was wrong.

When done: npx tsc --noEmit, npx eslint ., npx vitest run, npm run check:labels must ALL pass before you commit. One commit to main, then append a STATUS block to docs/DEAD-CODE-SWEEP.md (what was swept, what was removed, what was kept and why, test results) in that same commit.
```

---

## STATUS blocks

*(Appended at commit time.)*
