# Women's strength training PWA

A private, offline-first strength training app. All data lives in the browser on
the user's own device — no account, no upload, no third-party requests.

The full architecture and build plan lives in **[The Strength Ledger](https://claude.ai/code/artifact/2ffc6ac0-3f4c-4720-9633-a3e7a483c5e6)**.
Read that first — it explains *why* the app is shaped this way.

## The two decisions everything else follows from

**1. The AI never decides what she lifts.** Code picks the exercise, the weight,
the sets and the reps. The model explains, swaps exercises from a curated
library, and assembles meals from a curated food table. This keeps the app
offline-capable, unit-testable, cheap to run, and safe.

**2. Training is autoregulated, not cycle-programmed.** Fixed per-phase weight
multipliers are not supported by the evidence
([McNulty 2020](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7497427/),
[Colenso-Semple 2023](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10076834/)) and
work against progressive overload. Instead the app autoregulates on a daily
readiness check-in, and — after roughly three logged cycles — surfaces the
user's *own* pattern from her *own* data.

## Status

**P0 to P2 are complete and verified.** The app is usable: onboarding builds a
programme, sessions rotate, sets log, weights progress, a daily check-in tunes
the session within visible bounds, and charts render.

| Phase | | |
|---|---|---|
| **P0** | Foundation | ✅ Done |
| **P1** | Onboarding, session logging, progression engine | ✅ Done |
| **P2** | Daily readiness check-in, bounded autoregulation | ✅ Done |
| **P3** | Cycle intelligence, per-user pattern detection | Next |
| **P4** | Nutrition targets + South Asian food table | |
| **P5** | AI coaching layer, then optional accounts | |

## What P0 delivers

- **Typed schema** where every record carries `SyncMeta` (`id`, `updatedAt`,
  `deletedAt`, `schemaVersion`). This cannot be retrofitted onto data already on
  users' phones, so it went in before the first user existed.
- **Dexie / IndexedDB** with a `[exerciseId+performedAt]` compound index, so
  "every squat set in the last 8 weeks" is a range scan.
- **Export / import** whose file *is* the future sync payload — same shape, same
  ids, same last-write-wins merge rule. The migration to a server is already
  testable, before a server exists.
- **Real PWA**: installable, service worker, fonts and icons bundled. Verified to
  make **zero external network requests**.
- **UUID v7** with the RFC 9562 monotonic counter, so ids sort chronologically
  even within a single millisecond.

## What P1 delivers

- **An eight-screen onboarding wizard**, one question per screen, that asks
  nothing the app does not visibly use.
- **A pattern-based programme.** Templates are written in movement patterns, not
  named exercises, so the planner resolves each slot against the equipment she
  actually owns. The same programme works in a full gym and in a bedroom with
  nothing at all.
- **Double progression.** Hold the weight until every working set reaches the top
  of the rep range at RIR ≤ 2, then add the smallest loadable increment. Deload
  after three flat sessions, never two.
- **Reps-in-reserve autoregulation** and an e1RM estimate that returns `null`
  above ~12 effective reps rather than a confident wrong number.
- **Session logging** with steppers, one-tap set removal, exercise swaps that
  persist, and rotation that advances by position rather than by weekday.
- **e1RM charts** drawn from the log, spaced by session so a holiday does not
  read as a cliff.

## What P2 delivers

This is the phase that replaces cycle-phase programming with something the
evidence actually supports.

- **A three-tap daily check-in** — sleep, energy, soreness — scored so that an
  ordinary day (all threes) is a full session. Only a genuinely poor day moves
  anything.
- **Bounded adjustment.** Amber takes ~5% off the bar; red takes ~10% and one
  set. Never more than that, and the original numbers are always shown beside
  the new ones. If rounding means nothing actually moved, the app says nothing.
- **One-tap override.** "Use my full weights today" restores the session and is
  recorded on it.
- **It notices when it is wrong.** After she overrides three of the last four
  low-readiness days, it asks whether to stop adjusting rather than silently
  learning to back off — she can see the conclusion and disagree with it.
- **Symptoms are logged but not scored.** Her energy rating already encodes how
  the cramps feel; scoring them too would bake in the population-level
  assumption this whole approach exists to avoid. They are raw material for the
  per-user pattern detection in P3.

## Commands

Install:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Run the tests:

```bash
npm test
```

Build and preview the real PWA (service worker only runs in a build):

```bash
npm run build && npm run preview
```

Regenerate the app icons after changing the mark:

```bash
node scripts/gen-icons.mjs
```

## Layout

```
src/
  config.ts          app name, colours, slug — rename the product here
  db/
    schema.ts        the data model and SyncMeta
    db.ts            Dexie instance and indexes
    repo.ts          every write goes through here, so SyncMeta is never missed
    export.ts        export, validation, import, last-write-wins merge
    queries.ts       read models — every number is derived, never stored
    actions.ts       every mutation the training UI performs
    seed.ts          deterministic demo history
    *.test.ts        round-trip, conflict, tombstone and reactivity tests
  domain/            pure logic: no database, no clock, no React
    exercises.ts     the curated library, with pattern fallbacks
    templates.ts     programmes written in movement patterns
    progression.ts   e1RM, double progression, deload detection
    plan.ts          profile + history -> today's session
    readiness.ts     check-in scoring and bounded adjustment
  lib/
    id.ts            monotonic UUID v7
    date.ts          local date keys, DST-safe day arithmetic
    storage.ts       persistent-storage negotiation
  ui/                screens and components
  styles/            design tokens (light + dark) and app styles
legacy/prototype/    the original vanilla HTML/CSS/JS, kept for reference
```

## Notes for whoever builds P3

- **Store observations, derive everything else.** There is no "total volume" or
  "streak" column. Counts on the dashboard are computed from set rows on read.
- **Sets are the atom.** Log `weightKg`, `reps` and `rir`; plans, charts, PRs and
  progression are all derived from those rows.
- **Always store metric.** Imperial is a display concern at the edge only.
- **Bulk-write in one transaction.** Writing row by row fires a live-query
  invalidation per row and makes the UI thrash. See `seed.ts`.
- **Never let the open session count as history.** `getExerciseHistory` takes an
  `excludeSessionId` for exactly this: without it, logging set one recomputes
  the prescription from itself and the target weight moves mid-workout.
- **Never let a template slot resolve to nothing.** `candidatesWithFallback`
  substitutes a related pattern rather than dropping the slot, which would hand
  her a shorter session with a whole movement missing and no way to notice.
- **Keep `src/domain` free of database, clock and React imports.** It is the
  code that decides what she lifts, so it has to stay exhaustively testable.
- **One place decides what a setting means.** `adjustmentsEnabled()` exists
  because a profile written before that field was added has no value for it,
  and it must read the same way everywhere. Add settings the same way.
- **Do not report a change that did not happen.** `applyReadiness` returns the
  prescription untouched when rounding leaves the numbers where they were.
- This is not a git repository yet. `git init` is worth doing before P3.

## Safety

Not medical advice. Before shipping, P3 and P4 need the RED-S guardrails
described in the blueprint: refuse to set calorie targets below estimated BMR,
and flag prolonged absent periods to the user with a suggestion to see a
clinician. Menstrual data is special-category health data under GDPR — keeping
it on-device is a deliberate legal advantage.
