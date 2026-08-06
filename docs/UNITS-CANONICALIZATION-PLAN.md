# Units canonicalization — implementation plan

**Status**: ✅ **ALL FOUR PHASES SHIPPED** (2026-08-07, migrations 140 + 141) ·
**Logged**: 2026-08-05 · **Next migration number**: 143 (142 was used by the
unrelated magic-link check-in removal)

> **Phase 4's own plan contained a bug that would have shipped.** Its scope said
> to delete the intake unit toggle in favour of `useUnits()`. That would have
> stranded every imperial client: `app/client/layout.tsx` blocks a
> `pending_intake` client from reaching `/client/settings`, and
> `clients.unit_preference` defaults to `'metric'` — so they would have had to
> type kilograms into a form with no switch, on the phase whose stated goal is
> that each person sets their own unit. See the Phase 4 STATUS block.

> **Phase 3 disproved five of its own claims, two of which would have corrupted
> data.** They are listed at the top of the Phase 3 section under "What this
> section got wrong". Read that before trusting any bullet in it — and note the
> three carve-outs Phase 4 must retire WITH their forms, not before.
>
> **Phase 2 disproved four of its own trap-list claims.** Corrections are inline
> in the Phase 2 section below, marked **CORRECTED**. Read them before Phase 3 —
> two of them were "the tag is trustworthy" assumptions that would have corrupted
> data if followed literally.

Fixes the platform-wide unit problem: weights and measurements are stored in
whatever unit the user happened to be looking at, the "preference" lives on the
client *record* rather than on the person viewing it, and ~101 hardcoded
`kg`/`lbs` strings across ~40 component files label those numbers by guesswork.

Work through the four phases in order, one fresh Claude Code session each. Every
phase has a pasteable prompt at the end of its section.

---

## The decision

Three principles, applied everywhere:

1. **Canonical storage.** Every weight is stored in **kilograms**. Every length
   (height, girth) is stored in **centimetres**. No exceptions, no per-row unit
   tags.
2. **Preference lives on the viewer.** A coach has their own unit preference; a
   client has theirs. Neither can change the other's. A metric coach and an
   imperial client work on the same data and each see their own unit.
3. **Convert at the presentation boundary only.** Nothing between the database
   and the render layer knows about lbs or inches.

### Why canonical storage (and not the alternative)

`docs/CLIENT-PORTAL-REDESIGN.md:260-338` already specifies a "viewer-relative
unit display" architecture that agrees with principles 2 and 3 but **explicitly
rejects** principle 1 (line 279: *"No canonical-storage migration… conversion
happens at render time"*). That plan is superseded by this one.

Its premise was that every record carries a trustworthy `weight_unit` tag, so
render-time conversion could always recover the true value. That premise is
false for the two highest-volume tables:

| Table | Weight rows | Unit tag |
|---|---:|---|
| `set_logs` | 236,360 | **none** |
| `client_metric_entries` | 1,160 | **none** |
| `body_metrics` | 1,188 | 1,176 kg / 12 lbs / **72 NULL** |
| `check_ins` | 2,857 | 2,800 kg / 57 lbs |

For most weight data the per-row unit does not exist. It is inferred at read
time from the *current* value of `clients.weight_unit` — a mutable column — so
flipping a preference silently relabels history. Render-time conversion cannot
work on data that does not know what it is. Canonical kg is the only model that
survives.

**Reconciling `docs/CLIENT-PORTAL-REDESIGN.md` and its Phase 8 sessions is
deferred until all four phases below have shipped.** Do not edit those docs
during this work.

### Why convert in the render layer, not at the API boundary

The superseded plan converted inside API routes. This plan does not. Once
storage is canonical, the API speaks kg/cm and only the render layer converts:

- Response shapes stay as they are. API-boundary conversion would have rewritten
  `weight: number` into `{value, unit}` across dozens of endpoints — a huge diff
  that also breaks the documented RN contract in `CLIENT-APP-REFERENCE.md`.
- The RN client gets canonical kg and can render whatever unit it likes without
  a server round trip.
- A single `UnitsProvider` mounted once in `app/layout.tsx` (which already wraps
  both the coach and client surfaces) removes the "15+ components would each
  need to fetch the preference" objection that motivated the original choice.

One genuine exception: **server-rendered text** that a human reads — AI prompt
strings in `utils/ai-prompt-builder.ts`, and the calculator warnings in
`services/nutrition-service.ts`. Those resolve the viewer's preference
server-side via `getViewerUnitPreference(request)`. Both helpers earn their
place; they just serve different surfaces.

### Canonical helper signatures

Canonical storage means the formatter takes **two** arguments, not three. There
is no per-record unit to pass:

```ts
type UnitSystem = "metric" | "imperial";

formatWeight(valueKg: number, viewer: UnitSystem): { value: number; unit: "kg" | "lbs" }
formatLength(valueCm: number, viewer: UnitSystem): { value: number; unit: "cm" | "in" }

// Prescribed / logged barbell load. Converts AND snaps to a loadable
// increment — see "Training load is not body weight" below.
formatLoad(valueKg: number, viewer: UnitSystem): { value: number; unit: "kg" | "lbs" }

// Height is composite in imperial. Discriminated union, not {value, unit}.
formatHeight(valueCm: number, viewer: UnitSystem):
  | { system: "metric"; value: number; unit: "cm" }
  | { system: "imperial"; feet: number; inches: number }

parseWeightToKg(input: number, viewer: UnitSystem): number
parseLengthToCm(input: number, viewer: UnitSystem): number
parseHeightToCm(input: { cm: number } | { feet: number; inches: number }): number
```

Exact constants, defined once: `KG_PER_LB = 0.45359237`, `CM_PER_IN = 2.54`.
The codebase currently holds **four** conflicting lbs↔kg constants — `2.205`
(`utils/nutrition-helpers.ts:189`), `2.20462`
(`components/client/onboarding/intake-step-1.tsx:34`), `0.453592`
(`services/bmr-service.ts:31`), and `/2.205` inside SQL
(`supabase/migrations/044_create_nutrition_plans_tables.sql:234`).

### Training load is not body weight

Body weight converts cleanly in both directions — 82.3 kg and 181.4 lbs are both
meaningful numbers. **A barbell does not.** Prescribe 100 kg to a client in an
imperial gym and a faithful conversion shows 220.5 lbs, which cannot be loaded;
they will put 225 on the bar. A precise-looking unloadable number is worse than
no conversion at all.

So every **prescribed or logged training load** renders through `formatLoad`,
which converts and then snaps to the smallest loadable increment: **5 lb** for an
imperial viewer, to the *nearest* increment (100 kg → 220 lb, not 220.5 and not
225). Body weight, goal weight and body measurements keep using `formatWeight` /
`formatLength` with no snapping.

> **Superseded by Phase 1 (`b9bbfac`): metric does NOT snap.** This section
> originally specified a 2.5 kg metric snap as well. Metric is the *identity*
> path — no conversion happens — so snapping there does not round away a
> conversion artefact, it rewrites stored data at the display layer: a client's
> logged 47 kg would render as 47.5, an Epley e1RM of 102.3 as 102.5, and a
> session volume total of 12,347 as 12,347.5. `formatLoad` is pass-through for a
> metric viewer, and its JSDoc says so. **Do not restore the 2.5 kg snap.**
>
> Related correction: this plan's Phase 3 section claims `utils/progression-rules.ts:83`
> is 2.5 kg plate math. It is not — that line rounds to 0.5 via `roundHalf`
> (`:66`). The only 2.5 in the tree is a default input value at
> `duplicate-week-dialog.tsx:77`.

This is a display rule that applies to every load-bearing surface — the program
builder, the client's log form, PR and e1RM readouts, exercise analytics — not
just to progression arithmetic.

Note the trade being made: the loadable increment is really a property of the
*client's gym*, not of the viewer's preference. Modelling gym-unit separately is
out of scope; rendering in the viewer's unit and snapping is the pragmatic
choice and is right in the overwhelming majority of cases.

### Defaults are metric

Both existing columns default to imperial — `clients.unit_preference DEFAULT
'imperial'` (migration 011) and `clients.weight_unit DEFAULT 'lbs'`
(migration 009). That is backwards for this platform's actual users: on Dev,
**206 of 208 clients are kg** and 205 of 208 heights are cm. Every new account
currently starts in the wrong system.

New and existing preference columns therefore default to `'metric'`, and
`getViewerUnitPreference` returns `'metric'` for an unauthenticated caller.

### Explicitly out of scope

**Stones.** UK clients often think of body weight in st+lb while using kg in the
gym, which a single metric/imperial binary cannot express. Supporting it means
per-domain preferences rather than one toggle — a real complexity jump, and
deliberately not built now.

The shape above does not box this in: every formatter takes the preference as an
argument, so per-domain preferences later means sourcing that argument from
different fields rather than rewriting call sites.

---

## Reading order for every phase

Each phase prompt points here. Read these in order before planning.

**1. `CONVENTIONS.md` — in full, mandatory.** It declares itself mandatory
reading, but **there is no `CLAUDE.md` in this repo**, so nothing loads it for
you automatically. It is the authority on repo patterns: §1 no band-aid fixes,
§2 plan-before-code and scope discipline, §7 SWR for all new data fetching
(directly governs the Phase 1 hook and provider), plus the service-layer and
migration rules. 644 lines.

**2. `docs/UNITS-CANONICALIZATION-PLAN.md` — this file.** The decision section
and your phase.

**3. `docs/ARCHITECTURE.md` — for system shape ONLY. Its unit claims are wrong
at HEAD.** Read it to understand the service layer, the events-as-SOT model and
the client API surface. Do **not** treat any of the following as current state —
this plan supersedes all four:

| Line | Claims | Actually |
|---|---|---|
| 74 | `resolveEffectiveGoal()` is "the **one** place display-unit goal weights are normalized to kg" | Two other live sites do it independently: `hooks/use-nutrition-plan.ts:139` and `hooks/use-nutrition-builder.ts:287`. Rewiring only the resolver leaves both behind. |
| 422 | "Clients render weights in the user's own unit preference via `formatWeight(weightKg, unitPreference)`" | `formatWeight` has three call sites, all coach-facing nutrition banners. **Zero** in `components/client-portal/**`. |
| 453 | `PATCH /api/client/settings` accepts `weight_unit`, `unit_preference`, `reminder_preferences`, `timezone` | The schema (`lib/validations/client.ts:107-112`) accepts only `unitPreference` and `timezone`. `weight_unit` is derived server-side; `reminder_preferences` is a different endpoint. |
| 422, 484 | Viewer-relative units are "planned Phase 8 work" | Phase 8 is superseded by this plan. Those references are dangling. |

**Phase 4 corrected all four lines (2026-08-07).** The table above is now a
historical record of what they said, not a live warning — `docs/ARCHITECTURE.md`
at HEAD is accurate on units. Kept because the corrections are only legible
next to what they replaced.

---

## Phase overview

| Phase | Status | Delivers | Touches | Risk |
|---|---|---|---|---|
| 1 | ✅ **Shipped** `b9bbfac` 2026-08-06 | Conversion module, `coaches.unit_preference`, viewer resolver, `UnitsProvider` | New files + 1 migration | Low — nothing reads it yet |
| 2 | ✅ **Shipped** `0a99622` 2026-08-06 | All storage converted to kg/cm; unit-tag columns dropped | 1 migration + write paths | Medium — UI shows wrong labels until Phase 3 |
| 3 | ✅ **Shipped** 2026-08-06 (11 commits, `ebf1bb6`…`9f1fe3a`) | Every render path converts through the helpers | ~60 files | Was NOT mechanical — see its STATUS block |
| 4 | ✅ **Shipped** 2026-08-07 (8 commits, `61206da`…`84aafb2`) | Coach + client settings toggles; forms write kg | Settings pages, forms, 6 validation sites | Its own plan would have stranded imperial intake clients — see its STATUS block |

**Expect a broken-looking UI between Phase 2 and Phase 3.** After Phase 2 the
database holds kg but the components still print whatever label they hardcoded,
so an imperial coach sees kg numbers under an "lbs" label. That is expected and
Phase 3 fixes it. Do not try to patch labels during Phase 2.

There are no paying clients — every account is a test account — so the backfill
does not need to be reversible or provenance-preserving. Convert correctly where
a tag exists, best-effort where it does not, and move on.

---

## Phase 1 — Foundation · **SHIPPED** `b9bbfac` 2026-08-06

**Goal**: build the machinery. Change no existing behaviour.

**Shipped with three deliberate deviations from this document.** Each is recorded
in the shipping code's JSDoc; do not read them as mistakes and do not revert them
to match the text around them:

1. **`formatLoad` is pass-through for a metric viewer** — see the superseded note
   under "Training load is not body weight" above. Imperial still snaps to 5 lb.
2. **`UnitsProvider`'s coach branch reads `useAuth().coach.unitPreference`**
   rather than fetching `/api/me/unit-preference` (this section says "SWR-backed
   against that route"). The value already arrives on the `/api/auth/me` payload,
   so fetching it again would duplicate both a request and a cache copy. Only the
   client branch calls the route.
3. **The route returns `{ success, data: { preference } }`**, not a bare
   `{ preference }` — `CONVENTIONS.md:520` and the `/api/auth/me` precedent.

Also shipped, and load-bearing for Phase 4: `resolveViewerUnitPreference` **throws**
on a database error (route → 500) and returns `null` only when no principal
resolves (→ 401), while `getViewerUnitPreference` keeps a lossy metric fallback
for server-rendered prompt strings only. Do not unify them — a guessed unit
served under a 200 is indistinguishable from a real answer.

**Scope**

- New `utils/unit-conversions.ts`: the exact constants, `lbsToKg`/`kgToLbs`/
  `inToCm`/`cmToIn`, `formatWeight`/`formatLength`/`formatLoad`/`formatHeight`,
  `parseWeightToKg`/`parseLengthToCm`/`parseHeightToCm`.
- Migration `140_add_coach_unit_preference.sql`: `coaches.unit_preference TEXT
  NOT NULL DEFAULT 'metric' CHECK (unit_preference IN ('metric','imperial'))`.
- `Coach` type (`types/check-in.ts:346`) + `mapCoachRow` (`lib/mappers.ts:180`)
  gain `unitPreference`.
- New `lib/viewer-preferences.ts`: `getViewerUnitPreference(request)` — resolves
  the authenticated principal (coach or client) and returns their preference,
  defaulting to `'metric'` when unauthenticated.
- New `contexts/units-context.tsx`: `UnitsProvider` + `useUnits()`, mounted in
  `app/layout.tsx` alongside the existing `AuthProvider` / `IntakePanelProvider`.
- New `GET /api/me/unit-preference` returning `{ preference }`.

**Out of scope**: touching any existing render path, any settings UI, any stored
data, and `utils/nutrition-helpers.ts`'s existing exports (leave them alone —
Phase 3 deletes their call sites).

### Pasteable prompt

```
Read first, in this order: CONVENTIONS.md in full (it is mandatory and there is
no CLAUDE.md in this repo, so nothing loads it for you — §7 "SWR for all new data
fetching" governs the hook and provider below), then
docs/UNITS-CANONICALIZATION-PLAN.md including its "Reading order for every phase"
section, which tells you how to treat docs/ARCHITECTURE.md. Several of that
file's unit claims are wrong at HEAD and must not be trusted as current state.

Then implement Phase 1 only.

Goal: build the unit-conversion foundation. Change no existing behaviour and no
existing render path.

Deliver:
1. utils/unit-conversions.ts — KG_PER_LB = 0.45359237 and CM_PER_IN = 2.54 as the
   only conversion constants in the file; lbsToKg/kgToLbs/inToCm/cmToIn;
   formatWeight(valueKg, viewer) and formatLength(valueCm, viewer) returning
   { value, unit }; parseWeightToKg(input, viewer), parseLengthToCm(input, viewer)
   and parseHeightToCm. Export `type UnitSystem = "metric" | "imperial"`.
   Formatters return numbers, not pre-formatted strings — callers own rounding.
   Plus two special cases, both specified in the doc's decision section:
   - formatLoad(valueKg, viewer) — for barbell loads. Converts AND snaps to the
     smallest loadable increment: 2.5 kg metric, 5 lb imperial. A faithful
     conversion of a prescribed load is unloadable on a real bar, so this is a
     distinct helper from formatWeight, not an option on it.
   - formatHeight(valueCm, viewer) — imperial height is composite (5'11", never
     "71 in"). Return a discriminated union:
     { system: "metric"; value: number; unit: "cm" } |
     { system: "imperial"; feet: number; inches: number }
2. supabase/migrations/140_add_coach_unit_preference.sql — add
   coaches.unit_preference TEXT NOT NULL DEFAULT 'metric'
   CHECK (unit_preference IN ('metric','imperial')), with a COMMENT ON COLUMN.
   The default is metric deliberately: 206 of 208 clients on Dev are kg, and the
   existing imperial defaults on the clients table are backwards for this
   platform's users.
3. Add unitPreference to the Coach type (types/check-in.ts:346) and to
   mapCoachRow (lib/mappers.ts:180).
4. lib/viewer-preferences.ts — getViewerUnitPreference(request) resolving the
   authed coach or client to their preference, 'metric' when unauthenticated.
   Pass `request` through to the auth helpers (this repo's helpers take an
   optional request param and it must always be supplied).
5. GET /api/me/unit-preference — returns { preference } for the authed principal.
   Standard auth chain, Cache-Control: no-store.
6. contexts/units-context.tsx — UnitsProvider + useUnits(), SWR-backed against
   that route. Mount it in app/layout.tsx next to AuthProvider and
   IntakePanelProvider (that layout wraps both the coach and client surfaces).

Do NOT: change any component that currently renders a unit; touch any settings
page; modify stored data; alter the existing exports in utils/nutrition-helpers.ts.

Tests: unit tests for every conversion and formatter including identity cases
(kg + metric returns kg unchanged), both conversion directions, and 0/fractional
inputs. formatLoad must be tested for the snapping specifically (e.g. 100 kg
viewed imperial lands on a multiple of 5 lb, not 220.5). formatHeight must be
tested for the inches-carry case (an input that would round to 12 inches becomes
the next foot, never 5'12"). Tests for getViewerUnitPreference covering
coach-authed, client-authed and unauthenticated.

Process: show me a plan and wait for my approval before editing any file. I run
`npx supabase db push` myself — when the migration is ready, stop and tell me to
run it, then regenerate types/database.ts and commit the migration and types
together. Commit directly to main; do not create a branch.

Gates before committing: rm -rf .next && npx tsc --noEmit, npm run lint,
npx vitest run, npm run check:labels. The set-tracker test is known to be flaky
in full runs — re-run it before assuming you broke it.
```

---

## Phase 2 — Canonical storage · **SHIPPED** `0a99622` 2026-08-06

**Goal**: every stored weight is kg, every stored length is cm, and the unit-tag
columns are gone.

**Conversion inventory**

| Table | Column(s) | Today | After |
|---|---|---|---|
| `clients` | `current_weight`, `starting_weight`, `goal_weight` | per `weight_unit` | **kg** |
| `clients` | `height` | per `height_unit` | **cm** |
| `clients` | `weight_unit`, `height_unit` | tags | **DROP** |
| `clients` | `unit_preference` | mixed duty, `DEFAULT 'imperial'` | kept as the client's viewer preference; **default flipped to `'metric'`** |
| `client_goals` | `goal_weight` | untagged display | **kg** |
| `check_ins` | `weight` | per `weight_unit` | **kg** |
| `check_ins` | `waist`, `hips`, `chest`, `arms`, `thighs` | per `measurement_unit` | **cm** |
| `check_ins` | `weight_unit`, `measurement_unit` | tags | **DROP** |
| `body_metrics` | `weight` | per `weight_unit`, 72 NULL | **kg** |
| `body_metrics` | `weight_unit` | tag | **DROP** |
| `client_metric_entries` | `value` (weight rows) | untagged display | **kg** |
| `client_metric_entries` | `value` (girth rows) | assumed inches | **cm** |
| `set_logs` | `weight` | untagged | **kg** |
| `exercise_logs` | `weight_unit` | orphan tag (value moved away in mig 090) | **DROP** |
| `check_in_exercise_highlights` | `weight_value` / `weight_unit` | mixed | **kg** / **DROP** |
| `client_intake` | `current_weight`, `target_weight`, `height` | already kg/cm | unchanged |
| `client_intake` | `weight_unit`, `height_unit` | dead, never written | **DROP** |
| `nutrition_plans` | `base_weight_kg`, `goal_weight_kg` | kg | unchanged — verify |
| `training_plans` | `client_weight_kg`, `client_goal_weight_kg` | always NULL in prod | unchanged |
| `training_exercises.set_specs` (JSONB) | `load_value` | kg by UI convention | kg — now canonical, document it |

**Order matters**: convert values using the tag columns *first*, then drop the
tags, in the same migration.

**Known traps**

- **CORRECTED — the intake trap's stated mechanism is false.** The claim was that
  `services/client-service.ts:50` inserts NULL units, so a backfill should treat
  NULL as already-kg. It does not: `lib/validations/client.ts:19,26` are
  `.optional().default("in")` / `.default("lbs")`, so `clientData.heightUnit` /
  `weightUnit` are always defined and the `isIntakeMode ? null : …` branch never
  yields null. Intake clients are labelled `'in'`/`'lbs'` **explicitly**.
  What actually makes the tag rule safe is a different mechanism:
  `client_intake.weight_unit` defaults to `'kg'`
  (`034_add_client_intake_and_onboarding_status.sql:30`) and
  `services/intake-review-service.ts:173` copied it to `clients.weight_unit`, so
  an intake-synced client carries a **kg tag over a kg value**. Migration 141
  therefore keys on the tag, and it converted zero `clients` rows.
- **Three unit columns disagree.** On Dev, 52 of 208 clients have
  `unit_preference='imperial'` while `weight_unit='kg'` and `height_unit='cm'`.
  Trust `weight_unit`/`height_unit` for the value conversion, not
  `unit_preference`.
- **`nutrition-calc-inputs.ts:90` prefers `body_metrics.weight_unit` over
  `clients.weight_unit`** — three tag columns feed conversion, not two.
- **Untagged tables** (`set_logs`, `client_metric_entries`) can only be inferred
  from the owning client's `weight_unit` at backfill time. Best-effort is fine
  on test data.
- **CORRECTED — `exercise_logs.weight_unit` looks like a per-row tag for
  `set_logs`, and using it would have corrupted 9,630 rows.** It is noise: the
  column defaults to `'lbs'` (`027:35`), `scripts/seed-scale-client.ts:235` and
  `scripts/perf-correctness.ts:206` hardcode `"lbs"` beside kg-magnitude values,
  and `set-tracker.tsx:163` falls back to `"lbs"`. Proof it carries no meaning:
  the kg-tagged rows have a median of **42.3 for every exercise** — Archer Pull
  Up, Band Dislocate, Axle Press alike — which is scale-seed noise. Keying on the
  owning client instead converted 21 rows.
- **CORRECTED — an `'in'` measurement tag does not mean the girths are inches.**
  8 of the 111 `in`-tagged rows carrying a waist were centimetres wearing an
  `'in'` tag (waist 88.5–92.0, arms 38–39, thighs 58–60 — coherent in cm,
  impossible in inches). Migration 141 guards on the VALUE
  (`COALESCE(waist, hips, chest) < 60`), because legitimate inches reach waist
  36.1 / hips 40.0 / chest 42.0 while centimetres start at 62.0 / 70.0 / 75.0.
  `arms`/`thighs` are excluded from that COALESCE — their ranges straddle 60.
- **CORRECTED — a `'lbs'` weight tag on `check_ins` is ambiguous by
  construction.** The column defaults to `'lbs'` (`001:16`) and
  `app/api/client/check-ins/route.ts` stored `?? "lbs"`, while
  `components/check-in/step-metrics.tsx:81` highlights **kg** when the toggle is
  untouched — so an unset form recorded a kg number as pounds, indistinguishable
  afterwards from a real lbs choice. Migration 141 requires corroboration from
  the client's own tag; Phase 2 also flipped that API fallback to `'kg'` so new
  rows cannot repeat it. Girths keep the `'in'` fallback, where the toggle and
  the default agree. **Residual, accepted:** a kg-tagged client who deliberately
  picks lbs on one check-in is under-converted — unresolvable from data.
- **Tests hardcode the old constants**: `services/nutrition-calc-inputs.test.ts:46,47,81,139`
  assert against `2.205`; `app/api/clients/[id]/nutrition/route.test.ts:67` and
  `app/api/clients/[id]/training/route.test.ts:35` mock `weightToKg` as
  `0.453592`. All must be updated or deleted.
- **`client_intake` CHECK allows `('kg','lb')` while `clients` allows
  `('lbs','kg')`** — `lb` vs `lbs`. Both constraints disappear with the columns.

### Pasteable prompt

```
Read first, in this order: CONVENTIONS.md in full (it is mandatory and there is
no CLAUDE.md in this repo, so nothing loads it for you — note its service-layer
and migration rules), then docs/UNITS-CANONICALIZATION-PLAN.md including its
"Reading order for every phase" section, which tells you how to treat
docs/ARCHITECTURE.md. Several of that file's unit claims are wrong at HEAD. One
matters directly to this phase: line 74 says resolveEffectiveGoal is "the one
place" goal weights are normalized to kg. It is not — hooks/use-nutrition-plan.ts:139
and hooks/use-nutrition-builder.ts:287 do it too, and both must be removed here.

Then implement Phase 2 only. Phase 1 is already merged, so
utils/unit-conversions.ts and coaches.unit_preference exist.

Goal: convert every stored weight to kilograms and every stored length to
centimetres, then drop the per-row and per-client unit-tag columns. Update every
write path so new rows are written canonically.

The conversion inventory and the known traps are in the Phase 2 section of that
doc — read the trap list carefully before writing the migration, especially the
intake trap (NULL weight_unit means the value is ALREADY kg, not lbs).

There are no paying clients; every account is a test account. The backfill does
not need to be reversible. Convert correctly where a unit tag exists and
best-effort where it does not.

Deliver:
1. One migration (next sequential number after 140) that converts values FIRST
   using the tag columns, then drops the tag columns. Use 0.45359237 and 2.54.
   In the same migration, flip clients.unit_preference to DEFAULT 'metric' — the
   existing 'imperial' default is backwards for this platform (206 of 208 Dev
   clients are kg). Leave existing row values alone; only the default changes.
2. Every write path updated to store kg/cm: services/client-service.ts,
   services/client-check-in-service.ts, services/check-in-service.ts,
   services/body-metrics-service.ts, services/metric-entries-service.ts,
   services/intake-review-service.ts, services/training-log-service.ts,
   app/api/clients/[id]/metrics/route.ts, app/api/client/check-ins/route.ts.
3. Every read path that currently applies weightToKg / weightFromKg deleted —
   the value is already kg. This includes services/nutrition-calc-inputs.ts,
   lib/goals/resolve-effective-goal.ts, hooks/use-nutrition-plan.ts,
   hooks/use-nutrition-builder.ts, services/comparison-service.ts,
   components/clients/metrics/hooks/use-merged-metrics.ts.
4. services/bmr-service.ts stops converting — it receives kg and cm directly.
5. Update or delete the tests that hardcode 2.205 / 0.453592 (listed in the doc).

Do NOT: change any hardcoded "kg"/"lbs" display string — that is Phase 3. Expect
the UI to show kg numbers under stale labels after this phase; that is correct
and expected.

Process: show me a plan and wait for my approval before editing any file. I run
`npx supabase db push` myself — when the migration is ready, stop and tell me to
run it, then regenerate types/database.ts and commit the migration and types
together. Commit directly to main; do not create a branch.

Gates before committing: rm -rf .next && npx tsc --noEmit, npm run lint,
npx vitest run, npm run check:rls. The set-tracker test is known to be flaky in
full runs — re-run it before assuming you broke it.
```

---

## Phase 3 — Presentation sweep · **SHIPPED** 2026-08-06

Batch 0 + A–F: `ebf1bb6` `8716087` `bc7b417` `34a11d7` `041b6af` `ef6cf5c`
`2378db4` `f6c3313` `c9bec09` `33b3b46` `9f1fe3a`.

### What this section got wrong — read before trusting any bullet below

**The sweep was not "wide but mechanical".** Five claims in this section were
false at execution time and two of them would have corrupted data:

1. **`set-row-editor.tsx` and `drop-set-editor.tsx` are editable INPUTS, not
   displays.** This section says they "render through `formatLoad`". They must
   NOT. `formatLoad` snaps, those inputs are uncontrolled and write on every
   blur, so the snap round-trips into `set_specs`: an imperial coach opens a
   100 kg session, sees 220, tabs past without editing, and stores 99.79 kg —
   per field, having changed nothing. Editable loads seed from an UNSNAPPED
   conversion and commit behind a **field-level** dirty guard
   (`program-builder/commit-input.ts`). Row-level is not enough: a row is dirty
   the moment its reps change.
2. **`formatWeight` (the canonical one) had ZERO call sites**, not three. The
   "three coach-facing nutrition banners" were calling the OLD `formatWeight`
   from `utils/nutrition-helpers.ts` — a name collision, and a migration target
   rather than evidence of prior work.
3. **`nutrition-targets-block.tsx` needed no prop thread.** The appendix blames
   a missing prop at `drawer-form-body.tsx:62`. Both are `"use client"` inside
   the builder tree, so the block reads `useUnits()` directly. The missing-prop
   framing belonged to the old model where the CLIENT's preference had to travel.
4. **`progression-rules.ts:83` is `roundHalf` (0.5), not 2.5 kg plate math**, and
   `duplicate-week-dialog.tsx`'s 2.5 is a default input value (its step is 0.5).
   The inline correction above this section is right; the bullets below were not.
5. **The imperial snap is 2.5 lb, not 5** (`33b3b46`, superseding Phase 1). At
   5 lb a coach's 2.5 kg weekly bump renders as +10 lb against a real +5.5 —
   roughly double — on the light dumbbell loads that dominate real prescriptions.
   Above ~40 kg the two increments are indistinguishable.

### Three carve-outs Phase 4 must retire WITH their forms

Each is a live WRITE path, not a display shim, and each is commented at its
declaration. Removing one alone corrupts data:

- **`lib/mappers.ts`'s `heightUnit: "cm"` + `Client.heightUnit`.**
  `client-settings-dialog.tsx:80` seeds its unit `<Select>` from
  `client.heightUnit ?? "in"` and `:127` sends it back, where `client-service`
  converts on the tag. Remove the shim and ANY save of that dialog stores
  height × 2.54 (178 → 452 cm) — `toDefaults()` pre-populates the field, so it
  does not need a height edit to fire.
- **`BodyMetrics.weightUnit` / `measurementUnit`** — the check-in FORM's wire
  tags (`step-metrics.tsx` toggles → `check-in-canonical-metrics.ts`). This
  section listed them for deletion; tsc proved otherwise.
- **`CheckInExerciseHighlight.weightUnit`**, same, via
  `exercise-highlights-section.tsx`.

### Two bugs found that were not unit bugs

- **`0c4cebf` was a regression, not a fix** (corrected in `ebf1bb6`). The client
  check-in route serves RAW snake_case rows; the page's original snake_case reads
  were correct and that commit rewrote them to camelCase. Its stated guard —
  "tsc now verifies every field name" — does not hold across a fetch, because
  `response.json()` is `any`.
- **`training-log-service.ts` carried a LOCAL `mapExerciseRow`** that dropped
  `set_specs`/`video_url`, so the client portal had never seen a prescribed load,
  per-set rest or set types — while the compact reps/RPE columns came through and
  made the payload look complete (`c9bec09`).

### Notes for Phase 4

- **`useUnits()` reaches `auth-context` → the browser Supabase client, which
  throws without env vars.** ~20 test suites needed
  `vi.mock("@/contexts/units-context")`. Expect it on every new consumer.
- **A green suite repeatedly proved nothing.** The warning strings, the nutrition
  targets block, `buildLogPayload` and `exercise-insight` all had zero coverage,
  so the full suite passed identically before and after each change.
- **tsc cannot gate route-shape vs page-shape drift.** Batch F ends with an
  explicit grep over `app/api/**` for hand-built unit keys instead.

---

**Goal**: no component invents a unit. Every unit-bearing value renders through
the Phase 1 helpers with the viewer's preference from `useUnits()`.

**Pick the right helper.** This is the part to get right, not the string
replacement:

| Value | Helper | Why |
|---|---|---|
| Barbell load — prescribed or logged, PRs, e1RM, volume | `formatLoad` | Must snap to a loadable increment; see the decision section |
| Body weight, goal weight, weight change/rate | `formatWeight` | Converts freely, no snapping |
| Girth measurements (waist, hips, chest, arms, thighs) | `formatLength` | Decimal inches are correct here |
| Height | `formatHeight` | Imperial height is composite — `5'11"`, never `71 in` |

**Scope** — roughly 101 hardcoded `kg`/`lbs` literals across ~40 non-test
component files, plus ~43 `cm`/`in` sites. Named offenders:

- `components/clients/nutrition/builder/nutrition-targets-block.tsx:152` — the
  originally reported bug (`{" kg/week"}`), plus the missing prop thread at
  `drawer-form-body.tsx:62`.
- `services/nutrition-service.ts:156,162` — the safety-cap warnings bake
  `kg/week` **into the string** inside the pure calculator. These cannot be
  fixed at the render boundary; return structured data and let the renderer
  format it.
- `components/training/exercise-data/exercise-insight.ts` — nine hardcoded `kg`
  labels on the coach KPI strip.
- `components/clients/overview/since-last-visit-section.tsx:25` —
  `const PR_WEIGHT_UNIT = "kg"` on the activity feed.
- `components/clients/metrics/hooks/use-merged-metrics.ts:28` —
  `MEASUREMENT_UNIT = "in"` while the stored girths are centimetres.
- `components/training/exercise-data/exercise-trend-chart.tsx` — renders weight,
  e1RM and volume with **no unit label at all** on either axis or the tooltip.
- `utils/ai-prompt-builder.ts:42,104,163` — leaks units into LLM prompts;
  line 104 has no fallback and can emit `100undefined`.
- `utils/progression-rules.ts:26` — `unit: "kg" | "percent"` conflates a
  physical unit with a progression *mode*. Split the two axes.
- `utils/progression-rules.ts:83` and
  `components/clients/training/program-builder/duplicate-week-dialog.tsx:72` —
  the 0.5 / 2.5 rounding is metric plate math. These are the *arithmetic* half
  of the load-rounding rule; the display half is `formatLoad` everywhere a load
  is rendered.
- `components/clients/training/program-builder/set-row-editor.tsx:62` and
  `drop-set-editor.tsx:56` — the load dropdown and placeholder are hardcoded
  `kg`. These are prescribed loads, so they render through `formatLoad`.
- `components/client-portal/training/set-tracker.tsx` and
  `exercise-tracker-block.tsx` — the client's log form. Note it currently never
  displays the prescribed load at all, which is how the coach-authors-kg /
  client-logs-lbs mismatch stayed invisible. Showing it is in scope.
- Null-unit fallbacks are split across the codebase — five sites default to
  `"kg"`, at least twelve to `"lbs"`. All of them disappear.

**Also delete in this phase**: `utils/nutrition-helpers.ts`'s `lbsToKg`,
`kgToLbs`, `inchesToCm`, `cmToInches`, `weightToKg`, `weightFromKg`,
`formatWeight`, `getProteinTargetLabel`, and the hand-rounded `PROTEIN_TARGETS`
`gPerLb` values. Grep at execution time for live call sites rather than trusting
this list.

### Pasteable prompt

```
Read first, in this order: CONVENTIONS.md in full (it is mandatory and there is
no CLAUDE.md in this repo, so nothing loads it for you — note §2 scope discipline
and "one fix per change", which matter for a sweep this wide), then
docs/UNITS-CANONICALIZATION-PLAN.md including its "Reading order for every phase"
section, which tells you how to treat docs/ARCHITECTURE.md. Several of that
file's unit claims are wrong at HEAD. One matters directly to this phase: lines
422 and 484 claim the client portal already renders weights via formatWeight. It
does not — formatWeight has three call sites, all coach-facing nutrition banners,
and zero in components/client-portal/**. Do not let that claim shrink your sweep.

Then implement Phase 3 only. Phases 1 and 2 are merged: all stored weights are
kilograms, all stored lengths are centimetres, the unit-tag columns are gone, and
utils/unit-conversions.ts plus the UnitsProvider/useUnits() context exist.

Goal: make every unit-bearing value render through formatWeight/formatLength
using the viewer's preference. No component may invent or hardcode a unit label.

The Phase 3 section of that doc names the specific offenders. Treat it as a
starting point, not the full list — grep for the real inventory at execution
time:
  grep -rnoE '\bkg\b|\blbs\b' --include=*.tsx components app | grep -v '\.test\.'
  grep -rnE '\bcm\b|\binches\b|\bin\)' --include=*.tsx components app | grep -v '\.test\.'

Rules:
- Client components read the preference from useUnits().
- Server-rendered human-readable text (utils/ai-prompt-builder.ts) resolves it
  via getViewerUnitPreference(request).
- PICK THE RIGHT HELPER. There is a table in the Phase 3 section of the doc.
  The important distinction: every barbell load — prescribed, logged, PR, e1RM,
  volume — goes through formatLoad, which snaps to a loadable increment. A
  faithful conversion of 100 kg is 220.5 lbs, which nobody can load on a bar.
  Body weight uses formatWeight and does NOT snap. Height uses formatHeight and
  renders 5'11", never "71 in". Girths use formatLength.
- services/nutrition-service.ts must stop baking "kg/week" into its warning
  strings — return structured data and format at the render layer.
- utils/progression-rules.ts:26 conflates unit and progression mode in one
  discriminator; separate those axes.
- Progression/plate-math increments (progression-rules.ts:83,
  duplicate-week-dialog.tsx:72) must round to the viewer's unit — the arithmetic
  counterpart of the formatLoad display rule.
- Charts must carry a unit label — exercise-trend-chart.tsx currently has none
  anywhere.
- The client's log form (set-tracker.tsx / exercise-tracker-block.tsx) currently
  never shows the prescribed load. Show it, in the viewer's unit via formatLoad.
- Delete every now-dead conversion helper and duplicated unit branch, including
  the ones in utils/nutrition-helpers.ts. Fix at the root; no band-aids, no
  leaving a shim "for now".

Follow docs/newdesignsystem.md for any markup you touch, import shared tokens
rather than re-declaring them, and keep JetBrains Mono on numerals only — unit
labels are words and stay in the sans face. npm run check:labels enforces this.

Do NOT: change stored data or any migration; change settings UI or form write
paths (that is Phase 4).

Process: show me a plan and wait for my approval before editing any file. Given
the size, group the sweep into reviewable batches and show me the full punch list
in the plan. Commit directly to main; do not create a branch.

Gates before committing: rm -rf .next && npx tsc --noEmit, npm run lint,
npx vitest run, npm run check:labels, npm run knip (to confirm the deleted
helpers really are unreferenced). The set-tracker test is known to be flaky in
full runs — re-run it before assuming you broke it.
```

---

## Phase 4 — Viewer preference UI and write paths · **SHIPPED** 2026-08-07

Batches A–F: `61206da` `6f3fef8` `f6da84c` `c67cfcb` `469b2f8` `2612a09`
`7dcdebe` `84aafb2`.

### What this section got wrong — read before trusting any bullet below

1. **"Delete the drawer toggle" was right; "delete the intake toggle" was
   wrong, and this document never said the second one out loud.** The scope
   below only says intake "already converts — point it at the shared helper".
   The executable reading was to replace its localStorage toggle with
   `useUnits()`. That strands imperial clients: `app/client/layout.tsx:56-62`
   redirects a `pending_intake` client to the intake form and `:102` returns
   `null` for every other route, so `/client/settings` is unreachable until
   activation, and `clients.unit_preference` defaults to `'metric'`. The toggle
   had to STAY and be repointed at `PATCH /api/client/settings`, which is
   reachable pre-activation because `getAuthenticatedClientId` gates on
   `clients.active` (set at creation, `client-service.ts:70`) rather than on
   `onboarding_status`.
2. **The `2.20462` this section tells Phase 4 to delete was already gone**,
   removed by Phase 3. What was actually left in intake was the localStorage
   toggle.
3. **`client-goal-editor.tsx` was already done**, including its seeded-string
   dirty guard. The scope lists it as Phase 4 work.
4. **The lbs-shaped validation range appears SIX times, not once.** This
   section names only `metric-entry-definitions.ts:31`. Also live:
   `client-metrics.ts:4` and `:6`, `client-goals.ts:23` (behind the goal editor,
   which has sent canonical kg since Phase 3), `metrics/route.ts:62` (a
   narrower inline copy), and `check-in.ts:89`. All now read
   `WEIGHT_KG_MIN`/`WEIGHT_KG_MAX` from `lib/constants.ts`.
5. **`mapClientRow` defaulted a NULL `unit_preference` to IMPERIAL** while the
   column default, `DEFAULT_UNIT_SYSTEM` and `readClientPreference` all said
   metric — so such a client saw metric everywhere `useUnits()` reached and
   imperial in the settings form. Not mentioned anywhere in this plan.

### Decisions taken during execution

- **Check-in unit tags are now conditionally REQUIRED**, not defaulted. Both
  fallbacks are deleted: an untagged weight or girth is a 400. The girth
  fallback (`?? "in"`) and the weight branch (converts only on explicit
  `"lbs"`) disagreed about what the same silence meant. Requiredness is what
  makes a wire tag safe; this is why `logTrainingEventSchema.weightUnit` was
  always safe and these were not.
- **`setSpecSchema.load_value` keeps its literal bound.** It is polymorphic —
  absolute kilograms when `load_type` is `"absolute"`, a percentage otherwise —
  so naming it `LOAD_KG_MAX` would assert something false about half its values.
- **Girth and load ceilings kept their VALUES** (200/100 cm, 2000 kg) and were
  only named and documented. They were unit-*blind*, not wrong. Only the weight
  ceiling changed, 700 → 250.

### Coverage note

Five of the seven files this phase touched most had **no test file at all**
(`lib/mappers.ts`, `log-measurement-dialog.tsx`, `client-metrics.ts`,
`metric-entries.ts`, the settings pages), so the suite passed identically
before and after each fix — the same "green proved nothing" shape Phase 3
recorded. Every behaviour change in this phase was mutation-tested against the
pre-change code before being trusted.

---

**Goal**: both a coach and a client can set their own unit, and every form
accepts input in the viewer's unit while storing kg/cm.

**Scope**

- **Coach settings.** `app/settings/page.tsx` is currently a 78-line static mock
  — no fetch, no save handler, hardcoded "Coach Name". It needs real wiring for
  the units toggle. `PATCH /api/coach/settings` and
  `updateCoachSettingsSchema` (`lib/validations/coach.ts`) exist but accept
  `timezone` only; extend them with `unitPreference`.
- **Client settings.** `app/client/settings/page.tsx` already has an
  Imperial/Metric radio group. Rewire it to write only the viewer preference.
  **DONE IN PHASE 2, not here** — `services/client-service.ts` no longer derives
  `weight_unit`. This entry used to schedule that removal for Phase 4 while also
  stating the column is gone after Phase 2, which is a contradiction: the derived
  write is reached by `PATCH /api/client/settings`
  (`app/api/client/settings/route.ts:44`), so leaving it would have PGRST204'd
  and 500'd every client settings save — including the unit toggle this phase
  wires. Nothing to do here; do not go looking for it.
  The settings label promises a cm switch it never performed; with canonical cm
  that promise now holds.
- **Delete the drawer toggle outright.** `hooks/use-nutrition-plan.ts:107-119`
  currently PATCHes `/api/clients/{id}/nutrition` to mutate the *client's*
  `unit_preference` when the coach flips the drawer toggle — a cross-user write.
  Do not rewire it to write the coach's preference instead: once the coach always
  sees their own unit, the client's unit is irrelevant to the coach's view and
  the toggle has no job. A control inside one client's drawer that silently
  changes units app-wide is worse than no control. It is a vestige of the broken
  model.

  Delete `components/clients/shared/unit-toggle.tsx` (it has exactly one call
  site, `drawer-header.tsx:50`), the `unitPreference` / `handleUnitChange` /
  `isSavingUnit` members of `use-nutrition-plan.ts`, and the `unitPreference`
  branch in `app/api/clients/[id]/nutrition/route.ts:292-302`. Settings becomes
  the single place a unit is chosen.
- **Form write paths.** Inputs display the viewer's unit and convert with
  `parseWeightToKg` / `parseLengthToCm` on submit: the check-in metrics step,
  the intake step (which already converts — point it at the shared helper and
  delete its local `2.20462`), `add-client-manual-form.tsx`,
  `add-client-dialog.tsx`, `client-settings-dialog.tsx`, `log-measurement-dialog.tsx`,
  and `client-goal-editor.tsx`.
- **Unit-blind validation ranges.** `lib/metrics/metric-entry-definitions.ts:31-37`
  uses a lbs-shaped weight range (20–700) and one girth range for both inches and
  cm. Re-express in kg/cm.
- **Dead code.** `lib/validations/nutrition.ts:68-70` (`updateUnitPreferenceSchema`)
  has zero references — delete it.

**Finally, the docs.** Two jobs, both in scope:

- Add a `## Units` section to `CONVENTIONS.md` stating the rule — storage is
  kg/cm, preference is per-viewer, all rendering goes through
  `utils/unit-conversions.ts`, no unit literal in JSX, and which helper applies
  to which kind of value. That is the guard that stops this regressing.
- **Correct `docs/ARCHITECTURE.md` lines 74, 422, 453 and 484.** They are wrong
  today (see "Reading order for every phase") and will be wrong in a *new* way
  once this ships: `formatWeight`'s signature changes, the `weight_unit` columns
  no longer exist, and the "Phase 8, not yet built" references dangle. This is
  not deferrable doc reconciliation — it is part of finishing the job.

Still deferred: reconciling `docs/CLIENT-PORTAL-REDESIGN.md:260-338` and the
Phase 8 sessions in `docs/CLIENT-PORTAL-EXECUTION-PLAN.md`, which this plan
supersedes wholesale.

### Pasteable prompt

```
Read first, in this order: CONVENTIONS.md in full (it is mandatory and there is
no CLAUDE.md in this repo, so nothing loads it for you), then
docs/UNITS-CANONICALIZATION-PLAN.md including its "Reading order for every phase"
section. That section lists four wrong unit claims in docs/ARCHITECTURE.md
(lines 74, 422, 453, 484) — this phase is where you correct them, so read it
carefully and treat the table there as your punch list.

Then implement Phase 4 only — the final phase. Phases 1-3 are merged: storage is
canonical kg/cm, utils/unit-conversions.ts and the UnitsProvider exist, and every
render path already converts through them.

Goal: let a coach and a client each set their own unit preference, and make every
form accept input in the viewer's unit while storing kg/cm.

Deliver:
1. Coach settings units toggle. app/settings/page.tsx is a static unwired mock —
   wire the units card for real. PATCH /api/coach/settings and
   updateCoachSettingsSchema (lib/validations/coach.ts) currently accept timezone
   only; extend both with unitPreference.
2. Client settings: rewire app/client/settings/page.tsx to write only the viewer
   preference. (services/client-service.ts already stopped deriving weight_unit —
   that landed in Phase 2, because leaving it would have 500'd every settings
   save the moment the column was dropped. Nothing to do there.)
   LANDMINE (Phase 1): the coach's preference lives in TWO client-side SWR caches
   — the units route AND /api/auth/me, which carries it inside coach.unitPreference.
   Every site that writes a preference must call useInvalidateUnitPreference()
   from contexts/units-context.tsx, which clears both areas. Invalidating one
   leaves useAuth().coach stale with nothing erroring. A test that factory-mocks
   @/contexts/auth-context and mounts UnitsProvider must include isMeKey in the
   mock, or the second invalidation is a silent no-op.
3. DELETE the drawer unit toggle rather than rewiring it. hooks/use-nutrition-plan.ts:107-119
   currently PATCHes the CLIENT's unit_preference when the coach flips it — a
   cross-user write. Do not repoint it at the coach's preference: once the coach
   always sees their own unit, the toggle has no job, and a control in one
   client's drawer that changes units app-wide is worse than no control. Remove
   components/clients/shared/unit-toggle.tsx (single call site,
   drawer-header.tsx:50), the unitPreference/handleUnitChange/isSavingUnit
   members of use-nutrition-plan.ts, and the unitPreference branch in
   app/api/clients/[id]/nutrition/route.ts. Settings is the only place a unit is
   chosen.
4. Form write paths convert on submit via parseWeightToKg / parseLengthToCm /
   parseHeightToCm: the check-in metrics step, the intake step (delete its local
   2.20462 constant and use the shared helper), add-client-manual-form.tsx,
   add-client-dialog.tsx, client-settings-dialog.tsx, log-measurement-dialog.tsx,
   client-goal-editor.tsx. Height inputs must accept feet+inches for an imperial
   viewer, not decimal inches.
5. Re-express lib/metrics/metric-entry-definitions.ts:31-37 validation ranges in
   kg/cm — they are currently lbs-shaped and unit-blind.
6. Delete lib/validations/nutrition.ts:68-70 (updateUnitPreferenceSchema, zero
   references).
7. Add a "## Units" section to CONVENTIONS.md: storage is kg/cm, preference is
   per-viewer, all rendering goes through utils/unit-conversions.ts, no unit
   literal belongs in JSX, and which helper applies to which kind of value
   (formatLoad for barbell loads and why it snaps, formatWeight for body weight,
   formatHeight for height, formatLength for girths).
8. Correct docs/ARCHITECTURE.md lines 74, 422, 453 and 484. They are wrong today
   and will be wrong differently after this ships — formatWeight's signature
   changes, the weight_unit columns are gone, and the "Phase 8, not yet built"
   references dangle. The table in the plan's "Reading order for every phase"
   section is your punch list. Leave docs/CLIENT-PORTAL-REDESIGN.md alone; that
   reconciliation stays deferred.

Follow docs/newdesignsystem.md for the settings UI and import its shared
components and tokens rather than hand-rolling them.

Process: show me a plan and wait for my approval before editing any file. Commit
directly to main; do not create a branch.

Gates before committing: rm -rf .next && npx tsc --noEmit, npm run lint,
npx vitest run, npm run check:labels. The set-tracker test is known to be flaky
in full runs — re-run it before assuming you broke it.

When the gates pass, give me a browser smoke checklist to run myself — I do not
want the browser driven for me. It must cover: a metric coach viewing an imperial
client, an imperial coach viewing a metric client, the same client viewing their
own data, a weight entered in one unit reading back correctly in the other, a
height rendering as 5'11" rather than 71 in for an imperial viewer, and a
prescribed load landing on a loadable number (a multiple of 5 lb, not 220.5).
```

---

## Appendix — what was wrong before this work

Recorded so the fix can be checked against the original diagnosis.

**Root cause of the reported bug.** Two faults stacked:
`nutrition-targets-block.tsx:152` appends the literal `{" kg/week"}`, and
`drawer-form-body.tsx:62` mounts that component with ten props, none of which is
a unit. The Targets block was structurally unable to react to the toggle. Its
sibling `NutritionGoalChangedBanner` fourteen lines earlier *did* receive
`unitPreference`.

**Data-integrity bugs this plan closes.**

1. `services/client-service.ts:354-357` flipped `weight_unit` on a settings
   change and converted zero stored numbers — a 180 lbs client picking Metric
   became a 180 kg client across every table and chart.
2. `get_exercise_progression` / `get_exercise_prs` select `sl.weight` without
   joining `exercise_logs.weight_unit`, so volume, Epley e1RM and PRs summed
   across mixed units.
3. The coach authored loads in hardcoded kg while the client logged in
   `clients.weight_unit` (default lbs), with no conversion and no display of the
   prescribed load in the client's log form.
4. The coach Metrics page hardcoded girths to inches while 2,737 of 2,857
   check-in rows were centimetres.
5. `services/intake-review-service.ts:175-179` force-set every approved intake
   client to metric, because the intake unit toggle only ever reached
   localStorage and `client_intake.weight_unit` was unwritable by any request.

**Documentation state at the time**: `TECHNICAL-DEBT.md` contained **zero**
entries about units across 107KB and 60 headings. `CONVENTIONS.md` had no unit
convention. `docs/newdesignsystem.md` had no rule for rendering a unit-bearing
value. The only written treatment was the superseded
`docs/CLIENT-PORTAL-REDESIGN.md:260-338`.

**`UnitToggle`** (`components/clients/shared/unit-toggle.tsx`) was rendered in
exactly one place in the entire application: `drawer-header.tsx:50`.
