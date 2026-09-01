# Handoff: URL-state mirroring sweep + animation inventory

Two independent jobs. **Job A is a code change with a plan; Job B is an investigation that ends in
a report and a decision, not a commit.** Do A first — it is small and settled — then B.

Read `CONVENTIONS.md` and `docs/ARCHITECTURE.md` in full before planning either. `CONVENTIONS.md`
§2 requires a plan before code, and the owner reviews plans before execution — do not start
editing on either job without sign-off.

---

## Job A — two components still mirror URL state into `useState`

### The rule they break

`CONVENTIONS.md` §7 → **"URL-driven UI state"** (added 2026-09-01). In short: anything
deep-linkable lives in the URL and nowhere else; `useState` must not shadow a search param; derive
from `searchParams` on every render and let the setter write only the URL. The section also names
the anti-pattern (**state mirroring**) and states that a transient glitch is the symptom of a split
source of truth, so the fix is deleting the local state rather than adding synchronisation.

Read that section first — it is the whole specification for this job.

### The reference implementation

`components/clients/metrics/metrics-tab-content.tsx:50-55` already does it correctly:

```tsx
const rawPane = searchParams.get("journey");
const pane: JourneySubtab = isJourneySubtab(rawPane) ? rawPane : "body";
const setPane = (t: JourneySubtab) => { /* build params */ router.replace(`?${params}`, { scroll: false }) };
```

`app/clients/[id]/page.tsx` was converted to the same shape on 2026-09-01 (commit `78876d85`) —
look at it for the second worked example, including how the fallback/validation is expressed.

### The two offenders

| File | Shape |
|---|---|
| `components/clients/training/exercise-data/exercise-data-view.tsx` | `:47` `useState<string \| null>(searchParams.get("exerciseId"))` and `:50` `useState(searchParams.get("exerciseName"))`; `:110` `setSelectedExerciseId(...)` **and** `:116` `router.replace(...)` — both written on every pick |
| `components/client-portal/metrics/performance/performance-view.tsx` | `:40` and `:43` the same two `useState`s; `:108` setter **and** `:114` `router.replace(...)` |

Line numbers are from 2026-09-01 — verify them rather than trusting them.

Both seed at **mount only**, so a URL change from outside the component never reaches the state.

### A hypothesis to verify before you plan — do not assume it

The coach-side one is reached by a **cross-tab drill-down**: the training history table sends
`?exerciseId=` through the client page's `handleTabChange` (ARCHITECTURE → "Client page tab
structure"). Because `exercise-data-view` seeds at mount, that drill-down may have been silently
selecting nothing — arriving with the param not yet in the URL, seeding `null`, and never
re-reading.

`78876d85` made the tab and its params land in one URL update, which **may** have already repaired
it. Check what actually happens now, in the browser, before deciding what the fix is worth. If the
drill-down works today, this is a tidy-up of a rule violation; if it does not, it is a bug fix and
should be smoked as one.

The other file is the client portal's own performance view — check how it is reached (it may have
no cross-tab path at all, in which case the mirroring is inert but still against the rule).

### Scope

- Derive both values from `searchParams`; delete the `useState` pair in each file.
- The setter writes the URL only.
- Keep `selectedMetric` / `sessionCount` / `metric` as local state — those are **not** in the URL
  and are not deep-linkable. The rule is about params, not about all state.
- Two files, one commit each, or one commit if the diffs are near-identical. Your call; say which
  in the plan.

### Gates (CONVENTIONS §13)

`npx tsc --noEmit` · `npx eslint .` · `npx vitest run` · `npm run check:labels` · `npx knip`.
CONVENTIONS §2's security/load review is **not applicable** — client-side routing only — and say so
explicitly in the commit rather than skipping it silently.

**Mutation-test any new assertion** before trusting it: break the thing the test claims to protect
and confirm the test fails. Two guards in this workstream passed against mutations because their
fixtures used the same number for two different fields. Back files up with `cp` to a scratchpad
first — **never `git stash` or `git checkout --`**, both destroy uncommitted work in this repo.

**The owner runs browser smokes.** Do not drive the browser. Hand over a checklist and state
plainly that the UI is unverified.

---

## Job B — animation inventory and a scope rule

**This job ends in a report, not a commit.** The owner wants to know how much animation exists and
where, then decide the rule. Do not remove anything before that decision.

### What is already known (verified 2026-09-01, re-verify rather than trust)

**`animate-card-in`** — the card-entrance animation (`translateY(10px)→0`, `opacity 0→1`,
`0.35s ease`; keyframe at `app/globals.css:179`). **6 call sites:**

| Site | Reaches |
|---|---|
| `components/programs/shared/stat-band.tsx` | **shared** — `app/clients/page.tsx`, `app/dashboard/programs/page.tsx`, `components/programs/programs-stat-band.tsx`, `components/clients/roster/roster-stat-band.tsx`, `components/clients/metrics/metric-hero.tsx` |
| `components/clients/overview/overview-primitives.tsx` | the shared `OverviewCard` — 9 consumers |
| `components/clients/overview/status-band.tsx` | Overview status band |
| `components/clients/habits/habits-summary-strip.tsx` | Habits tab |
| `components/clients/habits/habits-week-tracker.tsx` | Habits tab |
| `components/check-in/kpi-ribbon.tsx` | the check-in review's dark band |

**Other animation in the tree:**

| What | Count | Note |
|---|---|---|
| `framer-motion` importers | 19 files | includes marketing, auth pages, `daily-pulse` (frozen legacy — CONVENTIONS §6 says do not edit) |
| `animate-spin` | 88 | loading spinners — not in scope |
| `animate-in` / `animate-out` | 33 | Radix overlay enter/exit — not in scope |
| `animate-pulse` | 15 | skeletons — not in scope |
| `animate-drawer-slide-in` | 2 | documented in the SOT |

The five check-in section cards had framer entrance animations removed on 2026-09-01
(`723716e8`) — that tree is already clean, so exclude `components/check-in/**` except
`kpi-ribbon.tsx`.

### What the report needs to answer

1. **Every entrance/attention animation and its surface** — `animate-card-in` plus the
   `framer-motion` entrance animations (`initial`/`animate` on mount). Ignore spinners, skeletons
   and Radix overlay transitions; they are not what this is about.
2. **Which are shared** — a shared component's animation cannot be removed for one surface without
   removing it everywhere, and `stat-band.tsx` is the important one.
3. **Where the SOT stands.** `docs/newdesignsystem.md` documents the *mechanics* at `:751` and
   `stat-band`'s markup at `:553`, but says **nothing about where an animation may be used**. That
   gap is why the distribution is inconsistent. The report should propose the missing rule.

### The owner's position, and a proposal to react to

The owner's instinct: keep the animation on **the client Overview, the Clients roster, and the
Dashboard** only.

A previous session proposed the underlying principle as: **animate a surface you arrive at, not
one you are already on.** The check-in review is opened by clicking a row on a page you are already
looking at, so a band sliding up re-announces a page that never left; the Habits tab is the same. A
roster, a dashboard and an Overview are genuine arrivals. That framing produces the owner's list
and also decides the next case without another judgement call.

**Neither is settled — present both and let the owner choose.** If the rule is accepted it belongs
in `docs/newdesignsystem.md` beside the Animations table, since it is a visual-system rule.

### Documentation rules — this matters, the owner has been explicit

`docs/ARCHITECTURE.md` and `CONVENTIONS.md` describe **the current shape and the rules, nothing
else**. Never write what something used to be, what was shipped, what was reverted, or why a
decision was revisited. That belongs in commit messages. A doc paragraph that argues with its own
previous version is a defect.

The split between the two files: **CONVENTIONS holds rules for writing code** (read before writing
anything); **ARCHITECTURE holds the platform's shape** (read when you need to know how something is
wired). A rule goes in CONVENTIONS; a list of the platform's actual params, tables or surfaces goes
in ARCHITECTURE. `docs/newdesignsystem.md` is the authority for visual tokens and patterns.

---

## Context you will not otherwise have

- Recent work rewrote the coach's check-in review from three tabs to one page
  (`docs/CHECK-IN-REVIEW-REDESIGN-PLAN.md`). Its **R6** — a `knip` sweep and closing that plan doc
  out — is still owed and is not part of either job here.
- **All UI from that workstream is unverified.** Smoke checklists live in that plan at §10.11,
  §12.9, §13.8 and §14.12.
- The owner commits directly to `main`; no feature branches unless the work is risky or throwaway.
