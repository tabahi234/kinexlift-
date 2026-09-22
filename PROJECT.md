# Kinex Lift — Project Book

> The living record of what this app is, what it has, why it is shaped the way it
> is, and where it is going. Updated on every meaningful change. The `README.md`
> is the long-form engineering narrative; this file is the map.
>
> Last updated: 2026-09-22 (rounds 1 and 2 shipped)

---

## 1. Purpose

A private, offline-first strength-training and nutrition app for women. It runs
entirely on the phone (as an installable PWA) with no account and no network, and
does four things:

1. **Programmes the lifting** — picks the exercise, weight, sets and reps from
   what she has actually lifted, and progresses or backs off on its own.
2. **Builds food targets** from published equations (BMR/TDEE, calorie floors,
   protein per kg) and fills them with food she actually cooks — the table leads
   with South Asian cuisine and covers seven other regions.
3. **Tracks her cycle** without guessing: statistics from her own logs, pattern
   detection per user, and safety flags. It deliberately does **not** change
   training by cycle phase (see §7).
4. **Gives her a coach** — an AI chat that is handed a fact sheet computed from
   the database before every message. It explains and proposes; it never decides
   a number.

Optional, off by default: cloud backup (Supabase) and the AI coach (Groq).

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| UI | React 19 + TypeScript 7 | Function components, no router — screens are switched in `App.tsx` via `ui/nav.tsx` |
| Build | Vite 8, `vite-plugin-pwa` | Service worker, installable, offline |
| Local DB | Dexie 4 (IndexedDB) | Every write goes through `db/repo.ts` so `SyncMeta` is never missed |
| Tests | Vitest 4 + `fake-indexeddb` | 354 tests, all in `domain/` and `db/` |
| Backup | Supabase (Postgres + Auth, RLS) | Opt-in, incremental, two-way. `supabase/schema.sql` |
| AI | Groq (OpenAI-compatible) via `lib/ai.ts` | One function; swap providers there and nowhere else |
| Fonts | Inter Variable, Fraunces Variable | Bundled via `@fontsource-variable` |

Commands: `npm run dev` · `npm test` · `npm run typecheck` · `npm run build && npm run preview`

Env (`.env`, copied from `.env.example`): `VITE_GROQ_API_KEY` (coach),
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (backup). All three are currently
set in the local build.

---

## 3. The five screens

| Screen | What it does |
|---|---|
| **Today** (`ui/session/SessionScreen.tsx`) | Daily readiness check-in (3 questions, skippable) → "Next up" strip → the session: one numbered card per exercise, in order, with the prescription as a sentence ("3 sets of 8 to 12 reps at 20 kg"), a **Watch how to do it** link (YouTube), the reason behind a "Why these numbers?" toggle, a set logger (weight / reps / reps-in-reserve) whose button says "Log set 2 of 3", logged sets, and exercise swaps. Conditioning days (hybrid only) use `ConditioningCard`. **After she finishes**, a *Session done* card (sets, reps, kg moved, new bests, one warm line) replaces the Start button and the next session is locked for **8 hours** with a countdown; on a day she does not train it shows a *Rest day* card naming the next session. Both have a small "train anyway" override. A gentle *welcome back* note appears after 3+ days away. The Next-up strip hides while a session is running. An "Ask about today" box talks to the coach in context. |
| **Fuel** (`ui/fuel/FuelScreen.tsx`) | Three tabs, each with a one-line "what this is for" under the tab bar and a heading that follows the tab. **Today** ("What you ate today"): calorie/protein dial, carbs/fat/fibre/iron tiles, quick-add chips of her usual foods, **Log food** → `FoodPicker` (curated table + custom foods + AI estimate), the **Supplements** checklist (`SupplementsCard`), protein-gap suggestions, the day's log grouped by meal slot. **Meal ideas**: a deterministic "rest of today" and "whole day" meal plan she can log in one tap, plus "Ask for a meal". **My numbers**: where the targets come from, goal selection, iron, BMI. |
| **Coach** (`ui/coach/CoachScreen.tsx`) | A chat thread with memory. Every message is preceded by a briefing (`domain/coach.ts`) built from the DB. It can propose a meal, an exercise swap, or a set of sets as a card she accepts with one tap (`domain/proposals.ts`). |
| **Progress** (`ui/progress/ProgressScreen.tsx`) | Lifts (e1RM over time), Body (weight), Cycle (if tracked). |
| **You** (`ui/YouScreen.tsx`) | A settings **menu** of four named places, each a sub-page with a back arrow: **Training** (lifting/hybrid, **training days** picker Mon–Sun, daily check-in, about you), **Food & cycle** (diet pattern, avoid list, cuisine, cycle tracking), **Coach & backup** (coach on/off, backup sign-in/up), **Your data** (export, import, storage, delete — no account needed). |

Onboarding (`ui/onboarding/Onboarding.tsx`) collects: experience, goal, **which
days of the week she trains** (the count picks the programme), where she trains +
equipment, limitations, country (for cuisine), and whether she tracks a cycle.

Every screen uses `ui/PageHeader.tsx`: eyebrow (the tab), title, one line saying
what the page is for, and a back arrow on anything one level down. Tabbed screens
(Fuel, Progress) use `SectionTabs`, which puts a one-line description under the
selected tab.

---

## 4. The engines (all pure, all tested, `src/domain/`)

| Module | Responsibility |
|---|---|
| `exercises.ts` | Curated library of **49 exercises** across 9 movement patterns. Each carries equipment, smallest weight jump, beginner start weight, unilateral flag, minimum experience, limitations to avoid, one coaching cue, and an optional pinned `videoId`. `videoUrl()` gives a YouTube link — the pinned video if set, otherwise a search for "<name> exercise how to proper form" (never a dead link). |
| `templates.ts` | Programmes expressed in movement *patterns*, strength and hybrid variants, 2–5 days/week. |
| `plan.ts` | Profile + history → today's session. Resolves patterns against her equipment, offers alternatives per slot. |
| `progression.ts` | e1RM, double progression, deload detection. Prescription kinds: `calibrate`, `increase`, `hold`, `deload`. |
| `readiness.ts` | Check-in scoring and *bounded* autoregulation (eases weight/sets; she can override). |
| `conditioning.ts` | The hybrid protocol: minutes, effort, interval structure. |
| `cycle.ts` / `patterns.ts` | Cycle statistics, phase estimation, safety flags; per-user pattern detection from her own logs. |
| `nutrition.ts` | BMI, BMR, TDEE from *logged* training, calorie floors, macros, iron target. |
| `foods.ts` | Curated food table (~2,400 lines) tagged by region, allergen, group, aliases; `snack` and `supplement` flags. Caloric supplements (whey, plant protein, protein bar, mass gainer, electrolyte drink) are food rows; searching "supplement" lists them. |
| `supplements.ts` | Non-caloric supplements: presets (iron, vitamin D, …), timing labels, input normalisation, and the daily checklist builder. Tracking only — never recommends. |
| `meals.ts` | Deterministic meal assembly for a day or the rest of one; reconciles onto the calorie target; supplements never anchor a meal. |
| `estimate.ts` | Bounds an AI-guessed food into something the log can hold; flags it as an estimate forever. |
| `coach.ts` / `proposals.ts` | The briefing + system prompt; what the coach may propose and the parser that enforces it. |
| `nextUp.ts` | Today's checklist — the answer to "what now?". Knows about rest days; drops the check-in once she has trained. |
| `schedule.ts` | Training days (Mon–Sun, `getDay()` numbers), the **8-hour session gate** (`sessionGate`: open / cooldown / rest-day, with override), the welcome-back note (`gapNote`, silent under 3 days, never counts missed sessions), and `summariseSession` + `praiseFor` for the done card. |
| `account.ts` | Password rules, safe error wording, and "whose data is this device holding". |
| `profile.ts` | One place that decides what every setting means. |

---

## 5. Data model (`src/db/schema.ts`, Dexie v3, `SCHEMA_VERSION = 3`)

Tables: `profile`, `sessions`, `sets`, `checkins`, `cycleEvents`, `conditioning`,
`bodyMetrics`, `meals`, `chat`, `coachNotes`, and since v3 `supplements` (name,
dose, timing, note) and `supplementIntake` (one tick per supplement per day;
untick is a soft delete so it syncs). `profile.trainingDays?: number[]` (v3)
holds her weekdays; absent means "any day" (pre-v3 behaviour). Transient
per-device choices — check-in skipped, gate overridden, gap note dismissed — live
in `localStorage` keyed by date (`lib/storage.ts`), never synced. Every row carries `SyncMeta`
(`updatedAt`, `deletedAt`) so export/import and cloud sync can merge with
last-write-wins. IDs are UUID v7 (monotonic).

The IndexedDB name and export filenames use the old `kinexlift` slug on purpose —
Dexie opens a DB by name, and renaming would orphan every existing install.

---

## 6. Backup & accounts (already built — Supabase)

- **Opt-in, off by default.** Onboarding promises nothing is uploaded; the code
  keeps that promise.
- **Requires sign-in** (email + password, or anonymous sign-in) so every device
  has a real `auth.uid()` for row-level security.
- **Incremental and two-way**, per-account cursors, same LWW merge as export.
- **The device remembers whose data it holds** — refuses to push one person's
  log into a flatmate's account. (`domain/account.ts`, `checkOwnership`)
- **Server-side hardening** in `supabase/schema.sql`: RLS on every table, CHECK
  constraints mirroring client bounds, a per-user row ceiling by trigger.
- Provider error messages are never shown verbatim (no account enumeration).

### Firestore? — decided 2026-09-22: **no, keep Supabase**

Asked whether to move backup to Firestore. Conclusion: not worth it.

- The backup already exists, is configured, and has been hardened against real
  bugs (ownership hole, enumeration, row ceilings). Moving providers throws that
  work away and re-opens the same holes in a new dialect.
- Firestore has no CHECK constraints or triggers; the row-ceiling and bounds
  logic would have to be rewritten as Security Rules, which are harder to test.
- Relational tables with a `user_id` column and RLS are a natural fit for this
  data; Firestore's document model would need a per-user subcollection redesign
  and a new sync layer (`lib/sync.ts`, 300 lines, would be a rewrite).
- Firestore's offline cache duplicates what Dexie already does.
- Cost/scale is a wash at this size; both have a free tier that covers testing.

What *would* justify Firestore: needing Firebase-only features (FCM push
notifications, Firebase Auth's phone/Google sign-in with zero backend). If push
notifications become a requirement, revisit — but even then FCM can be added
without moving the database.

**Action instead:** make the existing backup easier to find and turn on (see §8).

---

## 7. Decisions that must not be undone

- **The AI never decides a number.** Code prescribes; the model explains and
  proposes from a list the app hands it. The one exception runs the other way —
  estimating the macros of a food she typed — and it is bounded and flagged.
- **No cycle-phase weight multipliers.** Training does not change by menstrual
  phase. The evidence is weak and it teaches her to expect to be weaker. Cycle
  tracking is for *her* patterns and safety flags, not programming.
- **Accuracy over speed; deterministic core.** Every number is derived, never
  stored; every engine is pure and tested.
- **Nothing uploads unless she said so.** Menstrual data is special-category
  data under GDPR.
- **Keep the `kinexlift` DB slug.**

---

## 8. Tester feedback & roadmap

### Round 1 — first external test (reported 2026-09-22, recommendations reviewed by a doctor)

| # | Feedback | Status | Plan |
|---|---|---|---|
| F1 | **Exercise layout is confusing** — testers could not tell what to do, in what order, or how to log. | ✅ shipped 2026-09-22 | Each card now has a step number (1, 2, 3…), the prescription as a sentence ("3 sets of 8 to 12 reps at 20 kg", "…with your bodyweight", "…each side"), the log button says "Log set 2 of 3", and the reasoning sits behind a "Why these numbers?" chip instead of a paragraph under every card. Masthead says "4 exercises, in order". |
| F2 | **Add a YouTube link per exercise.** | ✅ shipped 2026-09-22 | Every card has a **Watch how to do it** chip → YouTube search for "<name> exercise how to proper form", opened in a new tab. `Exercise.videoId` is there for pinning a specific video later (`videoUrl()` in `domain/exercises.ts`). |
| F3 | **Meal section: add a supplement option.** | ✅ shipped 2026-09-22 | **Supplements** card on Fuel → Today: add from presets (iron, vitamin D, calcium, folic acid, B12, multivitamin, omega-3, magnesium, creatine, zinc) or type one; dose + timing; tick off daily; "Edit list" to remove. Two new tables (Dexie v3, export v3, Supabase SQL updated). Caloric supplements (plant protein, protein bar, mass gainer, electrolyte drink) added to the food table alongside whey; "Log a shake or bar" opens the picker on them. The coach still never recommends supplements. |
| F4 | **Meal section: make it more understandable and easier to navigate.** | ✅ first pass 2026-09-22 | Tabs renamed **Today · Meal ideas · My numbers**; the heading now follows the tab ("What you ate today" / "Meal ideas" / "Your numbers") instead of always saying "Today"; one line under the tabs says what the tab is for; "Log something" → "Log food"; "g P" → "g protein" everywhere. Next round: watch a tester use it before changing more. |
| — | Backup exists but is buried under You → Account. | 🔲 planned | Surface it: a one-line "Back up your data" prompt after the first week of logging, and a clearer Account tab. |

### Round 2 — owner review (2026-09-22)

| # | Feedback | Status | What was done |
|---|---|---|---|
| R1 | Firebase vs Supabase? | ✅ decided | Stay on Supabase (see §6). Reminders do not change it: both need a small server piece. |
| R2 | After finishing, no appreciation; the next session is offered immediately. Wanted an 8-hour lock. | ✅ shipped | *Session done* card with stats, bests and a warm line; next session locked 8 h with countdown; hidden "train anyway" override (owner chose soft lock). |
| R3 | Choose which days of the week to train. | ✅ shipped | Mon–Sun picker in onboarding and You → Training. Count drives the programme; days drive the *Rest day* card and Next-up. Missed days never skip a session. |
| R4 | Gentle reminder after a gap. | ✅ in-app | Welcome-back note after 3+ days (no streaks, no guilt), dismissable per day. **Push notifications** (app closed) deferred: needs Supabase Edge Function + cron + Web Push, opt-in, iOS only when installed to home screen. |
| R5 | Navigation: too much scrolling on Today. | ✅ shipped | Next-up strip hides while a session is running; check-in dropped from the list once trained or on a rest day; exercise cards hidden behind "Preview" when the gate is closed. |
| R6 | Navigation: can't find settings. | ✅ shipped | You is a four-row menu (Training, Food & cycle, Coach & backup, Your data), each a sub-page with a back arrow; other screens can deep-link into a place (`nav.go('you', 'training')`). |
| R7 | Navigation: don't know where they are. | ✅ shipped | One `PageHeader` everywhere; `SectionTabs` with a description line on Fuel and Progress; back arrows on sub-pages. |
| R8 | Fuel still confusing. | ✅ pass 2 | "Logged today" moved directly under "Log food" so adding something shows a result without scrolling. Needs a tester session to go further. |

### Backlog / known gaps (from `README.md`)

- **Push notifications** (R4): opt-in device reminders on training days / after a
  gap. Supabase Edge Function on a daily cron + Web Push (VAPID) + a
  `pushSubscriptions` table. Android works; iOS 16.4+ only when installed.

- The Groq key ships in the bundle — fine for a personal/test build, **not** for
  public release. `lib/ai.ts` needs to move behind a small server route.
- Models get retired; a 404 is treated as retryable so the fallback gets a turn.
- Supabase: enable email confirmation, server-side password minimum, leaked-
  password protection (dashboard settings, cannot be done in SQL).
- **Supabase project needs the v3 tables.** `supabase/schema.sql` now has
  `supplements` and `supplementIntake`. The sync pushes tables in order and
  these two are last, so until the SQL is run every other table still backs
  up and then the run reports "supplements: relation does not exist". Run the
  two create statements (note at the top of the file) and it clears. Round 2
  also added `profile."trainingDays" integer[]` — one `alter table` line, same note.

---

## 9. Changelog

| Date | Change |
|---|---|
| 2026-09-22 | Round 2: session-done card + 8 h gate with override; training-day picker (`profile.trainingDays`, Supabase column); welcome-back note; You rebuilt as a menu with sub-pages; shared `PageHeader`/`SectionTabs` on Fuel and Progress; Next-up hides during a session, drops check-in after training, knows rest days; Fuel log moved under Log food. Tests 338 → 354. |
| 2026-09-22 | Shipped round-1 tester feedback (F1–F4): numbered exercise cards with sentence prescriptions and YouTube links; supplements checklist (new `supplements` + `supplementIntake` tables, schema v3, Supabase SQL); caloric supplement foods; Fuel tabs renamed with per-tab headings and descriptions. Fixed a planner bug the new foods exposed: a `carb`-group supplement could anchor a meal. Tests 321 → 338. Dev server moved to port 5174 in `.claude/launch.json` (5173 was taken by another project). |
| 2026-09-22 | Created this project book. Recorded round-1 tester feedback and the Firestore decision. |
| 2026-09-04 | PWA setup, `.gitignore` update (commit `cd498d0`). |
| 2026-09-0x | "Three bugs the browser caught" (commit `6a3fe50`). |
| — | P0–P6 complete: foundation, onboarding + logging + progression, readiness, cycle intelligence, nutrition + food table, hybrid + coach + sync, wayfinding + acting coach. |
