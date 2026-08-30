# Coach check-ins — execution plan

**Status: IN PROGRESS — C0-C5 ALL shipped, smoked and CLOSED. C6 was SPLIT into C6a (schema + wire + server, SHIPPED) and C6b (the two UI surfaces, SHIPPED — owner smoke owed for both). STATUS blocks under §5.**
Built from a full read of the check-in subsystem (every route, service,
component, hook, migration, test and doc that touches `check_ins`), followed by an
adversarial verification pass. Where a claim below carries a `file:line`, it was
re-read this session; where it carries only a file or function name, the line
numbers drifted during verification and the executor must grep at execution time
(memory rule: never trust a ledger's line numbers as a deletion source).

Read `CONVENTIONS.md` and `docs/ARCHITECTURE.md → Check-in System` before any commit.
Owner runs every browser smoke; UI is unverified until they do.

---

## 0. The seven asks, and the three premises that turned out to be wrong

| # | Ask (owner's words, condensed) | Premise check |
|---|---|---|
| 1 | A check-in **page** replacing the modal, navigable back to the client's check-ins page; the Overview's "Review" lands ON the check-in | ✅ as stated |
| 2 | "Ready for review" takes the coach straight to that client's check-in | "Ready for review" lives on TWO surfaces. (a) The client **Overview**'s Needs-attention row "Check-in awaiting review → Review" — already about check-ins, but it drops the id it holds and only switches tabs; C1 sends it to the specific check-in. (b) The **roster**'s Attention view `?view=review` — today this filters on **intakes** (`lib/roster-views.ts:174-175` — `review ⇔ status === "awaiting_review" ⇔ onboarding_status = intake_completed`; row action → `/clients/{id}/intake-review`; empty copy "No intakes waiting"), so C2 **redefines** it as clients with an unreviewed check-in (§2.2, D2) |
| 3 | Delete the old `/check-ins/review` page; the dashboard card goes to Ready-for-review | ✅ — but its endpoint `/api/check-ins/unreviewed` is NOT dedicated (the bell and the toast listener read it) and must stay |
| 4 | Customisable check-ins: toggle client fields, custom questions, per-client form, save as reusable template, reflected in the client web app | ✅ greenfield (zero existing config code); the only DB change in the workstream |
| 5 | Denominators = the week's **targets**, not logged days | ✅ real — but only for **nutrition and habits**; training already divides by planned sessions |
| 6 | Comparison & trends | **Out of scope for this plan.** The one comparison endpoint feeds three surfaces (Comparison & Trends pane, Goal Progress pane, KPI ribbon deltas); all three are KEPT as they are and get their own definition session — they need shaving down and making legible, not deleting. §2.6 records what is known to be wrong with them so that session starts from evidence. No commit here touches them beyond carrying them onto the page intact (#1) |
| 7 | AI blocks Summary / What to watch / Coach actions / **Wins** / **Challenges** formatted the same | ❌ **Wins and Challenges are not AI output** — they render the client's typed `prs` / `challenges` (`components/check-in/client-notes-section.tsx`). Unifying their *presentation* is a render-only change; making the AI *emit* them is a contract change (D7) |

---

## 1. How check-ins work today (the deep dive)

### 1.1 Data model

`check_ins` — 39 live columns (`types/database.ts` Row). Three groups, which is exactly the
split #4 needs:

- **Client-populated** (typed into the form, stored unchanged after unit canonicalisation /
  photo upload): `notes` ("Reflection"), `weight`, `body_fat_percentage`, `waist`, `hips`,
  `chest`, `arms`, `thighs`, `photo_front`, `photo_side`, `photo_back`, `prs` ("Wins"),
  `challenges`, plus child rows in `check_in_exercise_highlights`.
- **Derived server-side at submit** (Session 6.4 — the form values for these are accepted by
  the zod schema and then IGNORED): `mood/energy/sleep/stress/soreness` (wellness averages),
  `workouts_completed` (training_events `status='completed'` in the period),
  `adherence_percentage` (a **nutrition** calorie ratio — mislabelled "Training metrics" in
  `services/check-in-service.ts`), `nutrition_days_on_target`, `nutrition_notes` (always NULL),
  `period_start/period_end` (`resolveCheckInWindow`), `period_snapshot` (written once after
  insert by `check-in-snapshot-service.ts`).
- **Coach/AI-written**: `ai_summary`, `ai_insights` (v3 `{_version:3, watchItems, themes,
  coachActions}`; v1/v2 legacy rows still readable via `lib/check-in/to-review.ts`),
  `ai_recommendations` (legacy mirror of coachActions), `ai_response_draft`, `ai_processed_at`,
  `coach_response`, `coach_reviewed_at`, `response_sent_at`.

Status lifecycle: `pending` (insert) → `ai_processed` (`updateCheckInAISummary`, fired
fire-and-forget from the client POST and by the coach's Regenerate) → `reviewed`
(`updateCheckInResponse`, ONLY via `POST /api/check-in/[id]/review` with a non-empty message —
there is no "mark reviewed without a message"). **Regenerate sets `ai_processed`
unconditionally**, so regenerating on a reviewed check-in demotes it back into every unreviewed
queue (`services/check-in-service.ts` `updateCheckInAISummary`). Nothing ever moves a row back
to `pending`; a failed fire-and-forget AI pass leaves a row `pending` with no sweep (the coach
Regenerate is the only retry).

Uniqueness: partial unique index `(client_id, period_end) WHERE period_end IS NOT NULL`
(mig 156). Keyset index `(client_id, created_at DESC, id DESC)` (mig 095). RLS: enabled;
surviving policies are 005's three coach policies and 026's two client policies (no `TO`
clauses; live catalog must be confirmed with `npm run check:rls`, not from the tree).

**A second writer of `check_ins` exists and is dead**: `PUT /api/clients/[id]/metrics` with
`saveOption: "check-in"` inserts a bare row (weight/body fat only, no period, stays `pending`
forever). No UI sends `saveOption` (grep: only the schema field and the route branch). See C0.

Scheduling lives on `clients`: `next_check_in_due` (the ONE stored date, mig 154), `check_in_frequency`,
`check_in_frequency_days`, `reminder_preferences` — written only by `PATCH …/check-in-config`
(a **full-replace** of those four columns, `updateClientCheckInConfig`) and by `submitCheckIn`'s
advance. Any new per-client check-in config must NOT route through that function or it clears
the schedule.

### 1.2 Coach surfaces and entry points

- **The review surface is one Dialog**, `components/check-in/check-in-detail-modal.tsx`
  (`max-w-[90vw] … lg:max-w-[80vw]`, far outside the design SOT's Dialog ladder). Three panes
  via SegmentedControl → controlled Tabs: **Current** (KPIRibbon + Wellness/Nutrition/Training/
  Habits/ClientNotes cards + sticky `CheckInReviewRail`), **Comparison & Trends**
  (`check-in-comparison-view.tsx`), **Goal Progress** (`goal-progress-view.tsx`). It is the
  ONLY SegmentedControl+Radix-Tabs pairing in the codebase and `docs/newdesignsystem.md:673`
  names it as the reference.
- Mounted from exactly two places: the client page's Check-ins tab
  (`components/clients/check-ins/check-ins-tab-content.tsx`, selection is local `useState`, no
  URL param) and the legacy queue `app/check-ins/review/page.tsx` (legacy `AppLayout`,
  whitelisted from `check:labels`, raw `font-mono-display`).
- Data: `hooks/use-check-in-detail-data.ts` — raw `fetch` + ten `useState` slots (a pre-existing
  §7 violation) for `GET /api/check-in/[id]`, `/comparison`, `daily-logs`, `habits/logs`,
  `nutrition/plan-targets`; a window keydown listener for Escape/Arrows (fires while typing in
  the rail's Textarea).
- **Entry points**: Overview "Check-in awaiting review" row → `onTabChange("check-ins")` and
  DROPS the id it holds (`needs-attention-section.tsx`); dashboard "Unreviewed Check-ins" card
  → `/check-ins/review`, counting `ai_processed` among the last **10** of `/api/check-ins/recent`
  (under-reports vs the bell); bell rows + footer → `/check-ins/review`; dashboard "Recent
  check-ins" rows → `/clients/{id}` (no tab, no id); roster row → `/clients/{id}`.
- **Three "unreviewed" predicates coexist**: Overview brief = `status IN (pending, ai_processed)`;
  `/api/check-ins/unreviewed` (bell, toast listener, legacy page) = `ai_processed` only, ALL
  clients incl. inactive, limit 100; dashboard card = `ai_processed` within `/recent`'s 10.
- **The client page URL contract** (ARCHITECTURE "Client page tab structure", S7):
  `activeTab` seeded from `?tab=` at mount only; every cross-tab move goes through
  `handleTabChange` → `buildClientTabUrl` (`router.replace`); each tab owns a single-owner pane
  param read unconditionally (`?journey=`, `?training=`, `?nutrition=`; Journey also carries
  `?block=<id>` — a record id in a param is precedented); one-shot params are consumed from an
  effect. `app/clients/[id]/` has **no route layout**; the 3-column shell is a component
  rendered by `page.tsx`; `components/persistent-sidebar.tsx` collapses to the 52px strip only
  for `/^\/clients$/` and `/^\/clients\/[^/]+$/` and its own comment says the client-detail
  pattern "assumes tab routing uses query params, not nested routes". The one nested route
  (`intake-review`) renders the legacy `AppLayout`.

### 1.3 Client surfaces (RN contract)

`/client/check-in` is a fixed 4-step wizard (Feeling / Metrics / Photos / Training); steps 1
and 4 are read-only daily-log viewers plus free text. The form's only per-client payload is
`GET /api/client/check-in-context`, whose 10-key `data` shape is asserted byte-for-byte by
`app/api/client/check-in-context/route.test.ts` and declared frozen by ARCHITECTURE "The React
Native contract" (with `check-in-status` and `notifications`). The same route already added
`trainingEventDetails` as an "additive, optional, back-compatible" key — the precedent #4 leans
on. `POST /api/client/check-ins` = zod → gate (409 before photo upload) → uploads → canonical
units → `submitCheckIn` → snapshot → metrics dual-write → cadence stats → fire-and-forget AI.
Read-back: `GET /api/client/check-ins` (keyset, allowlist strips AI fields) and
`/api/client/check-ins/[id]` (hand-built, no AI fields). The client [id] page labels the
nutrition ratio **"Training Adherence"** and hard-codes **"/7"** beside `nutritionDaysOnTarget`.

### 1.4 The figures on the review surface (what #5 is about)

| Figure | Numerator | Denominator today | Verdict |
|---|---|---|---|
| Training (KPI + TrainingSection) | `summariseSessions` full+partial | every `training_event` in the stored period | already target-based — **no change** |
| KPI "Calories" | Σconsumed / **days logged** (avg) | full-week target / calendar days (avg) | 3-of-7-at-target reads **HIT** with "3/7 days logged" (when the plan-targets fetch succeeds) |
| NutritionSection pill | days **logged** / period days | — | "HIT · 3/7" = logged days, not on-target days |
| Stored `adherence_percentage` + AI prompt "Weekly adherence" | Σconsumed / Σtarget over **logged rows only** (`getNutritionSummaryForPeriod` passes `fullWeekTargets = undefined`) | — | 100% for the same client; the AI Summary repeats it |
| `nutrition_days_on_target` | \|consumed − target\| ≤ 50 over logged rows | none stored; never rendered coach-side (the AI prompt's no-summary fallback prints it `/7`) | — |
| HabitsSection | logs grouped by habit from `/habits/logs` | calendar days | a habit ignored all week has NO rows and **vanishes**; a mid-week habit reads x/7 |
| WellnessSection | Σ logged values | calendar days | understates a partially-logged week (no target exists — left out of #5, D5.4) |

A shipped kernel already implements the requested semantics for the Overview rails:
`services/client-adherence-service.ts` → `buildAdherenceSummary` (nutrition pct = on-target /
`dates.length`; habits eligible = active habits with `effective_date ≤ date`; `perHabit`
breakdown removed with the Signals revert and recoverable from `c7f3f8b`).

### 1.5 The comparison read path (what #6 was about — now KEPT, see §2.6)

`GET /api/check-in/[id]/comparison` → `services/comparison-service.ts` `getCheckInComparison`
→ `{ comparison, goalProgress, chartData }`. THREE consumers, all through the one fetch in the
detail hook: the Comparison & Trends pane, the Goal Progress pane (`goal-progress-view.tsx` +
`weight-goal-card` / `body-fat-goal-card` / `goal-deadline-card` / `nutrition-regeneration-banner`),
and the KPI ribbon's Weight/Body-fat "vs previous week"/"vs start" deltas. Orphan chain if the
service goes: `utils/comparison-utils.ts`, `lib/check-in/goal-pace.ts`, `getPreviousCheckIn` +
`getFirstCheckIn` (`check-in-service.ts`), `prepareChartData` (`lib/check-in-utils.ts`),
`shouldShowRegenerationBanner` (`utils/nutrition-helpers.ts`), `trend-sparkline.tsx`, six
exported types in `types/check-in.ts` (`TrendDirection` must SURVIVE — six other importers),
and `getBodyMetricsHistory`'s `export` keyword becomes in-module-only (knip will report one
new line). The Comparison pane's "Adherence" row mixes two metrics (stored nutrition series,
last point overwritten with training pct).

### 1.6 The AI blocks (what #7 is about)

One OpenAI call (`services/ai-service.ts`, gpt-4o, 25s timeout) returns the v3 JSON
`{summary, watchItems[{type,text}], themes[], coachActions[{priority,text}], clientMessage}`,
zod-validated (`lib/validations/check-in-review.ts`, fallback review on any failure), fanned
out over four columns. Rendered in `check-in-review-rail.tsx` (Summary = teal-wash card + prose;
What to watch = bare div + icon rows + theme chips; Coach actions = bare div + white cards with
`border-l-4` + uppercase priority word) and `check-in-share-card.tsx` (Share with client =
teal-wash card, the ONLY `whitespace-pre-line`, Send/Edit/Copy, retired `hover:bg-[#0f766e]`).
Wins/Challenges/Reflection are the client's text in `client-notes-section.tsx` (left column,
white card, two more label treatments). The Summary pencil edit is **never persisted**. The
Share card seeds `useState(clientMessage)` once and goes stale after Regenerate. Regenerate
ignores non-OK responses silently (a 429 from `aiRateLimit` shows nothing).

### 1.7 Tests and gates that will bite

- RN contract: `check-in-status`, `check-in-context` (exact sorted key set), `notifications`
  route tests. `check-in-context` is the one #4 must edit deliberately.
- Scan tests: `lib/check-in-week.test.ts` (every `getTrainingWeek*` caller imports the anchor;
  no hand-spelled weekday default), `services/client-energy-ownership.test.ts`.
- Total module mocks that must gain new exports: `app/api/check-in/[id]/route.test.ts`
  (check-in-service), `services/check-in-service.test.ts` (details-service, "deliberately
  total"), `services/check-in-details-service.test.ts` (date-helpers factory exports ONLY
  `calculateCheckInPeriod`), `hooks/use-check-in-data.test.ts` (`swr` mocked as `{default}` only),
  `components/clients/check-ins/check-ins-tab-content.test.tsx` (hook + modal mocks),
  `components/clients/overview/adherence-card.test.tsx` (literal `AdherenceSummary`).
- Gates: `check:labels` scans `app/` + `components/` — `components/check-in/**` and
  `components/clients/**` are IN scope (only `app/client/`, `components/client-portal/`, the
  legacy queue page etc. are exempt). `check:service-key` walks value imports from
  `supabaseAdmin` — any browser-shared kernel must not import it. `check:rls` reads the LIVE
  catalog. `knip` exists but is not on the §13 checklist. `@typescript-eslint/no-unused-vars`
  is WARN — a leftover import fails nothing; read the warning output.
- **SWR infinite lists cannot be invalidated by a filter-function mutate** (verified in
  `node_modules/swr` 2.3.6: the global mutate skips `$inf$` keys, per-page keys have no
  revalidator, and both check-in list hooks set `revalidateFirstPage: false`). Today's list
  refresh after Send works only because the tab holds the BOUND `mutate`. Working shapes:
  `mutate(filter, undefined, { revalidate: false })` to clear the page caches so the next mount
  refetches, or drop `revalidateFirstPage: false`. `useAllClientCheckIns` (Journey) shares the
  same page keys.

---

## 2. Decisions and designs, per ask

### 2.1 #1 — the check-in page

**Recommended: an in-tab detail addressed by a single-owner pane param.**
URL `/clients/{id}?tab=check-ins&checkIn=<checkInId>`; the Check-ins tab renders
`CheckInDetailView` instead of the list when the param is present; an in-content back row
("← Check-ins", the sidebar back-row grammar) calls `onTabChange("check-ins", { checkIn: null })`.

Why this and not a nested route (`/clients/[id]/check-ins/[checkInId]`), which the analysis
first recommended:

| | Pane param (recommended) | Nested route |
|---|---|---|
| Shell | free — the tab already lives in the 3-column shell | `persistent-sidebar.tsx` needs a new `COLLAPSED_SHELL_PATTERNS` regex and its "not nested routes" note rewritten; otherwise the 80px sidebar renders under the 200px client sidebar |
| Sidebar tabs | unchanged | `ClientSidebar` tabs are `onClick` buttons; `SectionSidebarTab` documents that URL-addressed tabs MUST be real `<Link>`s → an href mode threaded through `ClientDetailLayout` |
| Back | in-content row | re-target the sidebar arrow (`backHref`/`backLabel` props); below `lg` the sidebar is `hidden`, so no exit at all |
| List refresh after Send | the detail is inside `CheckInsTabContent`'s tree → the tab's BOUND infinite `mutate` still works (today's mechanism) | needs the infinite-cache clearing trick (§1.7) or a stale badge on return |
| URL contract | one new single-owner param (`checkIn`), same class as Journey's `?block=<id>` | first nested 3-column route; ARCHITECTURE needs a new paragraph; page test must mock `IntakePanelProvider`, the bell, the invite dialog |
| Browser Back | `router.replace` like every pane change → Back leaves the client page (offer a `push` variant, D1.2) | native history |
| Deep links | `checkInReviewUrl()` builds the query form; fresh mounts from roster/bell/dashboard resolve on first render (the dashboard feed already does this) | resource path |

From the coach's seat both are "a page": the content area is replaced wholesale, the URL is
shareable, back is one click. The pane form is the one the codebase was built for.

Design of the view (`components/clients/check-ins/check-in-detail-view.tsx`, coach folder per
§6): the modal body lifted out of the Dialog **with its three panes intact** (SegmentedControl
driving controlled Tabs — the pattern `docs/newdesignsystem.md:673` names; re-point that
reference to the view file in the same commit) — header row (back row · client name · mono
date-range / submitted / `N/M days logged` meta; the modal's `formatDateRange` /
`formatSubmittedDate` move with it or knip reports two orphans), the SegmentedControl, then per
pane: Current = KPIRibbon + `[1fr_380px]` grid with the sections and the sticky rail; Comparison
& Trends and Goal Progress = carried over verbatim (their redesign is a separate session, §2.6).
Drop the X, the prev/next chevrons and the window keydown listener (D1.3). Add a **client-id guard**: the hook fetches daily-logs/plan-targets by the URL's
client id while the check-in comes by id, and the API only rejects a FOREIGN coach — a coach's
own other-client id in the URL would pair mismatched data; render the error state instead.
`onDone` (after Send): bound `mutate()` of the tab list + the `/api/check-ins` area invalidator
(C0) → `onTabChange("check-ins", { checkIn: null })`.

URL owner: `checkInReviewUrl(clientId, checkInId)` in `lib/client-tabs.ts` (beside
`buildClientTabUrl`; single owner like `rosterViewUrl`; never added to
`lib/attention-alert-destinations.ts`, whose comment says the check-in row owns that destination).
Consumers: Overview row (`onTabChange("check-ins", { checkIn: id })` — the same shape as the
block-ending row), roster (#2), bell rows (#2), dashboard "Recent check-ins" rows (#3, optional).

### 2.2 #2 — "Ready for review" on the roster

**Recommended: redefine the `review` view as "clients with an unreviewed check-in".**
The intake queue keeps living on Onboarding-view rows (the `/intake-review` Review link is
unchanged), the dashboard `PendingIntakeBanner` and the floating intake panel. This **reverses
the 2026-08-22 roster decision** (commit `a1e875a`; memory `project_clients_roster_redesign`)
and is flagged as D2. The alternative (union: intakes ∪ check-ins under one label) sums two
unrelated queues and makes the row action branch on why the row is there — rejected.

Mechanism — exactly how `daysOverdue` is threaded today: `hooks/use-roster.ts` calls
`useUnreviewedCheckIns()` (already cached app-wide by the bell + toast listener — zero new
requests), builds `Map<clientId, first row>` (the route orders newest-first), stamps
`unreviewedCheckIn: { id, submittedAt } | null` onto `RosterRow` (one constructor, so no cascade),
folds the third fetch into `isLoading`/`isError`/`refresh`. Predicate: `status !== "inactive" &&
unreviewedCheckIn !== null` (the endpoint has no active filter and an inactive client's page
dead-ends). Row: always-visible **"Review check-in"** link (`checkInReviewUrl`, `ROW_BUTTON_CLASS`
+ `FOCUS_RING`); in the review view the row click goes to the check-in too; the sub-line reads
"check-in awaiting review" from `unreviewedCheckIn.submittedAt` (NOT `lastCheckInDate`, which is
the newest check-in of ANY status), lateness keeps precedence. Empty copy → "No check-ins
waiting". Stat-band cell: comment AND `actionLabel` ("View clients ready for review" is an
sr-only string) updated. `roster-row.tsx` is already 251 lines — extract its three date
formatters to stay under the guideline.

**Nav badge** (`hooks/use-client-attention.ts`, callers `sidebar-nav.tsx` + `collapsed-icon-strip.tsx`):
`overdue + DISTINCT ACTIVE clients with an unreviewed check-in` — NOT `useUnreviewedCheckIns().total`,
which counts check-ins across all clients incl. inactive and would disagree with the sidebar
count (the exact disagreement `a1e875a` removed). The pending-intakes poll leaves the badge;
`/api/coach/pending-intakes` stays (banner + two inline mutates). Stale comment at
`services/client-intake-service.ts` (the "Ready for review" sentence) rewritten.

**Which "unreviewed"** (D2.2): recommend ONE constant `UNREVIEWED_CHECK_IN_STATUSES =
["pending", "ai_processed"]` in `lib/constants.ts` (derived from `CheckInStatus`) used by the
brief, `/api/check-ins/unreviewed`, and the dashboard count. A submitted check-in must never be
invisible to every coach queue because an AI pass failed; the review page shows the Regenerate
control for a `pending` row. Side effect: the toast listener fires at submit time (before the AI)
— acceptable. Coach-created metric check-ins would also enter the queue, which is why C0 deletes
that dead writer first.

### 2.3 #3 — delete the legacy queue

Delete `app/check-ins/` (rm -r), the `"/check-ins"` entry in `middleware.ts` `trainerRoutes`
(matcher is exact-or-prefix, nothing else), the whitelist entry in
`scripts/check-labels-whitelist.ts`, and `PageHeader.backHref` (+ its `Link`/`ArrowLeft` imports —
the deleted page was its only caller; knip does not report unused props). Keep
`/api/check-ins/unreviewed` (bell, listener, roster after #2) and `/api/check-ins/recent`
(dashboard "Recent check-ins" list). Dashboard card → `rosterViewUrl("review")`; bell footer →
`rosterViewUrl("review" | "overdue")` (its `"/clients?view=overdue"` literal already violates
the single-writer rule — fix and name it); bell rows → `checkInReviewUrl` (done in C2).
**Card count**: switch from "ai_processed within the last 10 of /recent" to the distinct-client
count the roster view shows (same map as the badge) — a link whose number and destination
disagree is a defect, not a feature (D3.1). No redirect from the old URL (owner said completely
removed; no users). After deletion a client-role hit on `/check-ins/review` falls through to the
coach 404 (middleware has only two role branches) — harmless.

### 2.4 #4 — customisable check-ins

**Data model (migration 157 — five tables, additive, no prod re-probe needed):**

```sql
-- The coach's question bank. One row per question, edited IN PLACE: rewording a question
-- updates every form that asks it and the label above every past answer. Never hard-deleted
-- once answered (answers RESTRICT) — archive instead.
CREATE TABLE check_in_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id     uuid NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  prompt       text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 300),
  answer_type  text NOT NULL DEFAULT 'text' CHECK (answer_type IN ('text')),   -- the seam for scale/yes-no later
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON check_in_questions (coach_id, created_at DESC);

-- A form. client_id NULL = a reusable template in the coach's library; NOT NULL = that
-- client's own form (at most one). No row for a client = today's full form.
CREATE TABLE check_in_forms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id    uuid NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  client_id   uuid REFERENCES clients(id) ON DELETE CASCADE,
  name        text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_in_forms_template_named CHECK (client_id IS NOT NULL OR name IS NOT NULL)
);
CREATE UNIQUE INDEX check_in_forms_one_per_client ON check_in_forms (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX ON check_in_forms (coach_id, created_at DESC) WHERE client_id IS NULL;   -- the template list

-- Which BUILT-IN client-populated fields a form asks. Row present = enabled.
CREATE TABLE check_in_form_fields (
  form_id    uuid NOT NULL REFERENCES check_in_forms(id) ON DELETE CASCADE,
  field_key  text NOT NULL CHECK (field_key IN (
    'notes','weight','body_fat','waist','hips','chest','arms','thighs',
    'photo_front','photo_side','photo_back','exercise_highlights','prs','challenges')),
  PRIMARY KEY (form_id, field_key)
);

-- Which questions a form asks, in what order, and whether each is currently on.
CREATE TABLE check_in_form_questions (
  form_id      uuid NOT NULL REFERENCES check_in_forms(id) ON DELETE CASCADE,
  question_id  uuid NOT NULL REFERENCES check_in_questions(id) ON DELETE CASCADE,
  position     integer NOT NULL CHECK (position >= 0),
  enabled      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (form_id, question_id),
  UNIQUE (form_id, position)
);

-- The client's answers. One row per (check-in, question); the question row carries the prompt.
CREATE TABLE check_in_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id  uuid NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  question_id  uuid NOT NULL REFERENCES check_in_questions(id) ON DELETE RESTRICT,
  answer       text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 2000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (check_in_id, question_id)
);
CREATE INDEX ON check_in_answers (question_id);   -- "how did answers to Q trend" and the RESTRICT check

-- All five: ENABLE ROW LEVEL SECURITY with NO policies; GRANT ALL … TO service_role (CONVENTIONS §8).
-- updated_at managed in app code (no trigger — matches migrations ≥ 100).
```

Why this shape: the question is the entity (rename once, everywhere; archive, never delete;
per-question analytics is an index scan on `check_in_answers.question_id`); the form is the
entity a client or a template owns; membership, order and on/off are the join row; built-in
fields are a fixed 14-key enum so presence-in-a-join-table is the normal form. **Library
semantics stay copy-based** (ARCHITECTURE: templates are never referenced live): "Save as
template" copies the form row + both child tables with `client_id = NULL`; "Apply a template"
copies them back onto the client's form. The join rows are copied; the **questions are shared**.
No column is added to `clients` or `check_ins` (CONVENTIONS §8 "Data modelling"). If wording
history per answer is ever wanted, it is a `check_in_question_versions` table, not a snapshot
column — the seam is `answer_type` + `updated_at`.

**Write path:** the form save touches three tables, so it is one RPC,
`save_check_in_form_atomic(p_coach_id, p_client_id, p_fields text[], p_questions jsonb)`
(upsert the form row, replace both child tables inside one transaction — the
`create_nutrition_plan_atomic` precedent; optional params `DEFAULT NULL` + `COALESCE` in the
body per the RPC memory rule; `GRANT EXECUTE … TO service_role`). Question CRUD is plain
single-row writes on `check_in_questions`. Template save/apply are two more small RPCs of the
same shape (copy form + children) — or one `copy_check_in_form_atomic(p_source, p_client_id)`
that serves both directions. The service `services/check-in-form-service.ts` (supabaseAdmin,
explicit `coachId`/`clientId` scope) owns every call; nothing here touches
`updateClientCheckInConfig` or any `clients` column.

**Read path:** `getClientCheckInForm(clientId)` = one joined read (`check_in_forms` →
`check_in_form_fields`, `check_in_form_questions` → `check_in_questions`, filtered to
`enabled AND archived_at IS NULL`, ordered by `position`) resolved to
`{ fields: string[], questions: [{ id, prompt }] }`; no form row → all 14 fields, no
questions. `check-in-context` gains that one read (constant round trips, index-covered via the
partial unique on `client_id`) — the correct price for a normalised model. Coach side:
`GET /api/clients/[id]/check-in-form` (the sheet seeds from it), `GET/POST/PATCH /api/check-ins/questions`
(bank: create, reword, archive), `GET /api/check-ins/forms` (templates), plus
`PUT /api/clients/[id]/check-in-form`, `POST /api/check-ins/forms` (save as template from the
client form), `POST /api/clients/[id]/check-in-form/apply` (apply a template). All on
`coachApiRateLimit` + CSRF on writes + `requireCoachOwnsClient(clientId, request)` /
`requireCoachAuth(request)`; audit `check_in_form.update`, `check_in_form.apply_template`,
`check_in_form_template.create`, `check_in_question.create|update|archive` (D4.6);
`captureApiError` in every catch. Every service function filters on the caller-verified scope
(`coach_id` for the bank and templates, `client_id` for the client form; a question referenced
by a form must belong to the same coach — enforce in the RPC).

**Shared pure kernel** `lib/check-in/form-fields.ts` (no `supabaseAdmin` import — the browser
form imports it): `CHECK_IN_FORM_FIELDS`, coach-facing labels, `stepsForFields(fields)`
(Feeling and Training always — their viewers are computed data; Metrics iff any of
weight/body_fat/girths; Photos iff any photo), `applyCheckInForm(body, { fields, questionIds })`
— strips every disabled client-populated value (and its unit tag), keeps only answers whose
`questionId` is in the resolved enabled set, drops empty answers, tolerates a non-array
`customAnswers` (a stale localStorage draft). Applied in the browser before
`toCanonicalCheckInSubmission` and on the server **after the gate and BEFORE the photo uploads**
(a disabled photo must never be uploaded and then discarded). Strip, don't 400 (D4.3).

**Wire (RN contract):** `GET /api/client/check-in-context` gains one additive top-level key
`form: { fields: string[] (resolved, never null), questions: [{ id, prompt }] (enabled, in
position order) }` — this edits the frozen key list (D4.1); `POST /api/client/check-ins` gains
optional `customAnswers: [{ questionId, answer }]` (max 10); `submitCheckIn` inserts the
`check_in_answers` rows **in the same request as the check-in insert** (a second statement —
record that a failure between the two leaves a check-in without answers, the §2 #13 seam; the
same shape as `insertExerciseHighlights`, which today swallows its failure — do NOT swallow
this one). The list allowlist and `/[id]` gain `customAnswers: [{ questionId, prompt, answer }]`
joined from the question row. `check-in-status` and `notifications` untouched. Until the RN app
reads `form`, mobile renders the full form and sees no custom questions — say so in the commit
and in ARCHITECTURE.

**Coach UI:** entry point = a `SectionLabel` rail over the Check-ins tab with one icon action
("Customise check-in", `SlidersHorizontal`, aria-label) — the tab owns the client's check-in
history and the Overview is documented read-only (D4.2). It opens a 780px right Sheet (dark
hero + railed white cards, the details-sheet precedent): a plain `<Select>` "Start from a
template" (applying one REPLACES the editor state — copy semantics), a **Fields** card of 14
rows (grouped visually under Measurements / Photos), a **Questions** card listing the client's
form questions in order (on/off control, reorder by move-up/down, remove-from-form) with
"Add question" opening a popover over the coach's question bank (pick an existing one or type a
new prompt — creating a bank row), and a per-row "Edit wording" that PATCHes the bank row (the
sheet says: "Changes the question everywhere it is asked"). Footer: ghost Cancel · outline
"Save as template" (BookmarkPlus → `sm:max-w-md` name dialog, the placed-session "Save to
library" precedent) · teal "Save changes" (the RPC). State in `use-check-in-form-editor.ts`; the
templates and bank reads in hooks exporting key + invalidator. After save the tab calls
`onClientUpdated` only if anything on the client record changed (nothing does now — the form
is its own read behind `useClientCheckInForm(clientId)` with its own invalidator). **The toggle
control is D4.4** — the design SOT has no Switch spec and its Segmented-control HARD RULE says
every in-card two-way toggle is `<SegmentedControl>`.

**Client web app:** step list derived from `form.fields` (`useCheckInForm` takes `totalSteps`;
the restored draft step is clamped; the third hard-coded `4` at the Next/Submit switch and
`canProceed` go too); each step hides disabled inputs; questions render as textareas at the end
of step 1 ("Your coach asked", `components/client-portal/check-in/custom-questions-section.tsx`);
the [id] read-back gains a "Your coach asked" card; the coach's Client Notes card renders each
answer as a `ReviewBlock` (post-#7). Optional but recommended: feed answers into the AI prompt
beside PRs/Challenges/Notes (D4.5).

### 2.5 #5 — denominators

**Recommended:** compute the nutrition and habit figures on the SERVER over the check-in's
STORED period with the shipped Overview kernel, and render them; leave training as is; make the
stored/AI nutrition adherence use the week's targets.

- `services/client-adherence-service.ts`: extract `getClientAdherenceForRange(clientId, start,
  end)` (the five parallel reads bounded by `endDate` instead of today; `getClientAdherence`
  delegates); restore `perHabit: HabitBreakdown[]` from `c7f3f8b` (habits select gains `name`);
  the Overview card ignores it and **must not** render it (Signals card stays rejected).
  `types/coach-overview.ts` `dates` JSDoc ("ends client-local today") corrected;
  `adherence-card.test.tsx`'s literal gains `perHabit: []`.
- `services/check-in-details-service.ts`: `resolveCheckInReportingPeriod(checkIn)` (extracted
  from `deriveSessionCompletionsForCheckIn`'s stored-period-else-createdAt fallback) and
  `getCheckInPeriodAdherence(checkIn)` → `Pick<AdherenceSummary, "dates" | "nutrition" | "habits">
  | null` (null = no resolvable period, e.g. the 56 legacy dev rows). **Training is deliberately
  NOT on this wire** — the page's training figure is `summariseSessions` (full+partial) and the
  kernel's is full-only; shipping both is the "two live conventions" §8:449 warns about.
- `GET /api/check-in/[id]` adds `periodAdherence` (additive; the envelope is the pre-existing
  bare `{ checkIn, client }` shape — note the §10 deviation, don't codify it in a new type name).
- UI: KPI **"Calories" cell becomes "Nutrition"** — `onTarget/dates.length` (whole count string
  in MONO, the shipped Counts rule), `pct%`, "days on target", `--`/"No nutrition logs" when
  `loggedDays = 0`; the inline 50/150 literals die with it. NutritionSection pill →
  `onTarget/periodDays on target` (the weekly HIT/PARTIAL/MISSED total-vs-full-week verdict
  stays — it is already target-based and answers a different question). HabitsSection →
  `perHabit` rows `completed/eligible` + one dot per date (null before `effective_date` = dash;
  hidden when never eligible; a habit ignored all week now reads 0/7). **The denominator is
  `periodAdherence.dates.length`**, never the hook's client-derived `daysDiff` (different fallback
  windows on legacy rows). The `/habits/logs` fetch and `habitLogs` state leave the hook.
- **(d) stored + AI figure:** `getNutritionSummaryForPeriod` builds `fullWeekTargets` from the
  period's per-day targets (the snapshot service's `fetchNutritionDataForPeriod` +
  `getNutritionEventsForDateRange` → `buildNutritionSummary`) and passes them as the 4th arg the
  helper already accepts. Effect: `check_ins.adherence_percentage` and the prompt's "Weekly
  target / Weekly adherence" become Σconsumed / Σweek-targets (3-of-7 → ~43%, "missed"). Cost:
  the function goes from 1 to 4 selects and the submit path reads `nutrition_logs` three times
  per submission (own read, (d), snapshot) — constant, pre-existing 2×, report it. The prompt's
  no-summary fallback `Days on target: N/7` → `/daysInWeek`. `types/weekly-nutrition.ts` comment
  and `NUTRITION-CALENDAR-IMPLEMENTATION-SPEC.md:151` ("frozen-logs-only → invariant") amended.
- Partial first week: denominator = `dates.length` (3/3, not 3/7 — `resolveCheckInWindow`'s own
  doc). Wellness averages stay calendar-day means (no target; D5.4). Nutrition "hit" source =
  the persisted `nutrition_logs.nutrition_adherence` (one definition with the Overview rails); the
  stored `nutrition_days_on_target` / AI / snapshot recompute ±50 — four spellings of "hit"
  remain, recorded, not unified here.

### 2.6 #6 — Comparison & trends / Goal Progress: KEPT, redesign deferred to its own session

The three consumers of `/api/check-in/[id]/comparison` (Comparison & Trends pane, Goal Progress
pane, KPI ribbon deltas) stay exactly as they are through this workstream; #1 carries them onto
the page untouched. What they should be **shaved down to** needs its own definition session —
the owner's verdict is that much of it is slop, ugly, and hard to understand. So that session
starts from evidence rather than impressions, here is what the deep dive found wrong or
pointless in the current panes (all verified):

- **Comparison "Adherence" row mixes two metrics**: the sparkline series is the stored
  *nutrition* `adherence_percentage` while the current value (and the last point, overwritten)
  is the *training* completed/prescribed pct (`check-in-comparison-view.tsx`).
- **14 metric-change rows** (weight, body fat, five girths, workouts, adherence, mood, energy,
  sleep, stress, soreness) each computed as `current − previous` with one `0.5` "stable"
  threshold regardless of scale (mood 1–5 vs kg) — `utils/comparison-utils.ts`
  `calculateMetricChange`.
- **`isOnTrack` defaults to `true`** when there is no rate of change, so a client with one
  check-in reads "On track" whatever the gap (TECHNICAL-DEBT `:80`); and the Goal Progress
  summary sentence derives from the weight goal alone while the body-fat card can say the
  opposite (TECHNICAL-DEBT `:78`).
- **Two clocks in one response**: `projectedCompletionDate` uses the server's `new Date()`
  while `daysRemaining` uses client-local today (`comparison-service.ts`).
- **`NutritionRegenerationBanner`** inside Goal Progress is on legacy OKLCH tokens and
  duplicates the Nutrition tab's own "Goal changed — regenerate" banner
  (`nutrition-goal-changed-banner.tsx`).
- The trend sparklines are a 4th chart library usage (`trend-sparkline.tsx`, recharts) at
  `h-8 w-20`, unlabelled, over the last 10 check-ins.
- Goal state, pace and "Since start" already live on the Overview status band; the pane
  restates them per check-in.

The redesign session should decide: which of the 14 rows survive (weight, body fat, training,
nutrition days-on-target are the obvious four), whether "vs previous check-in" or "vs start" is
the comparison that matters, whether Goal Progress is a pane at all or a strip, and whether the
sparklines earn their place. Until then: **no file under this path is deleted or restyled** by
C0–C6, and the stale doc claims about it (ARCHITECTURE "Effective goal resolution" counts SIX
direct callers today incl. `services/client-journey-service.ts`; TECHNICAL-DEBT `:518/:532`
modal row at 352 lines vs 271 real) are fixed as doc-only lines in C0.

### 2.7 #7 — one presentation for the review blocks

**Recommended: render-only**, one shared primitive `ReviewBlock` / `ReviewProse` / `ReviewList`
(label row in `LABEL_CLASS` with an optional actions slot; 13px body with `whitespace-pre-wrap`
— the coach-notes/notes-tab precedent, so client line breaks render everywhere; `<ul>` rows with
a fixed marker slot). The rail becomes ONE card "AI review" (Sparkles in the header; Regenerate
as a header icon action; sub-blocks Summary / What to watch / Coach actions / Share with client;
coach-action priority = coloured marker dot + `title`; themes chips → `NeutralChip`; one
card-level placeholder when the whole review is empty — build that test fixture directly, the
zod fallback always yields a summary). The Client Notes card renders Reflection / Wins /
Challenges through the same sub-block (Reflection's left border goes). Card shell: the SOT says
white cards on `#f4f7f6` need **no border** where spacing separates, and the newest shipped coach
card is borderless — go borderless for the new card and note the five sibling cards are owed the
same (D7.3); animation: match the siblings' framer stagger or none (D7.3). Also in this change,
each named in the commit: Send hover `#0f766e → #0b7f75` (a non-negotiable, same block); the
Share draft **resyncs after Regenerate** (key the card on the draft or effect on prop — today it
goes stale); Regenerate surfaces a non-OK response with a toast (a 429 from `aiRateLimit` is
otherwise silent); the never-persisted Summary pencil edit is **removed** (D7.4). Place the
primitive in `components/clients/check-ins/` (§6 rule of thumb for a NEW coach component) and
import it from the mixed folder; do not relocate `components/check-in/` wholesale (its
`progress-indicator` and steps are client-facing with other importers).

---

## 3. Convention conflicts — the flag register

Every rule this workstream touches or breaks. "Owner" = needs your call; "Record" = we deviate
knowingly and write it down in the commit/STATUS; "Fix" = the rule wins and the plan complies.

| # | Rule (source) | What collides | Resolution |
|---|---|---|---|
| F1 | ARCHITECTURE "Client page tab structure": every cross-tab move via `handleTabChange`; single-owner pane params are pane NAMES | #1 adds `?checkIn=<uuid>` as the Check-ins tab's single-owner param (record id, like `?block=`) and a new document paragraph | **Record** — add the param to the contract paragraph; cross-page deep links (roster/bell/dashboard) are fresh mounts and legitimately bare `<Link>`s (dashboard-feed precedent) |
| F2 | CONVENTIONS §7 "SWR for all fetching; no useState for server data; every read exports key + invalidator" | `use-check-in-detail-data.ts` is raw fetch + useState; #1/#5/#7 all touch it and each deferred the conversion to another | **Owner (D1.4)** — convert to SWR in C1 (recommended: the page is the moment) or record as accepted debt in ONE place |
| F3 | CONVENTIONS §7 area invalidators; `/api/check-ins/unreviewed` has no key builder/invalidator and the legacy page's bound mutate is today's ONLY coach-side invalidator | #3 deletes that page; #1's Send and #2's roster need the key revalidated | **Fix** in C0: `hooks/use-check-in-data.ts` exports `/api/check-ins` area key + invalidator and the infinite-list cache clear; C2's `onDone` calls both |
| F4 | Roster decision 2026-08-22 (`a1e875a`, `use-client-attention.ts` doc comment, memory): badge = overdue + intakes; unreviewed check-ins ride the bell only; "Ready for review" = intakes | #2 redefines the view and the badge | **Owner (D2, D2.1)** — reversal is deliberate; rewrite the hook comment, `client-intake-service.ts` comment, memory |
| F5 | CONVENTIONS §3 "a threshold twice → `lib/constants.ts`" | three "unreviewed" predicates | **Fix** in C0 (`UNREVIEWED_CHECK_IN_STATUSES`) — the VALUE is D2.2 |
| F6 | ARCHITECTURE "React Native contract: response shapes must not change" + `check-in-context` exact key-set test | #4 needs a per-client form config on the one payload the form loads | **Owner (D4.1)** — recommend the additive optional `form` key (route precedent `trainingEventDetails`); rewrite the contract paragraph to "additive optional keys allowed; removals/renames are not" |
| F7 | CONVENTIONS §8 migration workflow; new table = RLS deny-all + `GRANT … TO service_role`; RPC optional params `DEFAULT NULL` + `COALESCE`; §2 review triggers (new migration/routes/write path) | #4 (five tables + the atomic RPCs) | **Fix** — mig 157 as in §2.4; five-step workflow; `--dry-run` before each push (memory: push auto-confirms under non-TTY); 13-point review reported |
| F8 | ARCHITECTURE "Two writers, and only two" of `next_check_in_due`; `updateClientCheckInConfig` is a full-replace | a form save routed through it would clear the schedule | **Fix** — the form lives in its own tables and never touches a `clients` column; test pins it |
| F9 | `docs/newdesignsystem.md` Segmented-control HARD RULE: "every in-card two-way toggle is `<SegmentedControl>`"; no Switch spec exists; `components/ui/switch.tsx` is un-migrated OKLCH and pill-shaped (non-negotiable "no pill shapes") | #4's Fields card is 14 on/off rows | **Owner (D4.4)** |
| F10 | ARCHITECTURE "every editable fact lives in the details sheet; the Overview page is read-only" (`:706`) | the owner offered the Overview as an entry point | **Fix** — entry on the Check-ins tab (D4.2 if the owner insists on the Overview: an "Edit form" action on the identity row opening the SAME sheet + amend `:706`) |
| F11 | `docs/CLIENT-PORTAL-EXECUTION-PLAN.md` Session 7.4: "Do NOT add editing from this tab (global review queue owns that)" (a §16 SOT) | #1 makes the tab THE review surface, #3 deletes the queue, #4 adds a form editor there | **Record** — dated supersession line under the session record (covering review AND form editing), in C1 |
| F12 | CONVENTIONS §9 tiers (`coachApiRateLimit` for `/api/clients/*`; §2 item 1 "write routes carry coachApiRateLimit + CSRF") vs the neighbour `check-in-config` on `apiRateLimit` and the §9 shared-counter note | #4's three new routes | **Fix** — `coachApiRateLimit` on all three (new routes are not a retier; library precedent); record the shared-counter interleave (TECHNICAL-DEBT says 21 files, live count is 15) |
| F13 | CONVENTIONS §8 audit logging (blocks/goals/metrics precedent) vs the `check-in-config` neighbour that records nothing | #4's two new coach writes | **Owner (D4.6)** — recommend audit both |
| F14 | CONVENTIONS §8:449 "Adherence is not unified … do not change adherence math under the guise of an events-SOT edit" | #5 IS the adherence-math decision for the review figures | **Record** — rewrite `:449` to state the decision (check-in review: nutrition = on-target / period days, habits = completed / eligible days, served by the Overview kernel over the stored period; training numerators still split); also fix its stale `frequency_per_week` half (no live reader divides by it) |
| F15 | CONVENTIONS §8:446 "historical reads resolve from immutable snapshots, never from regenerable events" | #5 (d) reads `nutrition_events` for a past window; the existing `sessionCompletions` derivation already reads `training_events` on the same page | **Record** — consistent with the surface's existing pattern; `period_snapshot` has no habits and can be absent |
| F16 | ARCHITECTURE Overview: Signals card rejected; `habits.perHabit` removed deliberately, "in git history at c7f3f8b if a detail view ever wants them" | #5 restores `perHabit` on the shared type (rides the Overview wire unread) | **Record** — restore per the doc's own sanction; the Overview must not render it; payload growth noted in the §2 review |
| F17 | CONVENTIONS §2 "one fix per change / don't silently change working code" | #3's card-count fix; #7's hover fix, Share resync, Regenerate toast, pencil removal | **Record** — each named in its commit |
| F18 | `docs/newdesignsystem.md:673` names `check-in-detail-modal.tsx` as THE SegmentedControl-drives-Tabs reference | #1 deletes that file (the pairing survives in the new view) | **Fix** in C1 — re-point the reference to `check-in-detail-view.tsx` |
| F19 | Design SOT: white cards on `#f4f7f6` need no border; type scale authored in explicit px (13px), never `text-sm`; primary hover `#0b7f75`; chips from the Badges table | the five sibling section cards are bordered, `text-sm`, hand-rolled chips | **Owner (D7.3)** for border/animation; **Fix** 13px + hover + `NeutralChip` in the touched files; siblings owed a follow-up |
| F20 | CONVENTIONS §6 folder audiences; `components/check-in/` mixes coach review parts with client form steps | every new coach file | **Fix** — new coach files under `components/clients/check-ins/`, new client file under `components/client-portal/check-in/`; no wholesale move |
| F21 | CONVENTIONS §2 "don't break the mock contract" | six total-mock test files (§1.7) | **Fix** — each listed per commit |
| F22 | CONVENTIONS §13 commit-ready + §2 review "Not applicable is a valid answer; skipping silently is not"; the ≥5-files trigger fires on C1, C2, C3, C5, C6 | — | **Fix** — walk and report per commit |
| F23 | Memory: "invariant beats vestigial code shape"; CONVENTIONS §8 status lifecycle | the dead `saveOption: "check-in"` writer; Regenerate demoting `reviewed` → `ai_processed` | **Owner (D0.1, D0.2)** — recommend delete the writer; Regenerate keeps `reviewed` |

Docs that go stale and their single owner (so four commits don't fight over one line):
ARCHITECTURE `:760` + `:939` (`/check-in/*`, `/api/check-in/*` are NOT public — mig 142) → C0;
`:192` (weekly-nutrition-service does not clamp the first week) → C0; the missing **Check-ins
row** in the tab table (`:669-680`) → C0; `:105/:111/:113` caller counts (six today) → C0;
TECHNICAL-DEBT `:518/:532` (modal, stale 352 lines; the file is deleted by C1) → C1; `:695`
"links to the TAB that owns its data" → C1; `:724/:728` → C2; `:519-520/:536/:684/:954` → C6;
`scripts/check-labels-whitelist.ts` dead `app/check-in/` entry → C0; `CLIENT-APP-REFERENCE.md`
(RN endpoint reference) → C5 (value change) and C6 (form key, customAnswers); memory
`project_clients_roster_redesign.md` → C2.

---

## 4. Owner decisions before coding

| ID | Question | Recommendation |
|---|---|---|
| D0.1 | Delete the dead `saveOption: "check-in"` writer in `PUT /api/clients/[id]/metrics` (+ the zod field)? | Yes (C0). No UI sends it; it mints period-less `pending` rows that would enter the new queue |
| D0.2 | Should Regenerate on a `reviewed` check-in keep it `reviewed`? | Yes (C0): `updateCheckInAISummary` sets `ai_processed` only when the row is `pending`/`ai_processed` |
| D1.1 | #1 as an in-tab pane (`?tab=check-ins&checkIn=`) or a nested route? | Pane (§2.1) |
| D1.2 | Opening the detail: `router.replace` (every pane change today; Back leaves the client page) or a `push` variant so browser Back returns to the list? | `push` for the detail open only, documented as the one exception (Back-to-list is the ask) |
| D1.3 | Drop prev/next between check-ins and the Escape/Arrow window listener? | Yes — the Overview targets one check-in, the list is one click away, the listener fires while typing |
| D1.4 | Convert `use-check-in-detail-data.ts` to SWR in C1 (key builder + area invalidator; `useClient`-style) or record as debt? | Convert in C1 — it is the only commit that reshapes the read; every other commit deferred it |
| D2 | Redefine the roster's "Ready for review" as unreviewed check-ins (intake queue survives on Onboarding rows, the dashboard banner, the floating panel), or add a separate "Check-ins to review" attention view? | Redefine — "Ready for review" means check-ins on both the Overview and the roster; the intake queue keeps its three other entry points |
| D2.1 | Nav badge = overdue + distinct active clients with an unreviewed check-in? | Yes (restores "badge = the sidebar's Attention queues") |
| D2.2 | "Unreviewed" = `pending \| ai_processed` everywhere (one constant), or `ai_processed` only? | Include `pending` — a submitted check-in must never be invisible to every queue |
| D3.1 | Fix the dashboard card's count (today: `ai_processed` within the last 10) to the roster's distinct-client count in the same commit? | Yes — the card links to that number |
| D3.2 | Dashboard "Recent check-ins" rows deep-link to the check-in (`checkInReviewUrl`)? | Yes, one-line, not asked — say so |
| D4.1 | Additive `form` key on `check-in-context` (edit the frozen key list) vs a new `GET /api/client/check-in-form`? | Additive key |
| D4.2 | Entry point on the Check-ins tab (recommended) or the Overview identity row? | Check-ins tab |
| D4.3 | A submission carrying a disabled field's value: strip silently or 400? | Strip (a 400 punishes a stale client for a coach change) |
| D4.4 | Toggle control: (a) per-row `<SegmentedControl>` On/Off — rule-compliant, no new primitive; (b) author a Switch spec into the design doc + migrate `components/ui/switch.tsx` (visually changes `nutrition-surplus-settings`, `nutrition-adjust-by-tab`, `automation-rule-card` + three bare sites; needs a "no pill shapes" exemption); (c) `DropdownMenuCheckboxItem` (set-columns-menu precedent, awkward for 14+N rows) | (a) unless you want to author a Switch spec |
| D4.5 | Feed custom-question answers into the AI prompt beside PRs/Challenges/Notes? | Yes (one sanitised line per answer) — not asked; otherwise the Summary is blind to the questions you wrote |
| D4.6 | Audit-log the two new coach writes? | Yes (`check_in_form.update`, `check_in_form_template.create`) |
| D4.7 | Girths/photos: one toggle per column (14 keys) or grouped (8)? | Per column, grouped visually |
| D4.8 | Template delete/rename: not in this change (the Select only grows) | Follow-up: `DELETE /api/check-ins/forms/[id]` + destructive-confirm dialog |
| D5.1 | Partial first week denominator: `dates.length` (3/3) or always 7? | `dates.length` |
| D5.2 | Ship (d) (stored `adherence_percentage` + AI prompt on week targets) with #5? Changes the column's MEANING for new rows and the RN-visible value | Yes — otherwise the Summary says 100% under a hero saying 3/7 |
| D5.3 | Replace the KPI "Calories" cell with a "Nutrition" days-on-target cell? | Replace (the weekly kcal total/target/avg survive in NutritionSection) |
| D5.4 | Wellness averages: leave calendar-day means? | ~~Leave~~ — **SUPERSEDED 2026-08-30 (`7d9de50`)**: it was not a design choice but an arithmetic error (logged values ÷ calendar days), and it contradicted the AI summary on screen. Now the mean of each metric's own logged days. The "n/7 logged" meta was declined — the sparkline beneath already shows which days are logged |
| D6 | Comparison / Goal Progress | Settled: kept as is; own definition session later (§2.6) |
| D7.1 | Wins/Challenges: unify presentation in place (client text), or should the AI emit wins/challenges lists? | In place |
| D7.2 | Include "Share with client" and "Reflection" in the uniform treatment? | Yes, both |
| D7.3 | Card shell: borderless (SOT) with the siblings owed a follow-up, or bordered for in-modal parity? Animate like the framer siblings? | Borderless; no animation on the rail (sticky column) |
| D7.4 | Remove the never-persisted Summary pencil edit? | Remove |
| D-docs | Historical records that will keep naming the deleted queue page and the changed adherence invariant (`CLIENT-PORTAL-EXECUTION-PLAN.md` ledgers, `NUTRITION-CALENDAR-IMPLEMENTATION-SPEC.md:151`): annotate, delete shipped sections wholesale, or leave? | Leave the ledgers; amend the SPEC's `:151` invariant line in C5 |

---

## 5. Commit plan

Order breaks the dependency cycle (#1 wants #3 first, #3 wants #2 first, #2 needs #1's URL):
`checkInReviewUrl` is a valid fresh-mount deep link the moment C1 lands, so C2 and C3 follow.
#6 has no commit (§2.6). Every commit ends green on `npx tsc --noEmit` (after
`rm -rf .next` when routes were deleted), `npx eslint .` (read the WARN output for dead
imports), `npx vitest run` (re-run the flaky set-tracker test before blaming a change),
`npm run check:labels`; `knip` before/after on C1 and C3 (deletions); `check:rls` +
`check:service-key` on C6. Commit directly to `main` (memory).

### C0 — groundwork (no behaviour change except D0.1/D0.2)
- `lib/constants.ts`: `UNREVIEWED_CHECK_IN_STATUSES` (derived from `CheckInStatus`); use it in
  `services/client-overview-brief-service.ts` and `app/api/check-ins/unreviewed/route.ts`
  (also drop the route's inline literal list in `app/api/clients/[id]/check-ins/route.ts`).
- `hooks/use-check-in-data.ts`: `NO_UNREVIEWED_CHECK_INS` stable array; exported
  `checkInsQueueKey` + `useInvalidateCheckInsQueue()` (area prefix `/api/check-ins`) and
  `useInvalidateClientCheckIns(clientId)` (clears the infinite page caches with
  `mutate(filter, undefined, { revalidate: false })` — covers `useAllClientCheckIns` too);
  add `errorRetryCount/Interval` + `onError` to `useUnreviewedCheckIns`; widen the `swr` mock in
  `hooks/use-check-in-data.test.ts` (`useSWRConfig`) and pin the stable reference.
- `services/check-in-service.ts` `updateCheckInAISummary`: keep `reviewed` (D0.2) + test.
- Delete the `saveOption` branch in `app/api/clients/[id]/metrics/route.ts` and the field in
  `lib/validations/client-metrics.ts` (D0.1) + tests.
- Docs: ARCHITECTURE `:760`, `:939`, `:192`, Check-ins row in the tab table, the
  "Effective goal resolution" caller count (six direct callers today, incl.
  `services/client-journey-service.ts`, which does not compose through `toClientGoalInput`);
  remove the dead `app/check-in/` whitelist entry.
- STATUS: the new hooks have no consumer until C1 (knip line, one commit).

**STATUS — SHIPPED 2026-08-29 in `fc87902`; browser-SMOKED by the owner the same day, all clear.**

*What shipped.*
- `lib/constants.ts`: `CHECK_IN_STATUSES` (the full lifecycle) and
  `UNREVIEWED_CHECK_IN_STATUSES = ["pending", "ai_processed"]` (D2.2), both
  `as const satisfies readonly CheckInStatus[]`. Readers: the Overview brief,
  `/api/check-ins/unreviewed`, and `updateCheckInAISummary`'s promotion guard. The
  per-client list validates `?status=` against `CHECK_IN_STATUSES` through a route-local
  `isCheckInStatus` guard, so its inline literal AND its `as CheckInStatus` cast are gone.
- `hooks/use-check-in-data.ts`: `checkInsQueueKey`; `useInvalidateCheckInsQueue()` (matcher
  `/api/check-ins` — the queue plus the dashboard's `/recent`; the singular `/api/check-in/…`
  does not match); `useInvalidateClientCheckIns()` (see deviations); `NO_UNREVIEWED_CHECK_INS`;
  `errorRetryCount/Interval` + `onError` on `useUnreviewedCheckIns`. `buildCheckInsPageKey`
  now derives from one `clientCheckInsKeyPrefix`, so the key and its invalidator share a string.
- D0.2: `updateCheckInAISummary` is one conditional UPDATE (`id` + `status IN unreviewed`,
  `.select("id")`) that falls back to an AI-columns-only UPDATE when no row matched, i.e. the
  row is `reviewed`. Not read-then-write: a Regenerate racing a Send would have read
  `ai_processed` and written it over the `reviewed` that landed in between.
- D0.1: the `saveOption: "check-in"` branch, the zod field and `CheckInInsert` are deleted. The
  schema is `.strict()`, so a body carrying `saveOption` now **400s** rather than being ignored.
- `scripts/check-labels-whitelist.ts`: the dead `app/check-in/` entry (no such directory).
- Tests (+1 file, +15 cases; 304 files / 3278 tests green, from 303 / 3263):
  `use-check-in-data.test.ts` (swr mock widened to `{ default, useSWRConfig }`; stable-reference
  pin; both invalidators' accept/reject sets; a pin that the page clear reaches exactly the keys
  `useAllClientCheckIns` asks swr for), `check-in-service.test.ts` (three D0.2 cases: promote /
  keep reviewed / throw), `metrics/route.test.ts` (`saveOption` → 400, no `check_ins` write),
  `check-ins/route.test.ts` (known `?status=` passes through), NEW
  `app/api/check-ins/unreviewed/route.test.ts` (401 / no-clients short-circuit / the D2.2
  predicate scoped to the coach's client ids / 500), `client-overview-brief-service.test.ts`
  (the predicate, collected across every `check_ins` chain the service opens).
- Docs (ARCHITECTURE): "Effective goal resolution" → six direct callers, new
  `client-journey-service` bullet, `toClientGoalInput` = five of the six; the `start_date`
  measurers line (`resolveCheckInWindow` clamps `period_start`; `weekly-nutrition-service`
  reads no `start_date` — it derives its denominator from the period it is handed); the missing
  Check-ins row in the tab table; Middleware routing's public-route list (mig 142); Route
  namespaces' `/api/check-in/*` line (coach routes behind `requireCoachOwnsCheckIn`;
  `checkInRateLimit` has no live route). This file's `:3` status line.

*Deviations from the plan, and why.*
1. **A third behaviour change.** The C0 heading says "no behaviour change except D0.1/D0.2",
   but item 1 + F5 ("the VALUE is D2.2") + landmine 12 put the constant's value here, so
   `/api/check-ins/unreviewed` now returns `pending` rows: the bell and the toast listener see a
   check-in at submit time rather than after the AI pass (§2.2 calls this acceptable), and the
   legacy queue page lists `pending` rows until C3 deletes it.
2. `useInvalidateClientCheckIns()` returns `(clientId) => …` — the shape of the two §7 reference
   implementations — rather than taking `clientId` as a hook argument as the plan's text reads.
3. It has **two legs**, not only the page-cache clear: a plain `mutate(inArea)` over
   `/api/clients/{id}/check-ins` (§7: an area matcher, so a plain reader added later is covered —
   none exists today) plus the clear, which is restricted to the page-key shape (`…/check-ins?`)
   because a data-less `revalidate: false` mutate would blank a plain reader without refreshing
   it. Verified in swr 2.3.6 source: the filter loop skips `$inf$`/`$sub$` keys
   (`_internal/config-context-client-*.mjs:249`); `mutateByKey` with `data === undefined` and the
   default `populateCache` sets the page's `data` to `undefined` and skips the fetch; the infinite
   fetcher refetches any page whose cache `isUndefined` (`infinite/index.mjs:203`). A MOUNTED
   infinite reader still needs its own bound `mutate()` — C1's `onDone` calls both.
4. `CheckInInsert` (`lib/database-helpers.ts`) deleted: the dead writer was its only importer
   (grep: two hits, both in that route), so it is the deletion's residue, not adjacent tidying.
5. `CHECK_IN_STATUSES` added (the plan asked only to drop the route's inline list; this is where
   the list went) with a route-local guard rather than a shared helper — one caller.
6. Three tests the plan did not list (the unreviewed route file, the brief predicate pin, the
   per-client pass-through): D2.2 is the one behaviour change here with no prior coverage.
7. Regenerate on a **reviewed** row now costs two round trips (was one); the common path stays one.
8. The plan's expected knip line did not materialise: test files are knip entries, and every new
   export is imported by its test.
9. Plan line cites that had drifted: none of C0's — `:760`, `:939`, `:192`, `:105/:111/:113`
   were all exact today.

*§2 review — the triggers fire (a route's validation changed; 9 code files on the data flow).*
1. Write routes: the only one touched is `PUT /api/clients/[id]/metrics` —
   `requireCSRFProtection` present; it sits on `apiRateLimit`, a pre-existing tier deviation the
   §9 shared-counter note explains, unchanged here. `updateCheckInAISummary`'s callers are
   unchanged: `POST /api/check-in/[id]/ai-summary` (CSRF → `requireCoachOwnsCheckIn` → coach-keyed
   `aiRateLimit`) and the client submit's fire-and-forget pass.
2. Auth + ownership: `/api/check-ins/unreviewed` = `getAuthenticatedCoachId()` then scopes to the
   coach's client ids from `clients.coach_id` (`route.ts:23-35`); the per-client list =
   `requireCoachOwnsClient`; the metrics PUT = coach auth + `.eq("coach_id")` on both the read and
   the write. None changed. (`unreviewed/route.ts:14` does not pass `request` to the auth helper —
   pre-existing, untouched.)
3. zod before writes: the metrics PUT still `safeParse`s; the schema lost a field.
4. Tenant scope on the write: `updateCheckInAISummary` updates by `id` alone, as before — its
   routes prove ownership first; the new `.in("status")` predicate narrows, never widens.
   (TECHNICAL-DEBT H2 #3 — by-id functions without a `clientId` scope — is out of scope, §7.)
5. `check:rls`: not run — no table, column or policy changed.
6. `supabaseAdmin` writes: `updateCheckInAISummary` (authorized by its routes); the deleted
   `check_ins` INSERT was a `supabaseAdmin` write from the metrics PUT that bypassed the submit
   path's gate, period and snapshot — removed.
7. Round trips are constant: unreviewed GET 2 selects (unchanged); brief 1 (unchanged);
   `updateCheckInAISummary` 1 UPDATE for an unreviewed row, 2 for a reviewed one; the metrics PUT
   loses one conditional INSERT.
8. Batched writes: n/a — single-row UPDATEs by primary key.
9. Indexes: no new column in any WHERE/ORDER BY. Both widened predicates are covered by mig 001's
   `idx_check_ins_client_status (client_id, status, created_at DESC)`; the D0.2 UPDATE is a PK
   lookup plus a status filter. Per the migration tree — not re-probed against the live catalog.
10. Worst-case row count: `updateCheckInAISummary` = exactly 1 row (PK). The unreviewed GET
    keeps its 100-row cap; including `pending` grows the result only for a coach whose AI passes
    are failing.
11. Sequential awaits: the D0.2 fallback depends on the first statement's row count and cannot
    be parallelised; nothing else was serialised.
12. No `.catch()` returning success after a committed write was added. The metrics PUT's
    pre-existing non-blocking `body_metrics` dual-write is unchanged.
13. Two writes outside a transaction: the D0.2 fallback runs only when the first UPDATE matched
    zero rows, so there is no half-written state — either the first statement wrote everything or
    nothing and the second writes the AI columns. If the second fails the row is untouched, the
    route 500s ("Failed to generate AI summary") and Regenerate is the retry. Nothing moves a
    row out of `reviewed`, so the window between the two statements cannot change the branch.
    Not load-tested; read paths under concurrency are untested.

*Gates (real output).* `npx tsc --noEmit` exit 0 · `npx eslint .` exit 0, 162 warnings / 0 errors,
none in a touched file (all pre-existing, e.g. `app/check-ins/review/page.tsx`,
`hooks/use-check-in-detail-data.ts`) · `npx vitest run` 304 files / 3278 tests passed (no flaky
trip) · `npm run check:labels` "OK — 679 files scanned" · `npm run knip` 173 lines before and
after, the only diff being `ClientGoalRow`'s line number (41 → 39, `CheckInInsert` removed above
it) · no `as any`, no markers, no `console.log` in the touched files. No route file was deleted,
so no `.next` wipe.

*Smoke (owner, 2026-08-29) — all pass:* bell + toast fire on a `pending` check-in at submit time;
the Overview row and the bell agree on it; Regenerate on a Reviewed check-in keeps the badge and
does not re-queue it; Regenerate on a pending row still promotes; the legacy queue lists and opens
`pending` rows; `?status=bogus` still 400s and `?status=reviewed` filters; the comparison panes
render untouched; the metrics PUT 200s on both of its real gestures — a custom TDEE and "Reset to
calculated" in the details sheet. One checklist item was mis-specified: "change the current weight
in the details sheet" is impossible (read-only there), and a Physique log goes to
`POST …/metric-entries`, not this route — `PUT /api/clients/[id]/metrics` has exactly ONE live
caller, the sheet's TDEE override (`use-client-profile-edit.ts:365-367`). Smoke that route through
TDEE, nothing else.

*Still unverified.* `useInvalidateClientCheckIns` has no live consumer until C1, so its "next mount
refetches" claim rests on the swr source reading and the unit tests, not a browser run. Left stale
on purpose (outside C0's doc list): CONVENTIONS §9 still calls `checkInRateLimit` "public check-in
endpoints".

### C1 — #1 the check-in page (+ SWR conversion per D1.4)
- `lib/client-tabs.ts`: `checkInReviewUrl(clientId, checkInId)` (+ `lib/client-tabs.test.ts`);
  document `checkIn` as the Check-ins tab's single-owner param.
- `components/clients/check-ins/check-in-detail-view.tsx` (the modal body with its three panes
  and the SegmentedControl→Tabs pairing intact, back row, client-id guard, `Loader2` loading,
  hex-token error state — not the OKLCH `Card` from `page.tsx`; `docs/newdesignsystem.md:673`
  re-pointed to this file).
- `check-ins-tab-content.tsx`: reads `searchParams.get("checkIn")`; list rows → `<Link
  href={checkInReviewUrl(...)}>` (or `onTabChange` with `push`, D1.2); receives `onTabChange`
  from `page.tsx`; delete `selectedCheckInId`/`handleNavigate`/the modal mount/`useState`; tab
  test rewritten (drop the modal mock; assert the href / the param branch).
- `hooks/use-check-in-detail-data.ts`: → SWR (`GET /api/check-in/[id]` and `/comparison`
  behind hooks with key + area invalidator; daily-logs/plan-targets likewise or kept as one
  composed read — executor's call, documented), props trimmed, keydown effect deleted;
  `formatDateRange`/`formatSubmittedDate` move to the view.
- Overview: `NeedsAttentionSection` gains `onReviewCheckIn(id)` → `onTabChange("check-ins",
  { checkIn: id })` (+ its test); `client-overview-tab.tsx` threads it.
- `app/check-ins/review/page.tsx` interim: rows push `checkInReviewUrl` (row OR button — the
  Review `<Button>` sits inside the row's onClick, bubbling fires twice); modal state removed.
- Delete `components/check-in/check-in-detail-modal.tsx`.
- Docs: ARCHITECTURE tab-structure paragraph (`checkIn` param, back row, push exception), `:695`,
  Check-in System "Coach review surface"; EXECUTION-PLAN 7.4 supersession line (review AND
  form editing); `newdesignsystem.md:673` pointer; TECHNICAL-DEBT modal row (`:518/:532`).
- Smoke: Overview "Review" lands on the check-in; back row returns to the list; a pasted URL
  opens the check-in on first render; all three panes render as before; Send returns to the
  list with the badge updated; the bell count drops without waiting 30s; sidebar tab click while
  on a detail leaves you on the detail (single-owner param rides through — say so if you prefer
  it to reset).

**STATUS — SHIPPED 2026-08-29 in `1ad3971`; browser-SMOKED by the owner the same day, all clear.**

*What shipped.*
- `lib/client-tabs.ts`: `checkInReviewUrl(clientId, checkInId)` → `/clients/{id}?tab=check-ins&checkIn=<id>`,
  the single writer of the form; `?checkIn=` is the Check-ins tab's single-owner param (a record id,
  like Journey's `?block=`). Three tests.
- `components/clients/check-ins/check-in-detail-view.tsx` (234 lines): the modal body lifted with
  its three panes and the SegmentedControl → controlled-Tabs pairing intact; the header is the
  sidebar back-row grammar ("← Check-ins") over the mono meta line, SegmentedControl right; `Loader2`
  replaces three hand-rolled spinner divs; hex-token error and foreign-client states in the tab's
  own notice shape; the rail is `lg:sticky lg:top-[52px]`. The modal's title, X, prev/next chevrons
  and window keydown listener are gone (D1.3).
- `hooks/use-check-in-detail-data.ts` (228 lines, SWR — D1.4): `checkInDetailKey` +
  `useInvalidateCheckInDetail` (the area is the detail and everything under it; exact-or-child
  match so a same-prefix id cannot collide); the detail and comparison reads as module-private
  hooks; `resolveCheckInDetailWindow` / `unloggedDates` / `buildFullWeekTarget` as pure exports; the
  window's daily + habit logs through `useWellnessData`'s new explicit `range`; `plan-targets` as a
  dependent read keyed on the unlogged dates; the `isForeign` guard; `refreshDetail` for the rail's
  Regenerate. The ten `useState` slots, the raw fetches and the keydown effect are gone.
- `hooks/use-wellness-data.ts`: additive `range?: DailyLogRange | null` (`null` fetches nothing;
  `undefined` keeps the rolling default) and stable empty arrays. Both existing callers untouched.
- `check-ins-tab-content.tsx`: reads `?checkIn=` unconditionally, ahead of the list's
  loading/empty branches (a deep link opens while the list loads); rows are `<Link>`s to
  `checkInReviewUrl`; a required `onTabChange` prop (page.tsx passes `handleTabChange`); `onDone`
  = bound `mutate()` + `useInvalidateClientCheckIns(client.id)` + `useInvalidateCheckInsQueue()` +
  `onTabChange("check-ins", { checkIn: null })`.
- Overview: the awaiting-review row sends `{ checkIn: unreviewedCheckIn.id }`.
- `app/check-ins/review/page.tsx` (interim, C3 deletes it): rows `router.push(checkInReviewUrl(…))`
  on the row only; the modal mount, selection state, prev/next and `mutate` are gone.
- Deleted `components/check-in/check-in-detail-modal.tsx`.
- Tests (+2 files, +26 cases; 306 files / 3304 green, from 304 / 3278): `client-tabs.test.ts`,
  `check-ins-tab-content.test.tsx` rewritten (`next/navigation` + `next/link` mocked; the
  `use-check-in-data` mock grew the two invalidators; the view mocked — loading, empty, rows are
  links, the param renders the view, a deep link opens while loading, back row, done → three
  refreshes + the handler, Load older), NEW `check-in-detail-view.test.tsx` (loading, foreign
  guard, failure, meta line + rail, back row, pane switching, send vs regenerate), NEW
  `use-check-in-detail-data.test.ts` (window resolution incl. the `createdAt − 6` fallback,
  unlogged dates, target sums, keys, the guard fetching no context, the dependent plan read and
  its absence when every day is logged, the loading flag, the invalidator filter),
  `needs-attention-section.test.tsx` (assertion).
- Docs: ARCHITECTURE — the tab-structure paragraph (`?checkIn=`, `checkInReviewUrl`, the one push
  and why a cross-tab open stays `replace`, the back row through the handler), the Check-ins tab
  row, the Overview's "links to the tab that owns its data" clause, and a new "The coach review
  surface" subsection under Check-in System; `CLIENT-PORTAL-EXECUTION-PLAN.md` Session 7.4 dated
  supersession line (review on the tab; the queue goes in C3; form editing arrives in C6);
  `newdesignsystem.md` Segmented-control reference → the view; `TECHNICAL-DEBT.md` modal row and
  item resolved (with the successor's real line counts). This file's `:3` status line.

*Deviations from the plan, and why.*
1. **D1.2 is the same-tab open only.** List rows are real `<Link>`s (native push: Back returns to the
   list, and the URL and the mount-seeded `activeTab` still agree). The Overview's open stays the
   handler's `replace` — a push there would leave the URL on `?tab=overview` after Back while the
   visible tab stayed on Check-ins. `handleTabChange` is untouched.
2. No `onReviewCheckIn` prop on `NeedsAttentionSection`: the row calls
   `onTabChange("check-ins", { checkIn: id })`, §2.1's own wording and the block-ending row's shape;
   nothing threaded through `client-overview-tab.tsx`.
3. The modal's "`{name} – Check-In Review`" title is dropped — the sidebar names the client — and
   the back row takes its slot.
4. The context reads reuse `useWellnessData` through a new `range` option rather than a second key
   builder for the same two endpoints (CONVENTIONS §7: lift the fetch to the shared hook). It also
   gained stable empty arrays while touched (`|| []` minted a fresh array per unresolved render).
5. `useCheckInDetail` / `useCheckInComparison` are module-private: knip flagged them as unused
   exports, and only the composed hook reads them. The key and the invalidator are the exports.
6. The tab test mocks `next/link` to a bare `<a>` so the href assertion is deterministic.
7. The rail's `lg:top-[52px]` is class math against the band (`py-2` + its tallest control), not
   measured pixels — the plan's Flag 3, a named smoke item.
8. Plan line cites re-derived today: `newdesignsystem.md:673`, `TECHNICAL-DEBT.md:518/:532` and
   `CLIENT-PORTAL-EXECUTION-PLAN.md:2190` were exact; ARCHITECTURE `:695` had drifted to `:697`.

*§2 review — the ≥5-files trigger fires; largely not applicable.*
1–6 (security): no route, auth, ownership, validation, RLS or write path changed. The reads moved
from raw `fetch` to SWR against the same five coach endpoints (`/api/check-in/[id]`,
`…/comparison`, `/api/clients/[id]/daily-logs`, `…/habits/logs`, `…/nutrition/plan-targets`), each
still behind its own route chain. The one behavioural addition is a STRICTER client-side guard
(`isForeign`): a check-in whose `clientId` differs from the page's fetches no context and renders an
error — the server rule (foreign coach → refused) is unchanged. `check:rls` not run — no schema change.
7. Round trips per open are unchanged: detail ∥ comparison, then daily-logs ∥ habit-logs, then
plan-targets (only when a window day is unlogged). Re-opening a check-in in the same session is now
served from cache; the modal refetched every time.
8–10. No writes were added. After Send, the bound mutate and the two invalidators are cache
operations; the only network effect is the bell's single queue read revalidating.
11. The three stages are inherently sequential (the window comes from the check-in, the unlogged
dates from the logs); the plan-targets read is gated on `!logsLoading`, so it fires once with the
final date list rather than once per partial render.
12–13. No writes, so no partial-commit seam. Not load-tested; nothing here changes server load
shape.

*Gates (real output).* `npx tsc --noEmit` exit 0 · `npx eslint .` exit 0 — 156 warnings / 0 errors
(from 162: six died with the modal and the old hook), none in a touched file except
`app/check-ins/review/page.tsx:90`'s pre-existing `<img>` · `npx vitest run` 306 files / 3304 tests
passed, no flaky trip · `npm run check:labels` "OK — 680 files scanned" · `npm run knip` 173 → 172
lines: `FullWeekTarget` gone, one line-number shift, nothing new · no `as any`, markers or
`console.log` in the touched files. No route file was deleted, so no `.next` wipe (the modal is a
component; the legacy route stays until C3).

*Smoke (owner, 2026-08-29) — all clear:* Overview "Review" lands on the check-in; the back row
returns to the list; a pasted `?tab=check-ins&checkIn=<id>` opens on first render; all three panes
render as before; Send returns to the list with the badge updated and the bell count drops at once;
Regenerate refreshes in place; Back after a list-row open returns to the list; a sidebar round trip
keeps the open detail; the sticky rail sits below the band at `lg:top-[52px]` (deviation 7 holds as
rendered); the legacy queue row lands on the client's check-in page once; a foreign client id in
the URL shows the guard's notice.

*Still unverified.* `useInvalidateCheckInDetail` has no consumer outside its own module yet (C2/C3
may want it). The `range` option's behaviour under `useWellnessData`'s 5-second dedupe is inherited,
not measured.

### C2 — #2 roster "Ready for review" = check-ins
`lib/roster-views.ts` (+ new `roster-views.test.ts`), `hooks/use-roster.ts` (thread, fold, refresh
aggregator gains the third mutate), `roster-row.tsx` (+ new test; formatter extraction),
`roster-table.tsx` (view prop, empty copy), `roster-stat-band.tsx` (comment + `actionLabel`),
`hooks/use-client-attention.ts` (D2.1, doc comment; callers untouched), `services/client-intake-service.ts`
comment, bell rows → `checkInReviewUrl`, TECHNICAL-DEBT `:724/:728`, memory file, a first
ARCHITECTURE "Coach client roster" paragraph (views, Attention queues, what the badge counts —
today the roster has NO canonical doc home). Smoke: `?view=review` lists exactly the clients whose
Overview shows the awaiting-review row; stat-band count = sidebar count = nav badge; row click
and "Review check-in" land on the check-in; an inactive client's unreviewed check-in is absent.

**STATUS — SHIPPED 2026-08-29 in `1d2a25a`; browser-SMOKED by the owner the same day, all clear.**

*What shipped.*
- `lib/roster-views.ts`: `RosterRow.unreviewedCheckIn`, typed as the Overview's own
  `UnreviewedCheckIn` (`types/coach-brief.ts`) because it is the same fact; the pure
  `indexUnreviewedCheckIns(checkIns)` → one entry per client, the newest (the queue route
  orders `created_at DESC`, the same order + `LIMIT 1` the Overview brief uses, so the two
  agree by construction); `matchesRosterView`'s `review` case is now
  `status !== "inactive" && unreviewedCheckIn !== null`. The module header records that the
  nav badge counts through this file rather than spelling the queue itself.
- `hooks/use-roster.ts`: `useUnreviewedCheckIns()` as a third read — already mounted app-wide
  by `NotificationsDropdown` inside `RosterShell`, so it costs **no request** — indexed, stamped
  in the one row constructor, and folded into `isLoading` / `isError` / `refresh` (the third
  `mutate` is what empties a deactivated client out of Ready for review).
- `components/clients/roster/roster-row-format.ts` (NEW): `formatShortDate`,
  `formatLastCheckIn`, `formatInvitedOn` lifted out — the row was 251 lines against a 250
  guideline and is now 247 with the C2 additions in it.
- `roster-row.tsx`: a `view` prop; an always-visible **"Review check-in"** link
  (`checkInReviewUrl`, `ROW_BUTTON_CLASS` + `FOCUS_RING`), never on a deactivated row; the
  Last-check-in sub-line precedence is now **late → waiting → due**, the waiting line reading
  `review · 24 Aug` in `MONO` + teal `#0d9488` (amber stays reserved for lateness; teal is the
  tone the sidebar's review badge already uses) and dated from `unreviewedCheckIn.submittedAt`,
  never `lastCheckInDate`; in `view="review"` the row click and chevron address the check-in
  while the NAME keeps pointing at the client.
- `roster-table.tsx`: passes `view` down; empty copy → "No check-ins waiting".
  `roster-stat-band.tsx`: `actionLabel` → "View check-ins ready for review", and the stale
  no-sub comment (which explained an *intake* wait the roster could not measure) rewritten.
- `hooks/use-client-attention.ts` (D2.1): the badge is `overdueTotal +
  indexUnreviewedCheckIns(checkIns).size` — the two Attention views, counted through the
  roster's own function. The `/api/coach/pending-intakes` poll left with it.
- `components/navbar/notifications-dropdown.tsx`: the three "New Check-Ins" rows link to
  `checkInReviewUrl(checkIn.clientId, checkIn.id)`. The footer link is C3's and is untouched.
- `app/api/check-ins/unreviewed/route.ts`: **`.eq("active", true)`** on the client-id lookup
  (the approved deviation below).
- `services/client-intake-service.ts`: its `client.active` comment no longer claims to feed the
  nav badge, and names the intake queue's three surviving homes.
- Tests (+5 files, +34 cases; 311 files / 3338 tests green, from 306 / 3304): NEW
  `lib/roster-views.test.ts` (the index's first-wins/dedupe, the four `review` cases incl. an
  intake NOT matching, the untouched views), NEW `roster-row-format.test.ts` (the year and
  day-distance branches on frozen time), NEW `roster-row.test.tsx` (the link's href, its two
  absences, sub-line precedence, the row-click target per view, the name's href), NEW
  `use-roster.test.ts` (stamping, the client-not-check-in count, an intake scoring 0, the
  three-way loading/error/refresh fold), NEW `use-client-attention.test.ts` (distinct clients,
  not `.total`); EDITED `app/api/check-ins/unreviewed/route.test.ts` — its `clients` mock
  resolved at the FIRST `.eq`, so the second one broke it; it is now thenable like the real
  builder, and asserts `("active", true)`.
- Docs: a first `### Coach client roster` section in ARCHITECTURE (`:668`, ahead of the tab
  structure) — the six views in two groups, the redefinition and where the intake queue went,
  the three folded reads, what the badge counts and why it counts through the shared function,
  active-only at both endpoints, and the 30s poll that bounds freshness; TECHNICAL-DEBT L#1
  (`:725`) and L#4 (`:728`); the memory file `project_clients_roster_redesign.md`; this file's
  `:3` status line.

*Deviations from the plan, and why.*
1. **★ `/api/check-ins/unreviewed` now filters `active` (approved before coding).** The plan
   asked for a badge counting "DISTINCT ACTIVE clients" but left the mechanism unstated, and
   `use-client-attention.ts` holds no client list — the queue row carries no `active`. Filtering
   at the source was chosen over exposing `clientActive` and filtering twice client-side:
   it makes stat band = sidebar = badge agree by construction, and it removes the dead-end C2
   would otherwise have created on the bell (a deactivated client's page 404s —
   `getClientById` is active-filtered). Precedent and identical reasoning:
   `getCoachPendingIntakes`. **Consequence, outside C2's named file list:** the bell count and
   the toast listener no longer report a deactivated client's check-in.
2. `formatInvitedOn` now delegates to `formatShortDate` — the two bodies were byte-identical.
   A de-duplication inside the extraction, not adjacent tidying.
3. `UnreviewedCheckInSource` is module-private. Exported, knip reported it as an unused type
   (173 lines vs 172); both callers hand over a `CheckIn[]` and match structurally. Same call
   C1 made for `useCheckInDetail` / `useCheckInComparison`.
4. The plan's "the sub-line reads 'check-in awaiting review'" is rendered as `review · <date>`,
   not that sentence: the row's own always-visible button already says "Review check-in", so
   the sub-line's job is to DATE the thing being reviewed — which is landmine 3's actual point.
   It matches the register of the two lines it sits beside (`3d late`, `due 24 Aug`).
5. The badge lost its `/api/coach/pending-intakes` poll entirely, so nothing polls that endpoint
   app-wide any more (the dashboard banner reads it once, un-polled). Read as intended: the
   plan's "the pending-intakes poll leaves the badge" beside "the endpoint stays (banner + two
   inline mutates)".
6. No sub was added to the stat-band cell even though the roster now knows the submit time —
   the plan asked only for the comment and `actionLabel`, and every row carries its own date.
7. Plan line cites re-derived today: TECHNICAL-DEBT `:724` had drifted to `:725`; `:728` was
   exact. The insertion point for the ARCHITECTURE section is `:668`.

*§2 review — the triggers fire (≥5 files on the data flow; one route's scoping changed).*
1. Write routes: **none touched.** C2 adds no mutating handler; the only route edited is the
   `GET` queue, which writes nothing.
2. Auth + ownership: unchanged. `/api/check-ins/unreviewed` still resolves the coach with
   `getAuthenticatedCoachId()` and scopes `check_ins` to that coach's client ids
   (`route.ts:15-17`, `:25-38`); the new `.eq("active", true)` **narrows** that tenant scope and
   can only remove rows. (The pre-existing gap that the auth helper is called without `request`
   is untouched.)
3. zod before writes: n/a, no write.
4. Tenant scope on the write: n/a. On the read, the scope is unchanged in kind and tighter in
   extent.
5. `check:rls`: not run — no table, column, policy or grant changed.
6. `supabaseAdmin`: the queue GET is the only site, authorized by its own coach lookup as before.
7. Round trips are constant: the queue GET is still 2 selects; the roster page's third read is a
   cache hit on a key `NotificationsDropdown` already mounts, so `/clients` issues the same
   number of requests it did yesterday. `indexUnreviewedCheckIns` is one O(n) pass inside an
   existing `useMemo`, over a result the endpoint caps at 100 rows.
8. Batched writes: n/a.
9. Indexes: no new `WHERE`/`ORDER BY` column. `clients.active` joins an existing
   `coach_id` equality on a table already read whole for this coach on the same request path;
   `check_ins` predicates are unchanged. Per the migration tree — not re-probed live.
10. Worst-case rows: the queue keeps its 100-row `LIMIT`; the filter can only reduce it.
11. Sequential awaits: unchanged (the client-id read must precede the `check_ins` read).
12. No `.catch()` returning success after a committed write was added.
13. No two-write seam introduced.
    Not load-tested; read paths under concurrency remain untested.

*Gates (real output).* `npx tsc --noEmit` exit 0 · `npx eslint .` exit 0, **156 warnings / 0
errors** (unchanged from C1; none in a touched file — the one grep hit,
`components/client/notifications-dropdown.tsx:66`, is the CLIENT-side twin I did not edit) ·
`npx vitest run` **311 files / 3338 tests passed**, no flaky set-tracker trip ·
`npm run check:labels` "OK — 683 files scanned" · `npm run knip` **172 lines, unchanged** from
C1's 172 · no `as any`, no markers, no `console.log` in the touched files. No route file was
deleted, so no `.next` wipe.

*Smoke (owner, 2026-08-29) — all clear:* `?view=review` lists exactly the clients with an
unreplied check-in and matches the stat-band cell, the sidebar pill and the nav badge; a client
with several waiting counts once in all three; the teal `review · <date>` sub-line, amber
lateness winning over it, and a plain overdue row all render correctly; "Review check-in" fits
the actions column and sits cleanly beside the kebab on a row that is both; the row click
addresses the check-in in the review view and the client page everywhere else, while the name
always addresses the client; an intake-complete client is out of the queue and keeps its Review
button on Onboarding; the bell rows land on the check-in in one hop and its footer is untouched;
the client's own Overview agrees about who is waiting; replying removes a client with one waiting
and keeps a client with several.

*Still unverified, and why.* **The deactivated-client path (checklist steps 17–19) could not be
exercised: nothing in the app deactivates a client.** `DELETE /api/clients/[id]` exists and has
no caller, and `updateClientSchema.active` has no control bound to it, so the fixture cannot be
made by clicking. What rests on unit tests alone is therefore: the row hiding "Review check-in"
for an inactive client, the queue endpoint's new `.eq("active", true)`, and reactivation
re-populating the view without a refresh. Worth a fixture the next time this area is opened.
Also left alone: `?view=review` keeps the roster's default `"recent"` sort (newest client added),
a poor order for a queue — recorded as a follow-up, not changed.

### C3 — #3 delete the legacy queue
Per §2.3 (+ D3.1 card count, D3.2 recent rows). §2 review walked (the ≥5-files trigger fires):
no route/auth/write path changed; `/api/check-ins/*` keep in-route auth. Smoke: dashboard card →
`/clients?view=review` with matching numbers; bell footer both branches; `/check-ins/review` → 404.

**STATUS — SHIPPED 2026-08-30 in `743ab03` (+ `21d7fbc8`), browser-SMOKED by the owner the same day: one defect found and fixed, then ALL CLEAR. C3 is CLOSED.**

*Owner decisions taken in this session, ahead of coding.*
- **The review view is renamed "Unreviewed check-ins"** (was "Ready for review"), everywhere it
  is written. The owner's reason: "ready for review" never says WHAT is ready, and the name
  should explain exactly what it is. The plan's recommendation had been the opposite — retitle
  the dashboard card TO "Ready for review" — and was overruled.
- The count stays **clients**, not check-ins (below).
- The card's count lives in **one shared hook**, not two spellings.

*What shipped.*
- **Deleted `app/check-ins/`** (`rm -r`; the tree held one file). With it: the `"/check-ins"`
  entry in `middleware.ts` `trainerRoutes`, the `scripts/check-labels-whitelist.ts` exemption,
  and **`PageHeader.backHref`** plus its now-dead `Link` / `ArrowLeft` imports — grep confirmed
  the deleted page was its only caller of six, and knip does not report a dead prop (landmine 8).
- **`lib/roster-views.ts`**: `ROSTER_VIEWS`' review label → `"Unreviewed check-ins"`. That single
  string now feeds the sidebar tab, the roster's sticky title, the stat-band cell and the
  dashboard card. The module header and `indexUnreviewedCheckIns`' docstring were rewritten to
  say that every counter outside the roster reaches its number through this file.
- **`hooks/use-client-attention.ts`**: new `useUnreviewedCheckInClientCount()` — the review half
  alone, `indexUnreviewedCheckIns(checkIns).size`. `useClientAttentionCount` now composes it
  rather than repeating it, and the dashboard card calls it. One body for a number that has
  drifted from the page beside it twice.
- **`app/dashboard/page.tsx`** (D3.1 + D3.2): the card's `href` → `rosterViewUrl("review")`, its
  title → `rosterViewLabel("review")` (same words it already showed — the owner's rename made
  the card and the view agree by accident, so it is now sourced rather than repeated), and its
  value → the shared hook. The `/recent`-derived `useMemo` is gone, and `useMemo` with it. The
  "Recent check-ins" rows now deep-link through `checkInReviewUrl`.
- **`components/navbar/notifications-dropdown.tsx`**: the footer's both branches go through
  `rosterViewUrl`. Its `"/clients?view=overdue"` was the last hand-written literal of that form
  in the codebase.
- **`components/clients/roster/roster-stat-band.tsx`**: the review cell's label comes from
  `rosterViewLabel("review")` and its `actionLabel` reads "View unreviewed check-ins".
- Comment sweep for the old name: `hooks/use-roster.ts` (×2), `app/api/check-ins/unreviewed/route.ts`,
  `hooks/use-client-attention.test.ts`.
- Docs: ARCHITECTURE `:677` (queue table), `:681` (the rename, why, and the label-vs-count gap),
  `:685` (the dashboard card as the badge's co-reader), `:708` (the `checkInReviewUrl` writer
  list — the legacy queue was its first caller), `:803` (trainer routes). Per D-docs the
  CLIENT-PORTAL ledgers and CLIENT-PORTAL-REDESIGN `:365` were LEFT naming the deleted page.

*Tests (+1 file, +8 cases; 312 files / 3353 tests green).*
- NEW `app/dashboard/page.test.tsx` — the page had none. The card's href; a client with two
  waiting counting once; **the count no longer coming off `/recent`** (three `ai_processed` rows
  with an empty queue must read 0); a recent row's deep link. `use-check-in-data` is the mock
  boundary, so `use-client-attention` and `indexUnreviewedCheckIns` run for real.
  `AnimatedCounter` is stubbed — it springs from 0 and never settles in jsdom.
- `lib/roster-views.test.ts` — a **scan** (modelled on `lib/check-in-week.test.ts`): no source
  file outside `lib/roster-views.ts` may contain a `/clients?view=` literal. The module header
  has always claimed this rule and the bell quietly broke it.
- `hooks/use-client-attention.test.ts` — three cases on the new export.
- **Both new assertions were mutation-tested** (backed up with `cp` to the scratchpad and
  restored from it — never `git stash`): re-typing the bell's literal fails the scan and names
  the file; making the hook return `checkIns.length` fails three tests across both suites.

*Deviations from the plan, and why.*
1. **★ The rename itself** — not in the plan at all; the owner's call this session (above). It
   grew C3 by two files (`roster-views.ts`, `roster-stat-band.tsx`) and a comment sweep.
2. **The stat band's OVERDUE cell was also moved onto `rosterViewLabel`**, though only the
   review cell was named. Its string is byte-identical to the view label, so there is no visual
   change; leaving one of two adjacent attention cells hardcoded would have left the file with
   two idioms and the exact drift this commit is closing. Recorded rather than silent.
3. **The scan skips `*.test.ts(x)` wholesale** instead of exempting them one by one. The first
   full run flagged the new dashboard test, which asserts the literal destination on purpose — a
   test cannot ship a bad link, and an exemption list would have penalised the habit that catches
   a bad rename. `lib/roster-views.ts` is the one source exemption.
4. The bell footer's COPY ("Review all check-ins" / "View all overdue clients") is unchanged —
   only the hrefs were in scope, and both still read as actions.
5. `unreviewedTotal > 0` is left as the footer's branch CONDITION. It counts rows, but as a
   boolean it is identical to the client count (an empty list gives an empty map), and landmine
   4 is about displaying `.total`, not testing it.

*The label/count gap — deliberate, and the one thing to watch.*
The view is named after check-ins; every count attached to it (stat band, sidebar pill, nav
badge, dashboard card) counts **CLIENTS**, because each sits beside a list with one row per
client and must match the rows on screen. The visible edge: a client with two unreviewed
check-ins is one row, so reviewing the newer one leaves the number where it was. This was raised
with the owner before the rename was taken and accepted. The fix, if wanted, is the ROW saying
"2 waiting" rather than the count saying 3 — recorded as a follow-up, NOT built here, and
`ROSTER_VIEWS` carries a comment telling the next reader not to close the gap by counting
check-ins instead.

*§2 review — the ≥5-file trigger fires; the answer is short.*
No route handler, auth chain, write path, table, policy, grant or query changed. The only
server-side edit is `middleware.ts` losing a role-redirect branch for a URL that no longer
resolves for anyone — after deletion every role gets a 404 there, which is what the plan
predicted. `/api/check-ins/unreviewed` and `/api/check-ins/recent` keep their in-route auth and
their existing scoping untouched (the latter is already active-only through `getCoachClientIds`,
so D3.2's deep links cannot dead-end on a deactivated client). Round trips are unchanged: the
dashboard's new read is a cache hit on `/api/check-ins/unreviewed`, which `AppLayout` already
mounts via `CheckInNotificationListener` on every coach page. `check:rls` / `check:service-key`
not run — nothing they cover was touched. Not load-tested.

*Gates (real output).* `rm -rf .next` (a route was deleted) · `npx tsc --noEmit` **exit 0** ·
`npx eslint .` **0 errors, 154 warnings** (156 at C2 — the deleted page carried two); the only
warning in a touched file is the pre-existing `<img>` at `app/dashboard/page.tsx:136`, which C3
did not touch · `npx vitest run` **312 files / 3353 tests passed**, no flaky set-tracker trip ·
`npm run check:labels` "OK — 683 files scanned" · `npm run knip` **168 lines, unchanged** from
the pre-C3 baseline measured this session. **Note for later commits: 168 is the live baseline,
not the 172 C2 recorded** — the three Overview commits between them moved it.

*Smoke round 1 (owner, 2026-08-30) — one defect, fixed in `21d7fbc8`.* **The sidebar tab DID clip**,
as flagged. Fixed the way the STATUS block predicted, with the owner choosing the words: the
"Attention" group heading became **"Check-ins"**, and the two tabs under it took a short form —
**"Review due"** and **"Overdue"**. The split is a second accessor, `rosterViewNavLabel`, used
by the sidebar ALONE; `rosterViewLabel` stays the name for the sticky title, the stat-band cell
and the dashboard card, which have no heading above them (a card reading "DUE" names nothing).
A view without a short form falls back to its full name, so the four roster shapes need no entry
and the next view added cannot go missing from the sidebar. +3 test cases pin both halves and
the fallback. The review tab was briefly a bare **"Due"**; I flagged that `due` is
already spent on the SCHEDULE across this app — `next_check_in_due`, the roster's `due 24 Aug`
sub-line, the bell's "Due Soon" all mean *scheduled and coming up*, not *submitted and awaiting
your review* — and the owner settled it as **"Review due"**, which keeps the two apart under the
shared heading and still fits the column easily. Closed.

*Smoke round 2 (owner, 2026-08-30) — ALL CLEAR. **C3 is CLOSED.*** The sidebar tabs fit under the
"Check-ins" heading, and the stat band, sticky title and dashboard card all keep the full name.
The "Due" collision was raised and settled as "Review due" (above) — do not reopen it.

*The bell's asymmetric destinations: asked, answered, INTENDED — do not "fix" it.* A New Check-In
row names a check-in and opens it; an Overdue row names a client who has not submitted one, so
there is no check-in to open and it can only address the client. Same rule
`lib/attention-alert-destinations.ts` states in its header ("No alert type maps to check-ins —
the check-in row owns that destination"). The gap that remains is not the destination but the
ACTION: `/clients/{id}` shows the overdueness in the identity row, while "Send reminder" lives
only as a roster row action on `?view=overdue` — which is where the bell FOOTER already goes.
Owner reviewed the three options (leave it / point the rows at the view / rehome Send reminder)
and chose to leave it.

*Still unverified, and why.* The C2 deactivated-client path remains unexercisable (nothing in the
app deactivates a client — build a fixture before trusting it). The dashboard around this card is
still largely hardcoded mock data (Active Clients, Unread Messages, Upcoming Calls, and the first
five values of this card's own sparkline) — do not read those numbers as live.

### C4 — #7 uniform review blocks
Per §2.7. Tests: `review-block.test.tsx`, `check-in-review-rail.test.tsx` (mock `sonner`;
build the all-empty review directly). Smoke: a v3 check-in, a legacy v2 row, a `pending` row
(one placeholder), a check-in whose prs/challenges contain line breaks, Regenerate (Share draft
updates; a 429 toasts), Send.

**STATUS — SHIPPED 2026-08-30 in `c84f5fc3` (+ `f2df76c4`), browser-SMOKED by the owner the same day, ALL CLEAR on the first pass. C4 is CLOSED.**

*What shipped.*
- **NEW `components/clients/check-ins/review-block.tsx`** — `ReviewBlock` (a `LABEL_CLASS` label
  row with an optional actions slot), `ReviewProse` (13px, `whitespace-pre-wrap`), `ReviewList` +
  `ReviewListRow` (a fixed marker slot so text left-aligns down the column whatever the marker).
  That is the whole vocabulary; a new block composes it rather than inventing a fifth label size.
  Placed in the coach folder and imported BY `components/check-in/`, which is NOT relocated
  (§2.7 — it still holds client-facing wizard steps with their own importers).
- **The rail is ONE borderless white card, "AI review"** (`Sparkles`, Regenerate as the header
  icon action) holding Summary / What to watch / Coach actions / Share with client. Gone: the two
  teal-wash sub-cards, the two 14px semibold `h4`s, and the `border-l-4` white card nested inside
  Coach actions. Watch icons became list markers; themes became `NeutralChip`; the coach-action
  priority became a coloured dot **plus an `sr-only` word** — the uppercase label it replaced was
  the only thing carrying that meaning, and a colour alone would not have.
- **`ClientNotesSection`**: Reflection / Wins / Challenges through the same `ReviewBlock`, so the
  card stops carrying two label treatments of its own and Reflection's teal left border goes.
  Its bordered, animated SHELL stays — it is one of the five siblings D7.3 owes (below).
- The four fixes named in §2.7, each real: Send hover `#0f766e` → `#0b7f75`; the Share draft
  **resyncs** (see deviation 2); Regenerate **reports** a non-OK response, with a distinct message
  on the coach-keyed `aiRateLimit` 429 that was previously silent; the never-persisted Summary
  pencil edit is **removed** (D7.4), taking `Textarea`, `Pencil` and `Check` out of the rail.
- Docs: ARCHITECTURE "The coach review surface" rewritten around the one card, the primitive, the
  empty-state asymmetry and the owed siblings; TECHNICAL-DEBT "Design System" #2 records the five
  sibling cards with a mechanical suggested fix.

*Tests (+3 files, +18 cases; 315 files / 3374 tests green).*
- NEW `review-block.test.tsx`, NEW `check-in-review-rail.test.tsx` (mocks `sonner`; the all-empty
  review is built directly — the zod fallback always yields a summary, so that state is
  unreachable through the normal path), NEW `client-notes-section.test.tsx` (not in the plan; the
  line-break behaviour is a named smoke item and the file had no test at all).
- **Mutation-tested** (backed up with `cp` to the scratchpad, restored from it — never
  `git stash`): deleting the draft resync fails the rail's draft test; deleting
  `whitespace-pre-wrap` fails both line-break tests.

*Deviations from the plan, and why.*
1. **★ The all-empty placeholder covers the AI blocks; Share still renders.** §2.7 says "one
   card-level placeholder when the whole review is empty", which taken literally removes the Share
   block from a `pending` check-in — and a coach could always Edit → type → Send a manual reply
   before the AI had produced anything. That is a behaviour regression, not a tidy-up. The
   placeholder replaces the three AI sub-blocks, which still collapses today's TWO placeholders
   into one. Two tests pin it.
2. **The draft resync is an effect on the prop, not a `key` reset on the parent.** A remount would
   also drop `isSending`, so a Regenerate landing mid-send would strand the in-flight request's
   state. The effect resets only the message, which is what "regenerate" means.
3. **The card shell is hand-rolled (`rounded-[6px] bg-white p-5`), not `OverviewCard`.** That
   primitive bakes in `animate-card-in`, and D7.3 says no animation on the rail (it is a sticky
   column). Adding an opt-out prop for one caller was worse than three utility classes.
4. **`client-notes-section.test.tsx` is a fourth file the plan did not name** — see above.
5. **My own first draft of the line-break tests was vacuous and the mutation pass caught it.**
   They asserted `textContent` only, on the reasoning that the class is "class math"; but jsdom
   does no layout, so `textContent` carries the `\n` with or without the styling. Both tests now
   pin the class as the mechanism AND the text, with a comment saying why. Recorded because the
   instinct that produced it — prefer behaviour over class assertions — is right in general and
   wrong here.

*§2 review — NOT APPLICABLE, and the reasons.* Render-only. No route, service, query, migration,
policy, auth chain or write path is touched. The two fetches in these files
(`POST /api/check-in/[id]/ai-summary`, `POST /api/check-in/[id]/review`) keep their URLs, methods,
headers and bodies byte for byte; fix 3 only READS the status code the route already returned and
discarded. No new request, no new round trip, no `supabaseAdmin` site, nothing for `check:rls` or
`check:service-key` to cover.

*Gates (real output).* `npx tsc --noEmit` **exit 0** · `npx eslint .` **0 errors, 154 warnings**
(unchanged from C3; one error in a new test file — an `async` arrow with no `await` — was fixed
before this count) · `npx vitest run` **315 files / 3374 tests passed** · `npm run check:labels` "OK — 687 files scanned"
(683 + the four new files) · `npm run knip` **168 lines, unchanged**. No route deleted, so no
`.next` wipe.

*An intermittent test failure I could NOT attribute — do not assume it is benign.* Across eight
full-suite runs during C4, two reported `1 failed | 3373 passed` and the other six were clean. The
failing test's NAME was not captured either time (the summary scrolled past before the log was
being written to a file), and five consecutive captured runs afterwards could not reproduce it.
It is CONSISTENT with the documented flaky set-tracker test (`flaky_set_tracker_test` in memory,
which fails only under full-suite load) but that is not proven, and no C4 file is anywhere near
the set tracker. If a later commit sees the same shape, capture the run to a file first:
`npx vitest run > log 2>&1` — a bare pipe to `tail` loses it.

*Smoke (owner, 2026-08-30) — ALL CLEAR on the first pass. **C4 is CLOSED.*** The one AI review
card, the four labelled blocks, the `pending` row's single placeholder with Share still usable, the
client's line breaks surviving in Wins/Challenges, the Share draft following a Regenerate, the 429
toast, Send, and the coach-action priority dots all check out — including a legacy v2 row's mapped
watch items and coach actions reading correctly through the new list markup.

*Carried forward, deliberately.* The Current pane is asymmetric until the five sibling section
cards lose their borders and framer stagger (D7.3) — logged as TECHNICAL-DEBT → Design System #2
with a mechanical one-sweep fix. The owner has seen it and accepted it as the interim state.

### C5 — #5 denominators
Per §2.5. Tests: `client-adherence-service.test.ts` (fixtures gain `name`; restore the three
`perHabit` tests from `c7f3f8b`; range-bounds test), `check-in-details-service.test.ts` (mock
`./client-adherence-service` — its date-helpers factory exports only `calculateCheckInPeriod`),
`check-in-service.test.ts` total mock + `app/api/check-in/[id]/route.test.ts` mock gain the two
re-exports, `adherence-card.test.tsx` literal, new `weekly-nutrition-service.test.ts`,
`kpi-ribbon.test.tsx` (written against the ribbon WITH its comparison props — those stay),
`habits-section.test.tsx`; `lib/check-in/adherence.test.ts` untouched.
Docs: CONVENTIONS `:449`, ARCHITECTURE "Review figures" + `:702` note, `types/weekly-nutrition.ts`,
SPEC `:151`, `CLIENT-APP-REFERENCE.md` (value change). §2 review: five extra parallel reads on
the detail GET; `nutrition_logs` read 3× per submission (pre-existing 2×). Smoke: a client with 3
logged days → hero "3/7 · 43%", pill "3/7 on target", weekly verdict MISSED; a habit with no
logs → 0/7; a mid-week habit shows leading dashes; training unchanged; Regenerate → the Summary
no longer says 100%.

**STATUS — SHIPPED 2026-08-30 in `747c5f98`, browser-SMOKED by the owner the same day: the figures are right, and two PRE-EXISTING defects the corrected numbers exposed were fixed in `7d9de50`. C5 is CLOSED.**

*What shipped.*
- **`getClientAdherenceForRange(clientId, start, end)`** extracted in
  `services/client-adherence-service.ts`; every read bounded by `endDate`, not today, and `dates`
  materialised from the range. `getClientAdherence(clientId, days)` is now a thin resolver over it,
  so the two surfaces differ only in which window they ask for. `perHabit` restored from `c7f3f8b`
  (the habits select gains `name`) — built from the HABIT list, so a habit the client ignored all
  week reads 0/7 instead of vanishing.
- **`resolveCheckInReportingPeriod(checkIn)`** extracted from `deriveSessionCompletionsForCheckIn`'s
  inline fallback, and **`getCheckInPeriodAdherence(checkIn)`** on top of it. Both derivations now
  resolve the SAME window; they read different tables, and disagreeing about which seven days they
  cover would have been invisible and wrong. Training is deliberately absent from the payload.
- `GET /api/check-in/[id]` carries `periodAdherence` (or `null`), joined to the existing
  `Promise.all`.
- **(d):** `getNutritionSummaryForPeriod` builds the period's full targets through
  `buildNutritionSummary` (logged day's frozen target → that date's event → the plan's weekday
  template) and passes them as the 4th argument `calculateWeeklySummaryFromLogs` already accepted
  and had always received as `undefined`. Its **three** callers move together: the coach submit
  path's stored columns, the client submit path's prompt, and Regenerate.
- UI: the KPI **Calories** cell is now **Nutrition** — `onTarget/dates.length`, `pct%`, "days on
  target", `--` / "No nutrition logs" when the period will not resolve. The NutritionSection pill
  reads `N/7 on target`; its weekly HIT/PARTIAL/MISSED verdict stays (already target-based, and it
  answers a different question). HabitsSection renders `perHabit`, with a DASH for days before a
  habit existed rather than an empty dot, which would have read as a miss.
- The AI prompt's no-summary fallback `Days on target: N/7` takes the period's real length.
- Docs: ARCHITECTURE → Check-in System gains "The figures, and what they divide by" and "The
  stored figure changed meaning"; `types/weekly-nutrition.ts`; SPEC `:151`; a NEW entry under
  `CLIENT-APP-REFERENCE.md` → Adherence Calculations.

*Tests (+3 files, +26 cases; 318 files / 3400 tests green).* `client-adherence-service.test.ts`
(the three restored `perHabit` cases, plus the 3-of-7-is-43% and 3-of-3-is-100% denominator cases),
`check-in-details-service.test.ts` (+6: the resolver's three branches; the kernel called on the
check-in's own period; training absent; null reads nothing), NEW `weekly-nutrition-service.test.ts`,
NEW `kpi-ribbon.test.tsx`, NEW `habits-section.test.tsx`, a route case asserting `periodAdherence`
reaches the payload. **Mutation-tested:** reverting the 4th argument to `undefined` fails the
headline 14000-vs-6000 assertion.

*Corrections to the plan — three of its claims were wrong, verified before coding.*
1. **The `/habits/logs` fetch was never in `use-check-in-detail-data.ts`.** It lives in the SHARED
   `useWellnessData`, also mounted by the client Overview tab and the wellness strip. That hook
   already had a `withHabitLogs` flag (the Overview's wellness cards pass `false`), so this is one
   word, not surgery on a shared hook. The hook test now ASSERTS `withHabitLogs: false`.
2. **Three of the four doc cites were stale.** CONVENTIONS `:449` is client-read-scaling content
   now (the adherence line is `:505`, and it is about TRAINING adherence — left alone).
   ARCHITECTURE's "Review figures" section and `:702` note **do not exist**; the record was written
   into Check-in System instead. `CLIENT-APP-REFERENCE.md` had no `adherence_percentage` entry to
   amend, so one was added. SPEC `:151` was exact.
3. **`getNutritionSummaryForPeriod` has THREE live callers, not two** — `client-check-in-service.ts`
   (the client submit path's prompt) is the one the plan missed.

*Deviations, and why.*
1. **★ The KPI ribbon lost four props.** `dailyLogs`, both context dates and `fullWeekTarget` existed
   only to average kcal over the days a client happened to log — the cell that is gone. Leaving them
   would have left a component taking four arguments it ignores, which `knip` cannot see. Two
   vestigial `card.label === "Calories"` checks went with them: every delta is now a numeral (so mono
   is unconditional) and every sub-line is words (so never mono).
2. **A legacy row with no resolvable period renders EMPTY STATES, not a client-side fallback.** A
   second computation is the two-conventions problem this commit removes. Those rows lose figures
   they showed before; whether any exist in prod is a smoke item.
3. `resolveCheckInReportingPeriod` is NOT re-exported from `check-in-service` — knip flagged the
   re-export as unused, and it is: both callers live in the same module.
4. The `kpi-ribbon` test mocks `@/contexts/units-context`, not a `use-units` hook — the real context
   imports the Supabase browser client, which throws without env vars.

*§2 review.* No new write path, migration, policy, grant or `supabaseAdmin` site. Auth unchanged:
`GET /api/check-in/[id]` still gates on `requireCoachOwnsCheckIn(id)` before any read, and the new
work happens after it, scoped to `checkIn.clientId`. **Round trips, reported not fixed:** the detail
GET gains five parallel selects (the kernel's window reads); `getNutritionSummaryForPeriod` goes
from 1 select to 4; and a submission now reads `nutrition_logs` **three** times (its own read, (d)'s
via `fetchNutritionDataForPeriod`, and the snapshot service) against a pre-existing 2×. All constant
per request, none N+1, all bounded by the period. `buildFullWeekTargets` runs only after the log
read returns rows, so a period with nothing logged still costs one select. No new index needed: every
predicate is an existing `client_id` + date range. Not load-tested.

*Gates (real output).* `npx tsc --noEmit` **exit 0** · `npx eslint .` **0 errors, 154 warnings**
(the C4 count; the two I introduced — an unused import and a dead prop — were fixed, not absorbed) ·
`npx vitest run` **318 files / 3400 tests passed**, no flaky trip across the run ·
`npm run check:labels` "OK — 689 files scanned" · `npm run knip` **167 — one line BETTER than the
168 baseline**, because `FullWeekTargets` finally has a caller. `check:rls` / `check:service-key` not
run: no table, policy, grant or service-key site changed.

*Smoke (owner, 2026-08-30) — the figures are right; TWO defects found beside them, both fixed in
`7d9de50`.* Neither was in C5's diff — both were pre-existing calendar-day divisions the corrected
numbers made visible.
1. **The wellness card's averages were not means.** They summed the logged values and divided by
   the CALENDAR days, so two stress entries averaging 6.5 rendered as 1.9 — "relaxed" — beside an
   AI summary correctly calling the week high-stress. `calculateMetricAverages`, which writes the
   stored snapshot the prompt reads, had always divided by its own per-metric count; this card was
   the only place in the system that did not. Now per metric (stress and mood can be logged on
   different days). **This supersedes D5.4's "leave calendar-day means"** — that decision assumed a
   design choice; it was an arithmetic error.
2. **The nutrition macro row compared two different weeks on one bar** — an actual summed over
   three logged days ÷ 7 against a target summed over seven ÷ 7. Three logged days at ~161g of
   protein against a 159g target rendered as 69g against 159g. Each macro now averages over the
   days it was logged, against the target that applied on those same days; the kcal average
   likewise. **The totals, the bar and the MISSED · 3/7 pill are unchanged** — whole period, which
   is the adherence question.
   The rule, now in ARCHITECTURE: an adherence figure asks *did you do what you were supposed to*
   (unlogged counts against, denominator = the period); an average asks *what was it typically*
   (unlogged is UNKNOWN, not zero, denominator = the days with data).
3. Also fixed: the pill's denominator was still C5's locally derived day span rather than
   `periodAdherence.dates.length` — the rule C5 itself wrote into the code and the docs. Both are 7
   on a healthy row; they diverge on a legacy one.
   (+2 test files, +8 cases; both denominators mutation-tested. 320 files / 3408 tests.)

*A per-day nutrition strip was raised and DEFERRED.* The owner suggested rendering the week's days
in the nutrition card. It is complementary rather than an alternative — a strip answers *which
days*, but cannot carry three macros per day, so the macro row and its denominator would remain.
Worth doing as its own change with a design pass: the card is a two-column grid and a strip needs
its own row. It would match the wellness card's idiom directly.

*Still expected, not a bug.* **The one-off comparison artefact is expected,
not a bug:** `comparison-service` reports the change in `adherencePercentage` between consecutive
check-ins, so the first check-in submitted after this lands is measured the new way against a
predecessor measured the old way and will show a large phantom drop. It self-corrects from the
following week. Existing rows were deliberately NOT backfilled — reconstructing what each historical
week's targets were would invent numbers, since plans get replaced and events get edited. Also
unverified: whether any check-in in prod has an unresolvable period (the empty-state path).

### C6 — #4 customisable check-ins — SPLIT into C6a and C6b

The original single C6 was scoped at ~58 files (13 new source, 8 new tests, 20 modified
source incl. generated types, 8 modified tests, 9 docs) with an irreversible schema change in
the middle — the §2 review's own "~40 files" undercounted it. Split at the WIRE BOUNDARY on the
owner's call, 2026-08-30:

- **C6a — schema + wire + server.** Zero visible behaviour change, because no coach can create
  a form yet: every client has no form row, so `form` resolves to all 14 keys, the strip is a
  no-op and `customAnswers` is always empty. One "submit a check-in exactly as today" smoke
  still exercises the migration, both RPCs, the context key and both `[id]` reads.
- **C6b — the two surfaces.** No SQL, no wire contract.

A schema mistake found in C6b is a migration 158 either way (an applied migration is never
edited), so the split costs nothing there and buys a smoke of the data path before thirty files
of UI land on top of it.

### C6a — schema + wire + server
Per §2.4 and D4.*, minus the UI. Migration 157 → DEV then PROD (`npx supabase migration list
--linked` first, `--dry-run` immediately before each push); gen types; diff = exactly the
migration; `check:rls` clause 1 on the five new tables; the RPCs' `GRANT EXECUTE` cited. Files:
kernel + test, `lib/validations/check-in-form.ts` + test, `submitCheckInSchema` `customAnswers`,
service + test, four route files + tests (mock `audit-log-service`), `check-in-context` `form`
key (+ the key-list test and the ARCHITECTURE contract rewrite), POST strip-before-upload, both
`[id]` reads (joined answers), types, D4.5 prompt line (+ `ai-prompt-builder.test.ts`), audit
keys. Docs: ARCHITECTURE tree + "The customisable form" + RN contract; `CLIENT-APP-REFERENCE.md`;
TECHNICAL-DEBT + CONVENTIONS. Smoke: submit a check-in exactly as today and confirm nothing
changed.

**STATUS — C6a SHIPPED 2026-08-30. Migration 157 applied to DEV and PROD (both now at 157). Owner browser smoke OWED; UI is unverified until it runs.**

*What shipped.*
- **Migration 157** — five tables (`check_in_questions`, `check_in_forms`,
  `check_in_form_fields`, `check_in_form_questions`, `check_in_answers`), all RLS-enabled with
  ZERO policies and `GRANT ALL … TO service_role`; two atomic RPCs
  (`save_check_in_form_atomic`, `create_check_in_form_template_atomic`) over a shared, ungranted
  `check_in_form_write_children` helper that re-proves question ownership in SQL. Verified on
  BOTH databases from the live catalog after the push: 5/5 RLS with 0 policies, and all three
  functions `anon=false, authenticated=false, service_role=true`.
- `lib/check-in/form-fields.ts` — the pure kernel: the 14 keys (with their coach-facing labels
  and wizard steps), `stepsForFields`, and `applyCheckInForm`, the strip both the browser and
  the server run.
- `services/check-in-form-service.ts` + `lib/validations/check-in-form.ts` + four route files:
  `GET`/`PUT /api/clients/[id]/check-in-form`, `GET`/`POST /api/check-ins/questions`,
  `PATCH /api/check-ins/questions/[questionId]`, `GET`/`POST /api/check-ins/forms`. All on
  `coachApiRateLimit` → CSRF → `requireCoachOwnsClient`/`requireCoachAuth` (request passed) →
  zod → service, with `check_in_form.update` and `check_in_form_template.create` audited.
- Wire: `check-in-context` carries `form`; `POST /api/client/check-ins` accepts `customAnswers`
  and STRIPS the submission to the form after the gate and **before the photo uploads**; both
  `[id]` reads return `customAnswers` with prompts joined live; the AI prompt gains a
  `Coach questions:` block (D4.5), both halves sanitised.
- `submitCheckIn` writes the answers as a second statement and does **not** swallow the failure.

*Nothing visible changed, by construction.* No coach can create a form yet, so every client has
no form row: `form` resolves to all 14 keys, the strip is a no-op, `customAnswers` is always
empty. That is what makes C6a's smoke "submit a check-in exactly as today".

*Corrections to the plan, found while verifying.*
1. **The `EXECUTION-PLAN :969-971` cite was stale** — those lines are Session 2.7's deviation
   bullets, unrelated. The real edit (a supersession line for the fixed 4-step wizard) belongs
   with C6b and moved there.
2. **`TECHNICAL-DEBT :954` had drifted to `:965`, and its number was wrong**: the live count of
   `/api/clients/**` files on `apiRateLimit` is **15, not 21**. `CONVENTIONS.md:588` carried the
   same stale 21. Both corrected — leaving one would have created a fresh disagreement.
   (CONVENTIONS was not on C6's doc list; flagged and done anyway for that reason.)
3. `TECHNICAL-DEBT :519-520/:536` were exact.
4. **§2.4's `optionalString` import was unnecessary** — no field in the new schemas is a
   null-coercing optional string, so no third copy was created either way.

*Deviations, and why.*
1. **★ C6 was SPLIT** (owner call). The single commit was ~58 files with the irreversible half in
   the middle; the §2 review's own "~40 files" undercounted it.
2. **★ Apply-a-template is EDITOR-SIDE.** No `POST …/check-in-form/apply` route, no third RPC,
   no `check_in_form.apply_template` audit key. §2.4 offered both readings; the sheet's own copy
   ("Start from a template") and D4.6's "both new coach writes" (exactly two) settle it as
   preview-then-commit. C6b's smoke line was rewritten to check what was actually built.
3. **★ `customAnswers` is on the single-check-in reads only, not the client history LIST.** §2.4
   asked for the list allowlist too; embedding a dictionary in a row list is what CONVENTIONS §8
   "Sparse fieldsets" forbids, and the list renders a date, a status and a preview. It sits on
   `CheckInWithDetails`, not `CheckIn`, so `CLIENT_FACING_CHECKIN_KEYS` stays fail-closed.
4. **`answer_type` was dropped from the schema.** The draft carried it as "the seam for scale/
   yes-no later" with a single-value CHECK and no reader. Adding it later is one additive,
   defaulted `ALTER TABLE`; `client_goals.primary_goal` is the standing evidence that an inert
   column acquires an unconditional writer and becomes undroppable.
5. **`check_in_answers.question_id` is `ON DELETE NO ACTION`, not `RESTRICT`.** RESTRICT is
   checked immediately and is not deferrable, so a `DELETE FROM coaches` — which cascades to
   clients → check_ins → answers AND to check_in_questions in one statement — would abort or not
   depending on cascade order. There IS a live coach-delete path
   (`scripts/seed-scale-client.ts --fullReset`), which survives today only because it deletes
   `check_ins` at `:216` before `coaches` at `:232`. NO ACTION defers to end-of-statement, so a
   bare delete of an answered question still fails and a full teardown still succeeds.
6. **`CheckInContextResponse` absorbed all six keys, not just `form`.** It described five of
   eleven while the route added the rest through a local inline intersection and
   `use-client-check-in.ts` kept a third private copy. Both were deleted. Type-only; it is the
   RN contract and ARCHITECTURE points at it.
7. **`stepsForFields` and the 14-key enum do NOT cover the Feeling summary or the Training
   checklist.** Raised unprompted; owner decided fourteen stands, because those two are the app
   showing the client their own week back rather than fields they fill in, and the checklist is
   a fill-gap LOGGER — suppressing it would remove a logging path, not a question. Recorded in
   `TECHNICAL-DEBT.md` with that reasoning.
8. `scripts/seed-scale-client.ts`'s clean phase gained `check_in_forms` — deletion residue of
   the new tables, not adjacent tidying.
9. Four exports were narrowed to keep knip at its 167 baseline (`CHECK_IN_FORM_STEPS` and three
   types un-exported; two unused inferred types deleted). C6b re-exports what it imports.

*How the migration was proved before either database was touched.* Both directions of this
session's transport corrupted characters (six mangled SQL tokens in one message; the session
prompt itself carries four), so nothing went to a database from prose. Written to disk →
read back → mechanical count check (5 `CREATE TABLE`, 5 `ENABLE ROW LEVEL SECURITY`, 5
`GRANT ALL`, 3 functions, 3 `REVOKE`, 2 `GRANT EXECUTE`; no non-ASCII; every schema-qualified
name one of 8 expected) → the whole file run inside `BEGIN;`/`ROLLBACK;` on the live database →
`--dry-run` → push. Repeated for PROD. **The rehearsal's pass signal is a trailing
`SELECT 1 AS rehearsal_ok`**, because `db query -f` returns only the last result set: an earlier
error aborts the file and no such row comes back. The mechanism was verified first, not
assumed — a deliberately broken probe returned `ERROR: 42601 syntax error at or near "ECK"`, a
mangled plpgsql body returned the same for `PERFO`, and `to_regclass` confirmed the rollback
left nothing. The file is also re-runnable by construction (every DDL is `IF NOT EXISTS` /
`CREATE OR REPLACE`; no bare `ADD CONSTRAINT`), so a partial push is retried, not repaired.

*Six behaviours proved against the LIVE database* (one transaction, rolled back, nothing
leaked): fields written; a question at position 0 enabled; a re-save REPLACES children rather
than appending; one form row per client after a re-save (the upsert); **coach A putting coach
B's question on a form is refused with `foreign_question`**; a nameless template refused with
`template_needs_name`; a named template lands with `client_id NULL`; and **deleting an answered
question is refused by the FK** — which is what forces archive-instead-of-delete. No unit test
can prove any of those.

*Mutation-tested* (backed up with `cp` to the scratchpad and restored from it — never
`git stash`; both restores confirmed byte-identical with `diff -q`): removing the server-side
`applyCheckInForm` call fails all three strip tests; removing the `enabled` / `archived_at`
filters fails the two questions-hidden tests.

*Tests: +6 files, +76 cases (326 files / 3503 tests, from 320 / 3408).* New:
`form-fields.test.ts`, `check-in-form.test.ts` (validations), `check-in-form-service.test.ts`,
and route tests for all four new files. Grown: the `check-in-context` key set (+ `form`, +
the all-14 default), `check-in-service.test.ts` (answers written / not written / **not
swallowed**, plus a pin that highlights still ARE — the deliberate asymmetry),
`check-in-details-service.test.ts` (+9), both `[id]` route tests, the submit schema (a blank
answer is ACCEPTED, not 400'd), and the AI prompt.
**Four mock contracts had to grow** and two of them failed the full run first, exactly as
CONVENTIONS §2 warns: `services/check-in-service.test.ts` (the deliberately-total
details-service mock), `app/api/check-in/[id]/route.test.ts`,
`app/api/client/check-ins/[id]/route.test.ts` (both mock `@/services/check-in-service` totally),
and `app/api/client/check-ins/route.test.ts` (needed the new form-service mock).

*§2 review — the triggers fire (new migration, five tables, four routes, new write paths, ~35 files).*
1. **Rate limit + CSRF.** All four new files: `coachApiRateLimit` first, `requireCSRFProtection`
   on every PUT/POST/PATCH, both pinned by test (the CSRF test asserts auth is not even reached).
2. **Auth + ownership.** `check-in-form` → `requireCoachOwnsClient(clientId, request)`, foreign
   client 404s before any read or write. `questions` / `forms` → `requireCoachAuth(request)`, and
   every service call filters on the RESOLVED `coach_id` — a body-supplied `coachId` is ignored
   (pinned). A foreign `questionId` matches zero rows and reads 404.
3. **zod before every write**, 400 with `details`.
4. **Tenant scope on the write.** The PUT scopes by `client_id`; question writes carry
   `.eq("coach_id", …)` on BOTH `id` and `coach_id`; and the RPC re-proves question ownership in
   SQL — the one thing the route cannot prove. Proved live (deviation note above).
5. **`check:rls` run against BOTH databases**: 46 public tables, 46 with RLS (was 41). Clause 1
   covers all five new tables; each has ZERO policies. `GRANT EXECUTE … TO service_role` at
   `157_check_in_forms.sql` for `save_check_in_form_atomic` and
   `create_check_in_form_template_atomic`; the shared helper is REVOKEd and never granted.
   **Finding worth recording:** the five new tables ALSO carry `anon`/`authenticated` privileges
   from `pg_default_acl`, exactly like `audit_logs`, `client_notes`, `client_phases` and
   `nutrition_plan_notes` — CONVENTIONS §8's "grant service_role only" describes the migration,
   not the resulting ACL. RLS deny-all is the control, and it is on.
6. **`supabaseAdmin`** on every new site, authorized by the chains above.
7. **Round trips constant, never per-row.** `getClientCheckInForm` = ONE embedded select (form →
   fields, questions → questions); the coach GET, the PUT's RPC, templates and the bank one each.
   `check-in-context` gains one read INSIDE its existing `Promise.all` — no new sequential leg.
   Both `[id]` reads gain one, also inside their existing `Promise.all`. The POST gains one.
8. **Writes batched**: each RPC's two `INSERT … SELECT` statements are one each;
   `insertCheckInAnswers` is a single multi-row INSERT.
9. **Indexes**: every new predicate is covered — `check_in_forms_one_per_client` (partial
   unique), `idx_check_in_forms_templates` (partial), `idx_check_in_questions_coach`, both child
   PKs, `idx_check_in_answers_question`. `UNIQUE (form_id, position)` and
   `UNIQUE (check_in_id, question_id)` are real constraints, not plain indexes.
   `check_in_form_questions.question_id` is deliberately unindexed (no delete traffic — questions
   are archived; the `nutrition_plan_notes.coach_id` precedent).
10. **Worst case**: 14 field rows + 10 question rows per save; ≤10 answer rows per check-in.
11. **Sequential awaits**: the PUT's save-then-re-read is two round trips by design (the response
    echoes stored state); everything else is folded into an existing parallel fan-out.
12. No `.catch()` returning success after a committed write was added.
13. **The one seam, stated: `submitCheckIn` writes the check-in and then the answers as two
    statements.** If the second fails the check-in stands without them, the POST 500s, and the
    client's retry meets migration 156's period-unique constraint. Deliberately not swallowed —
    silently losing a client's typed answers is worse than a visible failure — and closing it
    means moving the 39-column check-in INSERT into an RPC, which is not C6a's scope. Pinned by
    test, and the contrast with `insertExerciseHighlights` (which still swallows) is pinned too.
    **Not load-tested.** Untested under concurrency: two coaches saving one client's form (the
    RPC's `FOR UPDATE` is reasoned about, not exercised), and the context GET's extra select
    under real traffic.

*Gates (real output).* `npx tsc --noEmit` **exit 0** · `npx eslint .` **exit 0, 0 errors /
154 warnings** — unchanged from C4 and C5, and the two in touched files
(`use-client-check-in.ts:70`'s pre-existing floating promise, the seed script's CLI
`console.log`s) are both pre-existing · `npx vitest run` (captured to a file first)
**326 files / 3503 tests passed**, no flaky trip · `npm run check:labels` **"OK — 698 files
scanned"** · `npm run knip` **167 — exactly the baseline**, verified by running knip in a
throwaway git worktree at HEAD and diffing: the only difference is `types/database.ts` line
numbers shifting under the generated types · `npm run check:rls` **OK on both databases** ·
`npm run check:service-key` **PASS** · no `as any`, no markers, no `console.log` introduced.
No route file was deleted, so no `.next` wipe.

*Types diff.* `types/database.ts` differs by exactly the five tables and three functions, plus
one unrelated line: `PostgrestVersion` `"14.17"` → `"14.5"`. That is a platform-reported value,
not a schema fact, and regenerating from **PROD** after its push produced a file **byte-identical
to the repo's** — so 14.5 is what both databases report and the old 14.17 was stale. Not
hand-edited (CONVENTIONS §8: the file is generated).

*Still unverified.* Everything in the browser — no UI ships in C6a, so the smoke is a
regression check rather than a feature check. The four new routes have **no caller until C6b**;
they are covered by tests and by the live-database proofs, not by a real client. `stepsForFields`
has no consumer yet either (its test is the only caller). The RPCs' behaviour under two
concurrent saves of one client's form is reasoned about, not exercised.

### C6b — the coach editor and the client wizard
`check-ins-tab-content.tsx` rail + sheet (+ sheet mock in its test), the sheet + groups + editor
hook + test, the three SWR hooks (key + invalidator each), the D4.4 control; client wizard (all
three hard-coded `4`s, steps from `stepsForFields`), the three step components, the questions
section, the client read-back card, Client Notes answers as `ReviewBlock` (presumes C4 landed —
it did). Docs: CLIENT-PORTAL-REDESIGN `:82` (fix the dropped `expected_check_in_day` cite while
there); a dated supersession line under CLIENT-PORTAL-EXECUTION-PLAN's Session 2.7 (the wizard's
step list is no longer a fixed 4). Smoke: toggle off Photos → the client wizard has 3 steps and
never reaches a photo; disable weight → a draft with a weight submits without it and
`current_weight` is untouched; two questions → answered → visible on the client `[id]` page and
the coach page; **save as template → open another client's sheet → "Start from a template" → the
editor shows the template's fields and questions, NOTHING IS SAVED YET → Save changes → their
form is replaced** (preview-then-commit: apply is editor-side, there is no server apply route);
all-on → the form still saves a row, and a client with no row still gets all 14.

**STATUS — C6b SHIPPED 2026-08-30. No SQL, no wire change. Owner browser smoke OWED for BOTH C6a and C6b; every surface below is unverified until it runs.**

*What shipped.*
- **The coach editor.** A `Check-in history` rail on the Check-ins tab whose one action,
  "Customise check-in" (`SlidersHorizontal`), opens a 780px sheet — dark hero over an
  `#f4f7f6` body of railed white cards, the `client-details-sheet.tsx` shape. The rail sits
  ABOVE the body's four states, not inside the list, because a coach shapes a form BEFORE the
  first check-in exists. Files: `check-in-form-sheet.tsx` (shell, template picker, footer,
  name dialog), `check-in-form-fields-card.tsx`, `check-in-form-questions-card.tsx`,
  `use-check-in-form-editor.ts`, `hooks/use-check-in-form-config.ts`.
- **Fields**: all 14, one `<SegmentedControl>` On/Off per row (D4.4, D4.7 per column), grouped
  by the wizard STEP each field sits on using the kernel's own order and labels — so the coach
  toggles rows under the words their client sees. Each control is wrapped in a
  `role="group" aria-label={label}`, which gives the pair an accessible name without reaching
  into the shared primitive.
- **Questions**: order (move up/down), on/off, inline reword, remove-from-form, and a dashed
  "Add question" footer button opening a 320px Popover over the bank — type a new prompt or
  reuse one, capped at `MAX_CHECK_IN_QUESTIONS`.
- **Three SWR reads, each with a key builder and a matching area invalidator**, all gated on
  `open` so a closed sheet costs nothing (the `useClientGoalHistory` precedent).
- **The client wizard derives its steps from the form.** `useCheckInForm(token, totalSteps)`;
  the page renders by step KIND, not index; `canProceed` (four `return true`s) and the
  `stepLabels` literal are gone; each step hides the fields it is not asked for.
  `applyCheckInForm` now also runs in the BROWSER before `toCanonicalCheckInSubmission`.
- **Both read-backs.** The client's `[id]` page gains a "Your coach asked" card; the coach's
  Client Notes card gains a "Coach questions" block.
- Docs: `CLIENT-PORTAL-REDESIGN.md:82` (the dropped `expected_check_in_day` cite → the stored
  date + `getCheckInGate`, migs 154/155, plus the no-longer-fixed step list);
  `CLIENT-PORTAL-EXECUTION-PLAN.md` Session 2.7 dated supersession line; `ARCHITECTURE.md`
  "The customisable form" (the entry point + the wizard's derivation) and the Check-ins tab row.

*Owner decisions taken in this session, ahead of coding.*
- **★ A question prompt does NOT go in `ReviewBlock`'s label slot.** The plan said "render each
  answer as a `ReviewBlock`", which taken literally puts a 300-character coach sentence in
  `LABEL_CLASS` — 10px uppercase muted, the treatment for a CATEGORY name. The owner ruled it a
  category error with a known failure mode rather than a matter of taste. Shipped instead: ONE
  `ReviewBlock label="Coach questions"` (that IS the category) holding the pairs, with prompt
  and answer separated by **colour** — `ReviewProse tone="muted"` over the default ink, both at
  the existing 13px prose scale. C4's "do not invent a fifth label size" holds; `tone` is the one
  axis added, and it is the axis this system already uses to mute things.
- **Both ARCHITECTURE edits taken** (they were flagged as off-plan): `:1084` described a feature
  with no stated entry point because the entry point did not exist when C6a wrote it, and
  `:710` enumerates what the tab renders. Two sentences each; the copy-based/editor-side apply
  rule was NOT restated, since that section's "Templates are copy-based" paragraph already has it.
- **★ A reword must update the editor's LOCAL row, not only invalidate the bank** — raised by
  the owner, and it was a real bug in the plan. The editor's question list is local state seeded
  once per open, so an invalidate-only reword left the old wording on screen until the sheet was
  reopened, while the card's own sentence promises the change lands everywhere. Same shape as
  C4's stale Share draft. Fixed and mutation-tested.

*Deviations from the plan, and why.*
1. **★ The template picker is a `DropdownMenu`, not the `<Select>` §2.4 names.** A Select's value
   would be a lie: applying a template is an ACTION, the editor diverges the moment anything is
   toggled, and Radix does not re-fire `onValueChange` for the same value — so "start over from
   Cutting" would have been inexpressible. The applied-template marker is still tracked
   (`appliedTemplateId`) and cleared by the first edit, which is what makes a re-apply meaningful.
2. **FOUR step components changed, not three.** `step-subjective` needed the `notes` gate AND
   hosts the questions section; metrics, photos and training gate their own fields.
3. **`CheckInFormStep` is NOT exported.** The plan said the page would need the type to index
   `CHECK_IN_STEP_LABELS`; writing it showed the page never names it (inference covers it), and
   knip flagged the export. Un-exported — C6a deviation 9's precedent, and the reason the knip
   diff is now byte-identical to HEAD.
4. **`CHECK_IN_STEP_LABELS` is ONE map for both audiences** — the client's progress indicator and
   the coach's field-group headings. §2.4 suggested "Measurements / Photos" for the coach; using
   the wizard's own words instead avoids a second map that could drift, and costs the coach
   nothing. Pinned by a completeness test.
5. **`useToast`, not `sonner`.** The adjacent C4 rail uses sonner; the design SOT and the sibling
   Notes tab say `useToast()`. The SOT wins for a new coach file. Recorded rather than silent.
6. **The metrics step opens EXPANDED when weight and body fat are both off** but girths are on —
   otherwise the step opens on nothing but an "Add Measurements" button.
7. **The fields card carries an all-off hint** ("still gets a two-step check-in confirming their
   week"). Not in the plan; it answers the question the kernel's own docstring anticipates, in
   one line, at the moment a coach would ask it.
8. Plan/doc cites re-derived this session: `CLIENT-PORTAL-REDESIGN.md:82` **exact**;
   `ARCHITECTURE.md:710` and `:1084` **exact**; Session 2.7's "Do NOT" line is `:1000` (the plan
   gave no number). None had drifted.

*Two behaviours stated rather than left to be discovered.*
- **"Save as template" posts the editor's CURRENT state, unsaved edits included.** That is the
  gesture a coach wants — shape a form, bank it, then decide whether to commit it to this client
  — but it means a template can exist from a state this client's form never had. Commented at
  the call site and pinned by test.
- **`useInvalidateCheckInsQueue`'s `/api/check-ins` prefix also matches the questions and
  templates keys.** Harmless today: those two are only mounted while the sheet is open, and the
  sheet and the review detail are mutually exclusive surfaces. Recorded in the hook's header so
  the next person does not rediscover it.

*Tests: +4 files, +38 cases (330 files / 3555 tests, from 326 / 3503).* New:
`use-check-in-form-config.test.ts` (keys, the closed-sheet null key, stable empty arrays, all
three invalidator accept/reject sets), `use-check-in-form-editor.test.tsx` (seed-once,
toggle/reorder/remove/add, the cap, the save payload's position-is-array-order, the failed save,
the reword, template apply and template save), `check-in-form-sheet.test.tsx` (14 rows by group,
a toggle sending the KEY not the label, the question controls, the two footer commits, the
disabled picker, the all-off hint, the error state, no-close-while-saving), and
`custom-questions-section.test.tsx` (answers keyed by id, not position). Grown:
`check-ins-tab-content.test.tsx` (+ the sheet mock; the rail reachable in all four body states,
and absent under `?checkIn=`), `page.test.tsx` (step counts for full / photos-off / all-off /
no-`form`-key, and both strip cases), `client-notes-section.test.tsx` (the one-block treatment
and its colours), `form-fields.test.ts` (label completeness).

**One `vi.mock` export list had to grow**: `check-ins-tab-content.test.tsx` gains
`vi.mock("./check-in-form-sheet")` — the real sheet pulls in three SWR hooks and `useToast`. The
wizard page test needed no new module mock: `stepsForFields` and `applyCheckInForm` are pure and
run for real.

**Mutation-tested** (backed up with `cp` to the scratchpad and restored from it — never
`git stash`; all three restores confirmed byte-identical with `diff -q`). Five mutations, five
dead tests: dropping the reword's local update; dropping the seed-once guard; reverting the step
switch to `currentStep === N`; dropping the browser-side strip (killed two); and rendering the
prompt in ink instead of muted.

*§2 review — the ≥5-files trigger fires; the security half is short.*
1-6 (security): **no route, service, query, migration, policy, grant or `supabaseAdmin` site is
touched.** C6b is browser code calling four routes C6a shipped and reviewed:
`GET`/`PUT /api/clients/[id]/check-in-form`, `GET`/`POST /api/check-ins/questions`,
`PATCH …/questions/[questionId]`, `GET`/`POST /api/check-ins/forms` — each still
`coachApiRateLimit` → CSRF → `requireCoachOwnsClient`/`requireCoachAuth` → zod → service, with
the RPC re-proving question ownership in SQL. CSRF is origin-based, so a browser `fetch` needs no
token. `check:rls` / `check:service-key` not run: nothing they cover changed, and the kernel the
browser imports (`lib/check-in/form-fields.ts`) still reaches no `supabaseAdmin`.
7. **Round trips.** Opening the sheet costs THREE parallel GETs (form, bank, templates), gated on
open so a closed sheet costs none. A save is one PUT plus the route's own echo re-read. A reword
is one PATCH. None is per-row.
8-10. Writes are unchanged in shape and bounded by C6a's caps: ≤14 field rows and ≤10 question
rows per save, ≤10 answers per check-in.
11. The three sheet reads are parallel (three independent SWR keys), not sequential.
12. No `.catch()` returning success after a committed write was added. A failed save toasts and
**keeps the sheet open with the draft intact**; a failed template save leaves its dialog open.
13. **One seam, and it is deliberate: creating a question writes the bank row IMMEDIATELY while
its membership of this form lands only with Save changes.** Cancelling after "Add question"
therefore leaves an unused question in the bank. That is the right half to persist — the bank is
coach-wide and the question is reusable — but it is a real half-state and it is named here rather
than discovered. The pre-existing submit seam (`submitCheckIn`'s check-in INSERT then its answers)
is C6a's and is unchanged. **Not load-tested.**

*What the client now sends that it never sent before:* `customAnswers`, and a payload already
shaped to the coach's form. Both are validated and re-stripped server-side by C6a code — the
browser strip is courtesy, the server's is the authority.

*Gates (real output).* `npx tsc --noEmit` **exit 0** · `npx eslint .` **0 errors / 154 warnings**
— exactly the C4/C5/C6a count, and none in a touched file · `npx vitest run` (captured to a file
first) **330 files / 3555 tests passed**, no flaky set-tracker trip · `npm run check:labels`
**"OK — 706 files scanned"** (698 + the eight new files) · **`npx knip` 167 — and byte-identical
to HEAD**, verified the memory-file way: `git worktree add --detach <tmp> HEAD`, `node_modules`
symlinked in, knip run there, outputs diffed (`npm run knip` reads 171 because of its 4-line npm
banner — do not compare the two commands). No `as any`, no markers, no `console.log`, no raw
`font-mono-display` or hand-spelled focus ring in any touched file. No route file was deleted, so
no `.next` wipe.

*Still unverified.* **Everything in the browser** — the sheet, the popover, the reword, the
template round trip, and every gated wizard step exist only against jsdom. Specifically untested
by anything: how 14 segmented controls read at 780px; whether the Popover's bank list scrolls
sensibly past a handful of questions; and the sheet's height with all 14 rows plus 10 questions.
Two concurrent coaches saving one client's form is still reasoned about, not exercised (C6a's
`FOR UPDATE`).

**C6b FOLLOW-UP — SHIPPED 2026-08-30 (commit A of two).** Owner smoke of C6b found four
things. Three were mine; the fourth is older and is commit B.

*What shipped.*
- **★ D4.4 REVERSED to option (b) (owner).** The premise behind "(a) `SegmentedControl` per
  row" was that the design system had no Switch spec — but there IS a switch, it was simply
  un-migrated and had **already drifted into three treatments across six call sites**: the full
  Teal-Summit look hand-written at `nutrition-surplus-settings.tsx`, half of it
  (`data-[state=checked]:bg-[#0d9488]` alone, so the OFF track stayed OKLCH grey at the default
  size) at `automation-rule-card.tsx` and `nutrition-adjust-by-tab.tsx`, and the raw shadcn
  defaults at three more. `components/ui/switch.tsx` now carries that hand-written string, the
  three overrides are deleted, and `docs/newdesignsystem.md` has a **Switch** section with the
  spec and the **"no pill shapes" exemption** a switch needs (the pill is the affordance). The
  three bare call sites change appearance as a consequence — they were OKLCH defaults on
  Teal-Summit surfaces, so this makes them correct; they are on the smoke list.
- **Question rows put the switch LAST** so it lines up with the fields card above it. The
  destructive-rightmost habit is a `SectionLabel` RAIL rule, not a form-row rule, and applying
  it here cost alignment for nothing.
- **Reordering is drag-and-drop** (`DndContext` + `verticalListSortingStrategy` + `useSortable`
  + `GripVertical`) — the program builder's exercise-list shape. The up/down arrows are gone. A
  `KeyboardSensor` is wired because those arrows were the only keyboard path; the precedent has
  none, so this is four lines beyond it rather than a divergence from it.
- **★ The stuck sheet — root cause found, not worked around.** Symptom: open the customise
  sheet, close it, open it again, and it spins forever over a form that has fully loaded. Three
  reproductions of the owner's steps passed before the owner's DevTools Network capture settled
  it — three 200s with real payloads on the reopen, nothing pending. **`seeded` was a `useRef`,
  and the spinner was computed from it during render, so flipping it scheduled no render.** The
  spinner only ever cleared as a SIDE EFFECT of the four `setState` calls beside it changing
  something. On a reopen the saved form came back from the SWR cache as the SAME object, so
  `setFields(form.fields)` / `setQuestions(form.questions)` / `setIsDirty(false)` /
  `setAppliedTemplateId(null)` ALL bailed out on `Object.is`, nothing re-rendered, and the flag
  stayed invisible. The later revalidation could not rescue it either: by then the ref read
  `true`, so the effect returned early and again called no setter. A page reload fixed it
  because that made it a first open again.
- **The fix deletes the machinery rather than the symptom.** `CheckInFormSheet` is now a shell;
  `check-in-form-panel.tsx` owns the ONE gating read and mounts `CheckInFormEditorBody` only
  once the form has resolved. Radix unmounts `SheetContent` on close, so **one editor lifetime
  is one open** — no `enabled` flag on the three reads, no seeding effect, no ref, and no
  render-visible state outside React state. "Seeded once, a revalidation can't clobber edits"
  survives as a structural fact. Two things fall out: a coach can no longer save an empty form
  over a real one (the editor cannot render without data), and the bank and template reads get
  **their own error surfaces** — a failing bank used to hold the same spinner with no way out,
  a second independent route to the same screenshot.

*Deviations, and why.*
1. **The header X is no longer disabled during a save.** It is the only exit from a slow or
   failed load, and Escape and the overlay can close the sheet regardless — a disabled X beside
   two working exits is theatre. Cancel and both commits still disable. `use-toast` keeps its
   state in a module store, so a save that lands after an unmount still reports its outcome.
2. **The reorder kernel is `reorderQuestion(activeId, overId)`**, not `moveQuestion(id, ±1)` —
   the `onReorderExercise` shape, so one gesture has one spelling.
3. `CheckInFormEditor`'s `isLoading` / `isError` are gone from its return: loading and failure
   are the panel's, above the editor.

*Tests: +1 file, +4 cases; 3 of the 4 verified FAILING against the pre-fix commit.*
NEW `check-in-form-panel.test.tsx` runs the REAL editor hook and the REAL SWR with only `fetch`
faked — a mocked hook cannot see a defect that lives in the seam between the two. It covers
loading → editor, the error state (and that **no Save exists** in it), edits discarded on close,
and **the reopen**. Verified the honest way rather than assumed: a `git worktree` at HEAD with
`node_modules` symlinked in, the new file copied over, and vitest run there — **3 failed / 1
passed** on the pre-fix code, all 4 green after. Its "editor is up" assertion is deliberately
written against the field LABEL plus the absence of a spinner, not the switch role, so it holds
against both builds and that verification was possible at all. Grown: the editor-hook test (new
signature, `reorderQuestion`, the bank-error surface), the sheet test (switch roles, grip
instead of arrows, switch-is-last, the save-in-flight states), and the config-hook test (the
`enabled` cases are gone).

*The coverage gap that let this ship:* **no test opened the sheet twice.** Every case mounted,
opened once, and asserted. The bug needed a second open in the same mount against a warm cache.

*§2 review — the ≥5-file trigger fires; the answer is short.* No route, service, query,
migration, policy, grant or `supabaseAdmin` site is touched. The three coach routes keep their
chains untouched; the only request-shape change is that the sheet's three reads now start when
`SheetContent` mounts instead of when an `enabled` flag flips — same three requests, same
laziness, one fewer mechanism. `check:rls` / `check:service-key` not run: nothing they cover
changed. Not load-tested.

*Gates (real output).* `npx tsc --noEmit` **exit 0** · `npx eslint .` **0 errors / 154
warnings** (the standing count) · `npx vitest run` (captured to a file) · `npm run check:labels`
OK · `npx knip` **bare**, diffed against a HEAD worktree.

*Still unverified.* Everything in the browser. The switch migration puts four surfaces OUTSIDE
check-ins on the smoke list — the nutrition builder's activity-burn toggle (must look
identical), the nutrition calendar's hold-protein toggle, the coach habits inline form's
numeric toggle and the client portal's habit toggles — plus the automation card and the content
upload dialog. Drag-and-drop reordering cannot be driven in jsdom, so the **gesture** is
unverified; only its kernel is pinned.

**Commit B, agreed and not built here (option (d)):** the coach per-client check-in list still
pages by OFFSET, so a new submission shifts every row down one and the boundary row is returned
on two pages — proven against Dev, where the duplicated React key `e1b3341b…` is a `check_ins`
row sitting at index 19 of 53 with `CLIENT_CHECKINS_PAGE_SIZE = 20`. The same two readers also
carry `revalidateOnFocus: false` AND `revalidateFirstPage: false` with `revalidateAll` at its
default, so they revalidate **nothing** — which is why Journey stays stale until a hard reload
while the Overview chart (a plain `useSWR`) refreshes on every visit. Both are pre-C6b. The fix
is to keyset the list (`lib/cursor.ts`, as `/api/client/check-ins` already does) and restore
revalidation.

**Post-C6b:** owner smoke across all six surfaces; both DBs confirmed at 157; memory update.
Then the separate Comparison / Goal Progress definition session (§2.6).

---

## 6. Landmines the executor must not re-discover

1. A filter-function SWR mutate cannot reach `useSWRInfinite` (§1.7) — do not write a
   `startsWith` invalidator for the check-in lists and call it done.
2. `components/persistent-sidebar.tsx` only collapses the shell for `/clients` and
   `/clients/<one segment>` — the pane design exists to avoid this; if D1.1 goes nested, add the
   regex AND an href mode on `ClientSidebar`.
3. `lastCheckInDate` on the roster is the newest check-in of ANY status — render the queue
   row's date from the unreviewed row, not the client.
4. `useUnreviewedCheckIns().total` counts CHECK-INS across ALL clients; the roster counts active
   CLIENTS — never put `.total` on the badge or the card.
5. `getClientById` is active-filtered: the coach PUT 404s for an inactive client and the client
   POST skips the gate AND the strip for one — consistent, state it.
6. The POST already reads the client twice (route + `submitCheckIn`); (d) makes
   `nutrition_logs` a 3× read per submission — report, don't "fix" under #5.
7. The `check-in-context` route test still mocks `createServerSupabaseClient` for a read the
   route no longer makes — leave it.
8. `eslint` will not fail on a dead import; `knip` will not report a dead prop
   (`PageHeader.backHref`); `tsc` will fail on the `adherence-card.test.tsx` literal.
9. ~40 line cites in the analysis drifted by 1–4 lines; the ones above that carry a line were
   re-verified, but grep before every edit-by-line.
10. The design SOT has no Switch spec; the HARD RULE at `newdesignsystem.md` "Segmented control"
    names in-card two-way toggles; `switch.tsx` is `rounded-full` (non-negotiable "no pill shapes").
11. Coach-created `saveOption` check-ins are dead code, but until C0 removes them they are
    period-less `pending` rows that would enter the new queue.
12. The Overview brief predicate already includes `pending`; the queue endpoint does not —
    pick D2.2 before C0.
13. The comparison path is KEPT: `getPreviousCheckIn`, `getFirstCheckIn`, `prepareChartData`,
    `comparison-utils`, `goal-pace`, the four goal cards and the regeneration banner all stay
    live — do not "clean up" any of them under C1's port or C5's ribbon edit.

---

## 7. Out of scope (recorded, not built)

- **Comparison & Trends / Goal Progress / KPI-delta redesign** — its own definition session
  (§2.6 has the evidence list); nothing here deletes or restyles that path.
- Template delete/rename; per-template client list; question types beyond free text.
- Wellness averages over logged days (D5.4); unifying the four spellings of nutrition "hit".
- The five sibling section cards' border/animation/`text-sm` parity (owed after D7.3).
- Retiering `/api/clients/**` routes off `apiRateLimit` (fix the limiter key first — §9).
- `services/check-in-details-service.ts` functions that read by id without a `clientId`
  scope (TECHNICAL-DEBT H2 #3) — `getCheckInPeriodAdherence(checkIn)` follows the existing shape.
- An AI-retry sweep for stuck-`pending` rows (Regenerate is the manual retry).

---

## 8. How to run this plan

One commit per session (sessions die above ~380k tokens). Answer §4 first. Paste the prompt
below into a fresh session, changing only the `COMMIT:` line; it embeds the decisions as
settled and forces plan → approve → build → gates → STATUS block → commit → smoke handover.

```
Read these in full before doing anything, in this order: CONVENTIONS.md, docs/ARCHITECTURE.md
(at minimum: Check-in System, Client page tab structure, Coach client Overview, Client Portal
Architecture), docs/newdesignsystem.md, and docs/CHECK-INS-COACH-EXECUTION-PLAN.md.

You are implementing ONE commit of that plan in this session:

COMMIT: C0

Everything else in the plan is out of scope for this session — do not start the next commit,
do not "tidy" adjacent code, and never touch the Comparison & Trends / Goal Progress /
KPI-delta path (plan §2.6 — it is kept; its redesign is a separate session).

The owner has settled the plan's §4 decisions as follows (treat as final, do not re-ask):
D0.1 yes · D0.2 yes · D1.1 in-tab pane · D1.2 push for the detail open only · D1.3 drop both ·
D1.4 convert to SWR in C1 · D2 redefine the roster view · D2.1 yes · D2.2 include pending ·
D3.1 yes · D3.2 yes · D4.1 additive form key · D4.2 Check-ins tab · D4.3 strip ·
D4.4 SegmentedControl per row · D4.5 yes · D4.6 audit both · D4.7 per column ·
D5.1 dates.length · D5.2 ship (d) · D5.3 replace · D5.4 SUPERSEDED (an average divides by the
days WITH DATA; only adherence divides by the whole period) · D7.1 in place · D7.2 both ·
D7.3 borderless, no animation · D7.4 remove · D-docs leave ledgers, amend SPEC :151 in C5.

Facts from the C0-C5 sessions that you would otherwise rediscover the hard way:
- **The plan's line cites have drifted badly.** In C5, THREE of its four doc cites were wrong —
  two pointed at content that had moved, one at a section that does not exist. Grep for the
  anchor text before every edit-by-line, and say so in the STATUS block when a cite is stale.
- `npm run knip` baseline is **167**. (C2 recorded 172 and C3 measured 168; both are stale.)
- If a full `vitest` run reports one failure, capture it with `npx vitest run > log 2>&1` FIRST —
  piping to `tail` loses the name, which happened twice and cost an unattributable flake.
- For mutation testing, back files up with `cp` to a scratch dir and restore from there.
  **Never `git stash` or `git checkout --`** — both have destroyed uncommitted work here.
- Assertions that only read `textContent` do NOT prove a CSS behaviour: jsdom does no layout, so
  a `whitespace-pre-wrap` test passed with the class deleted. Pin the class as the mechanism too.

Process, in this order:
1. Plan first. Before writing any code, post a plan for this commit: every file to change /
   create / delete with what changes, every test to add or edit (including which vi.mock export
   lists must grow — plan §1.7 and §6), every doc line you will edit, and whether the §2
   security/load review applies. Re-derive line numbers by grepping — the plan says which
   cites drifted. Wait for my approval before editing.
2. Implement exactly the approved plan. If you discover something the plan got wrong, stop and
   say so before working around it (no band-aids — CONVENTIONS §1).
3. Gates before you call it done: rm -rf .next if a route was deleted, then npx tsc --noEmit,
   npx eslint . (read the WARN output for dead imports — it does not fail on them), npx vitest
   run (re-run the flaky set-tracker test before blaming your change), npm run check:labels;
   plus npm run knip before/after on deletion commits, and npm run check:rls + check:service-key
   on C6. Paste the real output. For C6 follow the five-step migration workflow with a
   --dry-run immediately before each db push; if db push is denied, tell me the exact command
   to run myself with the ! prefix.
4. Record a STATUS block under the commit's section in docs/CHECK-INS-COACH-EXECUTION-PLAN.md:
   what shipped, every deviation from the plan and why, the §2 review result (or an explicit
   "not applicable" with reasons), and what is unverified.
5. Commit directly to main (no branch) with a conventional message; then hand me the browser
   smoke checklist for this commit. Do not drive the browser yourself — I run all smokes, and
   the UI is unverified until I do.
```
