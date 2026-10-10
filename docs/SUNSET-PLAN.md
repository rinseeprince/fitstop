# Sunset — the AI check-in review and its draft reply go, and so do the Journey blocks

**STATUS: S1 SHIPPED `1ffaee98` (2026-10-10); S2a, S2b and S3 PLANNED 2026-10-10.** Four commits (§6), about a day at the owner's pace. Lands AFTER
`docs/PERF-PLAN.md` P0 (the request rules in CONVENTIONS, the counter and the gate — so the code S2a writes is written
against them) and BEFORE P1 (so no perf commit tunes code this plan deletes; P1 re-baselines the counter).

**Why (owner, 2026-10-10).** "I will be removing the AI review features and the AI autoreplies, I am also going to
remove blocks because it's too complex." Scope confirmed the same day: blocks ONLY — the Journey tab keeps its
Physique, Wellness, Goals and Exercise-data panes; the client's `/client/metrics` page (which the app reference also
calls "the Journey") is untouched. The builder's AI assistant (`services/assistant/`, Anthropic) and the planned
coach chat (`docs/COACH-CHAT-PLAN.md`) stay.

**What a coach sees change.**
- A check-in's review page has no AI card and no Regenerate. The coach reads the week and writes the reply; the reply
  box starts empty (today it starts with the AI's draft — the "auto-reply"). A check-in is `pending` until the coach
  sends a reply, then `reviewed`; the third state, "AI processed", is gone from every badge, dot and queue.
- The check-ins list row shows the date, the status and whether a reply was sent — the one-line AI preview is gone.
- The Journey tab has four panes, not five. The Blocks pane, its cards, the Set block / Trim / Delete block dialogs
  and the chart's block bands are gone. The Overview's "block ending" row is gone. The attention feed's messages no
  longer name a block.
- The apply-to-client dialog and the nutrition drawer lose their Block field. The coach picks the start date directly.
- A placed program runs its own authored length, capped at the day before the next program. Nothing stretches it to
  fill a block. A nutrition version runs to the furthest live program's last day on or after its start, else eight
  weeks, capped at the next queued version. A program move is refused by overlap with another program or by a held day,
  never by a block boundary.

**What a client sees change.** The Program tab loses the journey section (the block cards and their notes). The goal
card stays, fed by its own route. Nothing else.

---

## 1. Frame

- **Frame test (CONVENTIONS §7).** One owner per surface still holds: the review page is owned by the detail route and
  the reply route; the Journey tab by its four panes; placement by the placement route. Nothing new is drawn.
- **Data.** PROD holds AI columns on `check_ins` and rows in `client_phases`. Both are dropped (SD1, SD2); the owner
  exports them first if wanted (§9). `audit_logs` rows about blocks stay — the table is append-only by rule.
- **Not in this plan.** The perf work (`docs/PERF-PLAN.md`), which is re-cut against the code as this plan leaves it.
  The `*.supabase.co` CSP leftover in `next.config.mjs` (separate, harmless). Removing `check_in_exercise_highlights`
  — the client's training step and the review's highlights section still use it.

---

## 2. Target shape

### 2.1 The check-in without its AI (S1)

- **Status lifecycle:** `pending → reviewed`. `CheckInStatus` (`types/check-in.ts`), `CHECK_IN_STATUSES` and
  `UNREVIEWED_CHECK_IN_STATUSES` (`lib/constants.ts`) lose `ai_processed`; "unreviewed" is `pending`. The badge
  (`components/clients/check-ins/check-in-status-badge.tsx`), the dashboard's dot
  (`app/(coach)/dashboard/page.tsx:154-162`) and the per-client list's `?status=` validation follow.
- **Migration** (next free number, `supabase/migrations/README.md`):
  `UPDATE check_ins SET status = 'pending' WHERE status = 'ai_processed'`; `ALTER TABLE check_ins DROP CONSTRAINT
  check_ins_status_check` (its live name on DEV, read 2026-10-10) and re-add it as `CHECK (status IN ('pending',
  'reviewed'))`; `ALTER TABLE check_ins DROP COLUMN ai_summary, DROP COLUMN ai_insights, DROP COLUMN
  ai_recommendations, DROP COLUMN ai_response_draft, DROP COLUMN ai_processed_at`. `idx_check_ins_status` and
  `idx_check_ins_client_status` stay. Types regenerated (`npx supabase gen types typescript --linked > types/database.ts`).
- **Deleted whole:** `app/api/check-in/[id]/ai-summary/` (route + test), `services/ai-service.ts` (+test),
  `services/check-in-review-input-service.ts` (+test), `services/client-check-in-service.ts` (its one export is
  `triggerAISummaryGeneration`), `types/check-in-review-input.ts`, `utils/ai-analysis-format.ts`,
  `utils/ai-prompt-builder.ts` (+test), `utils/ai-prompt-day.ts`, `utils/ai-prompt-habits.ts` (+test),
  `utils/ai-prompt-sanitizer.ts`, `utils/ai-prompt-week.ts`, `utils/ai-system-prompt.ts`,
  `components/check-in/check-in-review-section.tsx` (+test — the AI card and Regenerate; the reply block
  `components/clients/check-ins/check-in-reply-block.tsx` is separate and stays), `lib/check-in/to-review.ts` (+test —
  its only consumer is the detail view's `review.clientMessage`, the AI draft), `lib/check-in-helpers.ts` (its one
  export is `getAiPreview`), `lib/validations/check-in-review.ts` (+test — the AI output's parser) and
  `lib/check-in/markdown.ts` (+test — its stripper; nothing else used it), `scripts/print-check-in-review-prompt.ts`
  and the `print:check-in-prompt` script.
- **Edited:** `services/check-in-service.ts` (`updateCheckInAISummary` and the status-promotion comment go; the
  submit's `triggerAISummaryGeneration` call goes — `app/api/client/check-ins/route.ts:315-318`),
  `lib/mappers.ts` (the four `ai*` fields), `types/check-in.ts` (`EnhancedAIData`, `EnhancedAIDataV3`, `AIInsight`,
  `CheckInReview`, `CheckInWatchItem`, `CheckInCoachAction`, the `ai*` fields), `lib/validations/check-in.ts`
  (`aiSummaryRequestSchema`), `lib/rate-limit.ts` (`aiRateLimit` and the `"ai"` tier in
  `lib/require-client-auth.ts` — no route passes it; the builder assistant has its own limiter, confirm by grep),
  `components/clients/check-ins/check-in-detail-view.tsx` (no review section, no `toCheckInReview`; the reply block
  gets no draft), `hooks/use-check-in-detail-data.ts` (the regenerate refresh), `components/clients/check-ins/check-ins-tab-content.tsx`
  (the `aiPreview` line; SD3), `app/api/client/check-ins/[id]/route.ts` (the "AI fields are coach-only" comment),
  `scripts/seed/generate.ts:926-940` (statuses weighted over `reviewed`/`pending`; no AI columns) and
  `scripts/seed/model.ts` (`aiReviewText` and its comment), `scripts/check-in-copies-read-proof.ts` (step 3 "gives the
  AI the same habits" and its two `utils/ai-prompt-*` imports go; steps 1–2 stay), `scripts/check-in-sent-snapshot-proof.ts`
  (the prompt recording in steps 2 and 4 goes; the frozen-copy proof stays), `package.json` (`openai` removed),
  `next.config.mjs` (`https://api.openai.com` out of `connect-src`), `README.md` and CONVENTIONS §15 (`OPENAI_API_KEY`).
- **Kept:** `check_in_exercise_highlights` and `components/check-in/exercise-highlights-section.tsx`, every other
  `components/check-in/*` file (the wizard's steps and the review's sections), `ANTHROPIC_API_KEY` and
  `services/assistant/**`.

### 2.2 Blocks become inert (S2a) — nothing reads a block, the Blocks pane still exists

Every consumer outside the blocks' own folder stops depending on them, with the gates green, so S2b is a pure delete.

- **The window caps.** `services/program-event-walk.ts resolveWindowCap` reads only `getNextPlanStartCap`;
  `stretchesToCap` is gone and `resolvePlacementWindowEnd` returns the program's own end capped at the next plan (SD4).
  `WindowCap.source` loses `"block"` and `"next_block"`. `expandProgramToWindow`'s repeat-to-fill stays only if
  another caller needs it (`knip` decides; the placement no longer repeats). `services/nutrition-plan-service.ts
  resolveNutritionPlacementEnd`: the furthest live program's end on or after `start`, else
  `NUTRITION_PLACEMENT_FALLBACK_DAYS`, capped at `getNextNutritionVersionStartCap` (SD5). `services/plan-edit-service.ts`
  takes the simplified cap unchanged.
- **The clears.** `services/nutrition-plan-clear-service.ts` and `services/training-plan-clear-service.ts` lose their
  optional block-window parameter and the block prose; `clearNutritionPlanById` and
  `app/api/clients/[id]/nutrition/[planId]/route.ts` go (their only caller is the block card; the Nutrition tab's
  delete is `DELETE /api/clients/[id]/nutrition`). `app/api/clients/[id]/training/[planId]/route.ts` DELETE stays
  (the training hero's "Delete plan").
- **Messages and rows.** `lib/prescription-triggers.ts` and `lib/attention-feed-helpers.ts` lose `BlockWindow` and the
  block naming (the no-block wording already exists, "with none, or with none covering"); `services/attention-feed-service.ts`
  drops step 10 (the blocks read). `services/client-overview-brief-service.ts` drops `deriveBlockEnding` and `listBlocks`;
  `types/coach-brief.ts` loses `BlockEnding`; `components/clients/overview/needs-attention-section.tsx` and
  `components/clients/client-overview-tab.tsx` lose the `blockEnding` row and the `{ journey: "blocks" }` address.
- **The two setup surfaces.** `components/training-library/apply-to-client-dialog.tsx` and
  `components/clients/nutrition/builder/nutrition-settings-form.tsx` (through `hooks/use-nutrition-builder.ts` and
  `drawer-form-body.tsx`) lose the Block field and `BlockStartPicker`; the start date is a plain date field with the
  same floor the picker's "—" option carried (`buildBlockStartOptions`' `floor`), so a coach can place from today or
  any later day (SD6). `preselectedBlockId` / `roundTripBlockId` props go.
- **The round trip.** `hooks/use-journey-round-trip.ts` and `hooks/use-journey-focus-block.ts` and their callers in
  `components/clients/training/builder/training-plan-builder.tsx` and
  `components/clients/nutrition/builder/nutrition-plan-builder.tsx` (`journeyReturnParams`, `returnBlockId`) go; a
  save stays on the tab it was made on.
- **The invalidations.** Every `useClearBlockFacts()` call goes: `training-plan-hero.tsx`, `plan-hero-line.tsx`,
  `training-builder-right-panel.tsx`, `training-calendar-view.tsx`, `plan-editor-overlay.tsx`, `nutrition-plan-builder.tsx`,
  `apply-to-client-dialog.tsx`, `use-nutrition-builder.ts`. The other invalidations those success paths make are untouched.
- **The chart.** `components/clients/metrics/metric-pane.tsx`, `metric-progression-section.tsx` and
  `metric-trend-chart.tsx` lose `blockBands`, `showBlocks` and `onToggleBlocks`; the Journey's "show blocks" toggle goes.
- **The client's Program tab.** `app/client/program/page.tsx` drops `JourneySection`; the goal card reads
  `GET /api/client/goal` (SD7): `app/api/client/journey/route.ts` and `services/client-journey-service.ts` become
  `app/api/client/goal/route.ts` and `services/client-goal-wire-service.ts`, answering `{ goal }` with the readings the
  card's progress chip needs (`getCurrentMeasurements`, `getReadingsOnDay(goal.startsOn)`) and nothing else;
  `types/client-journey.ts` becomes `types/client-goal-wire.ts` holding the goal type only; `types/nutrition-plan-notes.ts`
  goes with `currentBlockNotes`; `listNutritionPlanNotesInRange` goes with it. `CLIENT-APP-REFERENCE.md` names the route.
- **Scripts.** `scripts/perf-baseline.ts` drops the `getBlockFacts` case and the `client_phases` fixture count;
  `scripts/seed-scale-client.ts` stops seeding phases; `docs/perf-baseline.md` is regenerated.
- **Constants.** `lib/constants.ts` loses `BLOCK_WEEKS_MAX`, `BLOCKS_PER_CLIENT_MAX`, `BLOCK_NAME_MAX`, the block
  sentences around `NUTRITION_PLACEMENT_FALLBACK_DAYS`, and any `AUDIT_ACTIONS` key the blocks routes record (grep).
- After S2a `grep -rn "client-blocks\|useClientBlocks\|client_phases"` outside `components/clients/metrics/blocks/`,
  `components/clients/metrics/hooks/use-client-blocks.ts`, `app/api/clients/[id]/blocks/`, `services/client-blocks-*`,
  `services/block-plan-trim-service.ts`, `lib/blocks/`, `types/client-blocks.ts` and `metrics-tab-content.tsx` finds nothing.

### 2.3 Blocks gone (S2b)

- **Deleted whole:** `app/api/clients/[id]/blocks/**`, `components/clients/metrics/blocks/**`,
  `components/clients/metrics/hooks/use-client-blocks.ts` (+test), `services/client-blocks-service.ts` (+test),
  `services/client-blocks-facts-service.ts` (+test), `services/block-plan-trim-service.ts` (+test),
  `types/client-blocks.ts`, `lib/blocks/**` — after moving `inclusiveDays` and `weeksSpanned` from
  `lib/blocks/block-chain.ts` to `lib/date-helpers.ts` for `services/library-placement-service.ts`, their only
  surviving caller — and `components/client-portal/program/journey-section.tsx` (+test).
- **The Journey tab:** `components/clients/metrics/metrics-tab-content.tsx` loses the Blocks pane, `JourneySubtab`
  loses `"blocks"` (an old `?journey=blocks` bookmark falls back to `body` through `isJourneySubtab`, as any unknown
  value does today), and the pane bar shows four panes.
- **Migration** (next free number): `CREATE OR REPLACE FUNCTION move_training_plan_atomic` from
  `supabase/migrations/177_move_training_plan_atomic.sql` and `move_training_events_atomic` from
  `179_several_sessions_a_day.sql` (their latest definitions; 150 is superseded), each with the "A block the new
  dates meet" clause removed (`177:140-157`, `179:266-283`) and the `block:start:%` / `block:end:%` exceptions gone with
  it, then `DROP TABLE public.client_phases`. The TypeScript that mapped those two exceptions to a toast goes with
  them (grep `block:start` / `block:end`). Types regenerated. `npm run check:rls` after the push.
- **CONVENTIONS' reference implementation moves.** §8's invalidation passage names `useSeedClientBlocks` as the
  seed-then-set reference; S3 points it at `use-client-goals.ts`'s seed instead.
- **Left by S2a, because the Blocks pane still used them** — each goes with its last reader:
  `hooks/use-journey-focus-block.ts` (+test; named in `components/clients/url-writer-class.test.ts` and
  `components/clients/training/builder/surface-ownership.test.ts`); `journeyTripParams`, `journeyPlanTripParams`,
  `JourneyTripSurface` and the `returnTo` / `returnBlock` constants in `lib/client-tabs.ts` (+ their tests; nothing
  reads the return params since S2a); the optional block-window parameter of `clearNutritionPlansForClient` and
  `clearTrainingPlansForClient` and its prose (the block delete passes it); `ClientBlockWindow` in
  `lib/prescription-triggers.ts` (`getBlockWindowsForClients`' return type); the `BLOCK_*` and `BLOCKS_UNREADABLE`
  constants and the `block.*` audit keys in `lib/constants.ts`; `blocks-subtab.tsx` in the plan-writer lists of
  `hooks/use-client-goals.test.ts` and `hooks/use-nutrition-goal.test.ts`, and the blocks files in
  `components/dialog-subject-ownership.test.ts`; the dated probe note naming `client_phases` in
  `scripts/assert-rls.ts`. Already gone with S2a: `components/client-portal/program/journey-section.tsx` (+test),
  whose types went with the journey route.

### 2.4 Facts this plan relies on (read 2026-10-10)

1. The check-in status constraint on DEV is named `check_ins_status_check` and allows `pending`, `ai_processed`,
   `reviewed` (live catalog, `pg_constraint`). Migration 216 drops it by the column it constrains, so its name on PROD
   does not matter (§8).
2. `client_phases` is referenced by no foreign key in the migrations; two SQL functions read it (177:143, 179:269);
   `attention_dismissals` has no block alert type (blocks were context for messages, never a bound).
3. `/api/client/journey` has one caller, `app/client/program/page.tsx:104`; its `GoalCard` reads `goal.name`, `type`,
   `weightKg`, `bodyFatPercentage`, `deadline`, `description`, `readings` — the readings are not on `/api/client/me`.
4. `openai` is imported only by `services/ai-service.ts`; the assistant uses `@anthropic-ai/sdk`.
5. `check_in_exercise_highlights` is written by the client's training step and read by the review's highlights
   section and the client's own check-in detail — not AI-only.
6. `BlockStartPicker` is imported by exactly the apply-to-client dialog and the nutrition settings form; its "—"
   option's `startsOn` is the placement floor.

---

## 3. Decisions

- **SD1 The AI columns are dropped,** not kept empty: nothing will read them, and a column nobody reads is the kind of
  leftover CONVENTIONS forbids. The owner may export them first (§9).
- **SD2 `client_phases` is dropped.** Same reasoning. Block history is not shown anywhere after S2b.
- **SD3 The check-ins list row** shows the date, the status badge and "Replied <date>" or nothing. No preview line.
  (A preview of the client's own words is a later idea, not this plan's.)
- **SD4 A placed program runs its authored length,** capped at the day before the next live program. No stretching.
- **SD5 A nutrition version's end** = the furthest live program's last day on or after its start, else
  `NUTRITION_PLACEMENT_FALLBACK_DAYS` from the start; capped at the day before the next queued version.
- **SD6 The start-date field** in the apply dialog and the nutrition drawer is a plain date input with the same floor
  the picker enforced (no day before the floor; today selectable). The default is the floor.
- **SD7 `/api/client/journey` becomes `/api/client/goal`,** answering `{ goal }` with its readings. Renamed, not
  kept, because a route named for a removed concept misleads the app's author; the app does not exist yet.
- **SD8 Statuses already `ai_processed`** become `pending` in the migration, so they stay in the coach's queue.
- **SD9 Order:** after `docs/PERF-PLAN.md` P0; S1 (AI) first — small, independent — then S2a, S2b, S3; then P1.
  S2a's new code (the caps, the start field, the goal route) obeys P0's rules: the route hands its context down, the
  goal route selects what the card reads, and `check:perf` holds.
- **SD10 Ceremony.** S1 and S2b each carry a migration: gates with `check:rls`, every existing proof under `scripts/`
  that touches check-ins or placement, one independent review (destructive migrations), and an owner smoke (§7).
  S2a: gates and proofs, no review, no smoke. S3: docs only.
- **SD11 Migration numbers** are the next free number at build time. DEV is at 215; `docs/COACH-CHAT-PLAN.md` names
  216 for its own — whichever lands first takes it and the other renumbers.
- **SD12 Memory and plans.** `docs/PERF-PLAN.md` is re-cut after S3 (its head lists the entries). The owner's memory
  notes about blocks and the AI review are updated by the session that writes S3 (the note names are in §9).

---

## 4. Blast radius

- **CONVENTIONS.md:** §8 "Multi-table writes" and invalidation passages (lines ~308–340: the derived-read example is
  the blocks facts route; the seed reference is `useSeedClientBlocks`), the audit-actions list (~561, "blocks"), the
  nutrition version rule (~597, "the block covering the start"), §15 env (`OPENAI_API_KEY`, ~808 and ~895), the
  `?journey=` pane example (~389–394 stays: the param survives for the four panes).
- **ARCHITECTURE.md:** "Journey blocks (`client_phases`, migration 145)" (154–164) removed; "Nutrition & Training
  Events" and "Coach Library" lose block sentences (placement window, "the block is the length knob"); "The coach
  review surface" (1821–2155) loses the AI card, the prompt builder and `triggerAISummaryGeneration` paragraphs
  (~1891–1968) and the regenerate route (~1489); the three "check-in AI prompt" mentions in Habits (~474, ~485) and
  Training (~562); "Client Portal Architecture" loses the journey section and gains `/api/client/goal`; "External
  Consumers" / "The React Native contract" follows.
- **TECHNICAL-DEBT.md:** sweep for block and AI-review sentences; "Check-in review surface — open defects" keeps its
  non-AI items.
- **CLIENT-APP-REFERENCE.md:** line 92 "AI-powered summary generation for coaches" goes; the Program tab's journey
  payload becomes the goal route.
- **README.md:** `OPENAI_API_KEY`.
- **Tests:** every `*.test.*` beside a deleted file goes with it; tests that assert `ai_processed`, block props or the
  Block field are rewritten to the new shape, not deleted, when the component survives.

---

## 5. Verification

- **Gates** (every commit but S3): `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run check:labels`,
  `npx knip` (this plan deletes a lot; knip must come back clean, and anything it newly flags is deleted too, not
  ignored), `npm run check:service-key`, `npm run build`; `npm run check:rls` for S1 and S2b; `grep -rn "console.log"`,
  `"as any"`, `TODO|FIXME|HACK` on changed files. The set-tracker flake: rerun alone and say so.
- **Proofs on DEV** (existing scripts, rerun): S1 — `scripts/check-in-sent-snapshot-proof.ts` and
  `scripts/check-in-copies-read-proof.ts` as edited, `scripts/check-in-as-of-proof.ts`, `scripts/wire-proof-day-form.ts`;
  S2a — `scripts/goal-routes-proof.ts`, `scripts/goal-functions-proof.ts`, `scripts/nutrition-follows-goal-proof.ts`,
  `scripts/wire-proof-goals.ts`, `scripts/surplus-settings-proof.ts`; S2b — the same, plus `npm run check:rls`.
- **Residue greps** (each commit's done-when names its own): `ai_processed`, `ai_summary`, `aiSummary`,
  `ai_response_draft`, `OPENAI`, `openai` for S1; `client_phases`, `client-blocks`, `useClientBlocks`, `BlockEnding`,
  `journey-round-trip`, `block:start`, `NO_BLOCK_OPTION`, `currentBlockNotes`, `/api/client/journey` for S2b — zero
  hits outside `supabase/migrations/` (history) and this plan.

---

## 6. The commits

**How every commit runs.** Paste the prompt into a fresh session; it builds without a plan review and stops only for
the reasons it names. Read CONVENTIONS.md whole, this plan's head, §2's subsection for the commit, §3, §5 and the
entry. Delete, never comment out. A deleted file's test goes with it; a surviving file's test is rewritten to the new
shape. Nothing is added to `knip.json`'s ignore list. A deleted route's rows leave `scripts/perf-routes.ts` with it,
its baseline among them (`scripts/perf-routes.test.ts` fails on a row whose handler is gone), and `npm run check:perf`
runs with the other gates (CONVENTIONS §13). Migrations: `npx supabase db push --dry-run --linked`, then the
push once, on DEV; `check:rls` after. Commit directly to main (this plan file included), replace the entry's STATUS
with SHIPPED, the hash and the date, and hand over in plain words.

### S1 — `chore(check-in): the AI review and its draft reply are gone; a check-in is pending or reviewed`

**STATUS: SHIPPED `1ffaee98` 2026-10-10.**

Everything §2.1 lists. The migration as §2.1 (SD1, SD8). The reply block starts empty. The list row as SD3. The
`"ai"` rate-limit tier goes only if no route passes it (grep `rateLimit: "ai"`); if one does, stop and say which.

```text
Read CONVENTIONS.md (whole) and from docs/SUNSET-PLAN.md its head, §1, §2.1,
§2.4 #1 #4 #5, §3 (SD1, SD3, SD8, SD10, SD11), §5, §6 "How every commit runs"
and this entry. From docs/ARCHITECTURE.md read "Check-in System" from "The
coach review surface" to its end. Then open every file §2.1 names before
changing it, and grep the residue list in §5 for S1 to find anything §2.1
missed.

Job: commit S1 of docs/SUNSET-PLAN.md §6 — `chore(check-in): the AI review and
its draft reply are gone; a check-in is pending or reviewed`. Build exactly what
§2.1 lists, to SD1, SD3 and SD8. The migration takes the next free number
(SD11). Delete, never comment out; nothing goes into knip.json's ignore list.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a route passes the "ai" rate-limit tier, if a decision this commit
needs is blank, if building it would break a CONVENTIONS.md rule, or if a gate
fails and its root fix lies outside this commit.

Done when: the S1 residue greps in §5 return nothing outside supabase/migrations
and the plan; the four proofs §5 names for S1 pass on DEV; one independent
review of the diff has run and its blockers and should-fix items are fixed at
the root; types/database.ts is regenerated from DEV; and the gates pass: npx tsc
--noEmit, npx eslint ., npx vitest run, npm run check:labels, npx knip, npm run
check:service-key, npm run check:rls, npm run build. Migration: --dry-run first,
then push to DEV once. lsof -i :3000 first; proofs start their own next dev on a
free port, never :3000.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over in plain words: what
went, what stayed, the review's nits, the §7.1 seed (you seed it; I run the
smoke), and anything you decided that the plan did not say.
```

### S2a — `refactor(blocks): nothing reads a block — the caps, the clears, the messages, the two setup surfaces, the chart, the client's goal route`

**STATUS: PLANNED 2026-10-10.** After S1.

Everything §2.2 lists, to SD4–SD7. The Blocks pane and its routes still exist and still work at the end of this
commit; nothing outside their folders imports them.

```text
Read CONVENTIONS.md (whole) and from docs/SUNSET-PLAN.md its head, §1, §2.2,
§2.4 #3 #6, §3 (SD4, SD5, SD6, SD7, SD10), §5, §6 "How every commit runs" and
this entry. From docs/ARCHITECTURE.md read "Journey blocks", "Nutrition &
Training Events" (the placement window passages) and "Client Portal
Architecture". Then open every file §2.2 names before changing it, and run the
grep §2.2's last bullet gives to find anything it missed.

Job: commit S2a of docs/SUNSET-PLAN.md §6 — `refactor(blocks): nothing reads a
block — the caps, the clears, the messages, the two setup surfaces, the chart,
the client's goal route`. Build exactly what §2.2 lists, to SD4–SD7. The Blocks
pane, its routes, services, hooks and table are NOT touched in this commit.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: §2.2's closing grep finds nothing outside the files it exempts; the
caps have tests for SD4 and SD5 (a program longer and shorter than the gap to
the next plan; a nutrition save with and without a live program), each with a
mutation; the five proofs §5 names for S2a pass on DEV; CLIENT-APP-REFERENCE.md
names /api/client/goal and its shape; docs/perf-baseline.md is regenerated; and
the gates pass: npx tsc --noEmit, npx eslint ., npx vitest run, npm run
check:labels, npx knip, npm run check:service-key, npm run build. lsof -i :3000
first.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over in plain words: what
changed on each surface (the dialog's start field, the drawer, the Overview row,
the feed's wording, the hub), and anything you decided that the plan did not say.
```

### S2b — `chore(blocks): the Blocks pane, its routes, services and table are gone; the two move functions stop asking about blocks`

**STATUS: PLANNED 2026-10-10.** After S2a.

Everything §2.3 lists, to SD2. The migration as §2.3 (SD11).

```text
Read CONVENTIONS.md (whole) and from docs/SUNSET-PLAN.md its head, §1, §2.3,
§2.4 #2, §3 (SD2, SD10, SD11), §5, §6 "How every commit runs" and this entry.
Read supabase/migrations/177_move_training_plan_atomic.sql,
179_several_sessions_a_day.sql (the function bodies you redefine, whole) and
supabase/migrations/README.md. Then open every file §2.3 names before deleting
or changing it.

Job: commit S2b of docs/SUNSET-PLAN.md §6 — `chore(blocks): the Blocks pane,
its routes, services and table are gone; the two move functions stop asking
about blocks`. Build exactly what §2.3 lists, to SD2. The two functions are
redefined from their LATEST bodies with only the block clause removed; the
migration takes the next free number (SD11). Delete, never comment out; nothing
goes into knip.json's ignore list.

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a decision this commit needs is blank, if building it would break a
CONVENTIONS.md rule, or if a gate fails and its root fix lies outside this commit.

Done when: the S2b residue greps in §5 return nothing outside supabase/migrations
and the plan; the Journey tab's pane bar test shows four panes and ?journey=blocks
falls back to body; scripts/goal-routes-proof.ts, scripts/goal-functions-proof.ts
and a move of a program over another program's window (today's overlap refusal)
still pass on DEV; one independent review of the diff has run and its blockers
and should-fix items are fixed at the root; types/database.ts is regenerated
from DEV; and the gates pass: npx tsc --noEmit, npx eslint ., npx vitest run,
npm run check:labels, npx knip, npm run check:service-key, npm run check:rls,
npm run build. Migration: --dry-run first, then push to DEV once. lsof -i :3000.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over in plain words: what
went, the review's nits, the §7.2 seed, and anything you decided that the plan
did not say.
```

### S3 — `docs(sunset): ARCHITECTURE, CONVENTIONS, TECHNICAL-DEBT, the app reference and the README describe the platform without the AI review or blocks`

**STATUS: PLANNED 2026-10-10.** After S2b. Docs only; current shape only (a removal leaves no sentence behind).

```text
Read docs/SUNSET-PLAN.md whole, then CONVENTIONS.md whole, docs/ARCHITECTURE.md
whole, TECHNICAL-DEBT.md whole, CLIENT-APP-REFERENCE.md whole, README.md, and
`git log --oneline -4`.

Job: commit S3 of docs/SUNSET-PLAN.md §6 — `docs(sunset): ARCHITECTURE,
CONVENTIONS, TECHNICAL-DEBT, the app reference and the README describe the
platform without the AI review or blocks`. Docs only, to §4: every sentence
about the AI review, the draft reply, the ai_processed state, blocks,
client_phases, the Block field, the journey section or the journey route goes
or is rewritten to what the code now does; CONVENTIONS' seed-then-set reference
becomes hooks/use-client-goals.ts; nothing says "used to be". The owner's memory
notes are not in this repo — list in the handover which of them this commit
makes stale (§9 names them).

You have my go: don't show me a plan and don't wait for my review. Stop and ask
me only if a claim you must write is not true of the code at HEAD.

Done when: `grep -rn -i "ai review\|ai_processed\|ai summary\|regenerate\|client_phases\|journey block\|block field\|blockEnding\|aiRateLimit\|ai_insights"`
over the five documents returns nothing, every sentence you added names code
that exists at HEAD (opened, not assumed), and the stale-memory list is in the
handover. No gates run for a docs-only commit.

Then commit directly to main (this plan file included), replace this entry's
STATUS with SHIPPED, the hash and the date, and hand over: what changed in each
document, one line each.
```

---

## 7. The smokes

The session seeds; the owner runs the steps at `localhost:3000`. One action per step.

### 7.1 A check-in without its AI (after S1)

Seed under your coach: "Smoke · sunset check-in", active, a program this week with one logged session, two logged days,
next check-in due today; and a second client "Smoke · old review" with a check-in that was `ai_processed` before the
migration (the seed inserts it as `pending` with a coach_response of null — the state the migration leaves).
1. Sign in as Smoke · sunset check-in, open `/client/check-in`, fill the steps, submit. "Check-in sent". Nothing
   waits on a model; the success card shows at once.
2. As your coach: the bell shows 2 unreviewed. The dashboard's check-ins dots are amber for both.
3. Open Smoke · sunset check-in → Check-ins. The row shows today's date and a Pending badge, no preview line. Open it:
   the week grid, the ribbon, the highlights, the habits and wellness sections, and the reply box, empty. No AI card,
   no Regenerate anywhere on the page.
4. Type a reply, Send. The badge reads Reviewed; the row reads "Replied today"; the bell shows 1.
5. Open Smoke · old review's check-in: Pending, reply box empty, same page shape. Send a reply: Reviewed.
6. As the client, open `/client/check-in/<id>`: the coach's reply shows; nothing about an AI.

### 7.2 A platform without blocks (after S2b)

Any client of yours with a program placed and a nutrition version; the session reseeds "Smoke · sunset check-in"
with a 4-week program from last Monday and a second 4-week program queued after it.
1. Open the client's Journey tab: four panes (Physique, Wellness, Goals, Exercise data). The chart has no "show
   blocks" toggle. `?journey=blocks` in the address bar lands on Physique.
2. Overview: the Needs-attention list has no "block ending" row; the rest is as before.
3. Training tab → Plans → apply a library program from the tray: the dialog has a start-date field and no Block field;
   yesterday is refused, today is allowed. Apply from next Monday: the program runs its own length (the hero's dates
   equal start + its weeks − 1 day), not stretched.
4. Apply a second program starting inside the first's window: refused with today's overlap wording.
5. Move the first program's start by a week with the hero line's control: it moves; no block wording appears.
6. Nutrition tab → Generate targets from today: the drawer has no Block field; the version's end is the queued
   program's last day (the furthest live program), shown on the hero.
7. As the client, `/client/program`: the goal card shows; there is no journey section; the training and nutrition
   cards are as before.

---

## 8. DEV first, then PROD

- S1's and S2b's migrations land on DEV in their commits. PROD takes them with the Better Auth switch
  (`docs/BETTER-AUTH-PLAN.md` §8.2) in migration-number order, before `docs/PERF-PLAN.md`'s functions; the owner runs
  the push (`--dry-run --linked --project-ref etezzztgafcotyahgijk` first). Migration 216 drops the status CHECK by
  the column it constrains, so its name on PROD needs no check. One read on PROD before the push:
  `select proname from pg_proc where prosrc ~ 'ai_(summary|insights|recommendations|response_draft|processed)'`
  returns nothing. A database function is not tracked as depending on a column, so `DROP COLUMN` under one that
  reads it succeeds and the function breaks when called; a view or a policy that reads a column makes the drop
  fail, which is safe. §9's export, if wanted, comes first.
- Undo: `git revert` of S1/S2a/S2b restores the code, but the dropped columns and table are gone with their data;
  that is what §9's export is for.

---

## 9. What the owner does

1. Before S1 on PROD (not DEV): if you want the AI reviews' text kept, export it once:
   `npx supabase db query --linked --project-ref etezzztgafcotyahgijk "select id, client_id, created_at, ai_summary, ai_insights, ai_recommendations, ai_response_draft from check_ins where ai_summary is not null"`
   and save the output. Same for `client_phases` before S2b: `"select * from client_phases order by client_id, starts_on"`.
2. Run §7.1 after S1 and §7.2 after S2b.
3. After S3, re-cut `docs/PERF-PLAN.md` (its head lists the entries) — or hand that to me.
4. Memory notes this plan makes stale, for the session that updates them: "Blocks may be retired", "Client Goals +
   Blocks" (the client-page URL contract loses the blocks pane), "Check-in frozen-record brief" (the AI review seeds),
   "DEV seeds" (the AI review seed line), "AI focus = business, not longitudinal" (the check-in AI is gone, the
   assistant stays), "Overview v2" (if it names the block-ending row), "Coach perf pass — Tier 1" (the block facts case).
