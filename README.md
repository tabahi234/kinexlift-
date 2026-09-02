# Kinex Lift

A private, offline-first strength training app for women: a programme that
progresses itself from what you actually lift, food targets built from
published equations and filled with the food she actually cooks, cycle
tracking that refuses to guess, and a coach that has
read your log before it opens its mouth — and can put a meal, an exercise swap,
or the sets you just did in front of you to accept with one tap.

The IndexedDB database and the export filenames still use the old `kinexlift`
slug, and deliberately: Dexie opens a database by name, so renaming
`APP_SLUG` in `src/config.ts` would point every existing install at a new,
empty one.

Everything except the coach and the optional backup runs on the device with no
network at all.

The original architecture and build plan lives in **[The Strength Ledger](https://claude.ai/code/artifact/2ffc6ac0-3f4c-4720-9633-a3e7a483c5e6)**.
Read that first — it explains *why* the app is shaped this way.

## The three decisions everything else follows from

**1. The AI never decides a number.** Code picks the exercise, the weight, the
sets, the reps, the calories and the macros. The model explains those
decisions, answers questions and gives context. This keeps the app
offline-capable, unit-testable, cheap to run, and safe — and it means every
claim the coach makes can be checked against a screen.

The rule is about *prescriptions*. There is exactly one place a model puts a
number in front of her, and it runs the other way: she ate a shawarma wrap,
the app has no idea what was in it, and her real options are a guess she can
edit or a hole in the log. `src/domain/estimate.ts` bounds every field,
makes the macros and the calories agree, and the row is flagged as an
estimate for good. See **[Food she writes herself](#food-she-writes-herself)**.

What it *may* do is propose, from a list the app hands it: food for today's log,
swapping an exercise for one already offered for that slot, and writing down
sets she says she has done — all three things she can already do herself in two
taps. It chooses ids from a catalogue; `src/domain/proposals.ts` validates every
one against the same functions the food picker and the swap sheet use, computes
every macro itself, bounds every weight and rep count, and drops anything
invented. The result is a card she edits and taps. Nothing the model says
reaches the database on its own.

**2. Training is autoregulated, not cycle-programmed.** Fixed per-phase weight
multipliers are not supported by the evidence
([McNulty 2020](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7497427/),
[Colenso-Semple 2023](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10076834/))
and they work against progressive overload. The app autoregulates on a daily
readiness check-in, and — after roughly three logged cycles — surfaces the
user's *own* pattern from her *own* data. The cycle screen says this out loud,
because a user who has seen every other app do the opposite is entitled to know
it was a decision rather than an omission.

**3. Nothing leaves the device unless she says so.** The coach and the cloud
backup are both opt-in, both off by default, and the coach shows the exact text
it is about to send. Menstrual data is special-category health data; keeping it
local is a deliberate legal advantage as well as an ethical one.

## Status

**P0 to P6 are complete and verified**, on device and in a browser.

| Phase | | |
|---|---|---|
| **P0** | Foundation: schema, Dexie, export/import, PWA | ✅ |
| **P1** | Onboarding, session logging, progression engine | ✅ |
| **P2** | Daily readiness check-in, bounded autoregulation | ✅ |
| **P3** | Cycle intelligence, per-user pattern detection | ✅ |
| **P4** | Nutrition targets, BMI, South Asian food table | ✅ |
| **P5** | Hybrid protocol, AI coach with memory, opt-in sync | ✅ |
| **P6** | Wayfinding, a coach that can act, and a face: icons, gauges, a welcome | ✅ |

321 tests pass. `npm run typecheck` is clean.

## The five screens

**Today** — what to do next, then the session. On a lifting day: the
prescription, the reason for it, one-tap set logging, exercise swaps. On a
conditioning day (hybrid only): the same card shape for minutes, effort and
interval structure. The strip at the top is the whole of today in five rows,
and every row is a link to the screen that does it.

**Fuel** — three tabs, because one column was six screens tall. **Today** is
the dial, the quick-add row and the log; **Plan** is the meals it suggests;
**Targets** is the arithmetic and the settings behind it. Calorie and macro
targets are built from her height, weight, age and *logged* training, the food
comes from a curated table that leads with the cooking of the country she
named during onboarding, and anything that table does not have she can write
herself.

**Coach** is a chat, laid out like one: a thread, a box pinned to the bottom,
and everything that is *about* the conversation rather than in it behind a
menu in the corner. It is handed a fact sheet computed from the database
before every single message, remembers the conversation, and can offer a meal,
a swap, or a set of sets as a card. Fuel and Today each carry a small box into
the *same* thread, so "what should I eat tonight?" and "I did three sets of ten"
are answerable where they occur rather than two tabs away.

**Progress** — Lifts, Body and (if she tracks it) Cycle.

**You** — three tabs for the same reason Fuel has them. **Training** is the
programme and how it adapts; **Food & cycle** is what she eats and whether she
tracks a cycle; **Account** is the coach, the optional backup, and the export
and delete that need no account at all. The reasoning behind each setting is
behind a "Why?" rather than always open — nine paragraphs stacked in a column
is the length of an explanation with the effect of none.

## What P3 delivers — cycle intelligence

`src/domain/cycle.ts` derives everything from logged period events. No phase is
ever stored, because a stored phase goes quietly wrong the moment a period is
logged a day late.

- **Her cycle length, never 28.** The textbook 28-day cycle is a population
  average that a minority of cycles actually match.
- **Ovulation counted backwards.** The luteal phase is the stable one (~14
  days); the follicular phase absorbs the variation. Estimating ovulation
  *forwards* from the last period — the most common mistake in cycle apps — is
  wrong by a week for anyone on a 35-day cycle.
- **Predictions with a window and a stated confidence**, and none at all from a
  single cycle.
- **Guardrails.** No period logged for 90 days raises the low-energy-availability
  question and points at a clinician. Cycles under 21 or over 35 days do the same.
- **Per-user pattern detection** (`src/domain/patterns.ts`): three complete
  cycles minimum, four check-ins inside a phase before that phase is described
  at all, and a difference has to clear a visible threshold. "Nothing stands
  out" is a first-class result, and the most common honest one.

## What P4 delivers — food

`src/domain/nutrition.ts` is arithmetic over published equations, every
constant named and sourced in a comment. A missing input returns `null` rather
than a plausible-looking number: age is genuinely required, because guessing it
moves the target by over a hundred kilocalories a day.

- **Mifflin-St Jeor** for BMR, then lifestyle and training counted *separately*.
  The usual published activity multipliers bundle exercise in, which
  double-counts the moment you also know how much she trains — and this app
  knows, from the log.
- **Two floors under the calorie target.** Never below BMR, and never below 30
  kcal/kg fat-free mass once training is paid for. The floor is allowed to
  overrule the goal, and says so in words. Chronic under-fuelling is the failure
  mode that actually hurts this population.
- **BMI with its caveat attached.** It cannot tell muscle from fat and was never
  designed to describe an individual.
- **A curated food table** (`src/domain/foods.ts`) of about a hundred and thirty
  dishes, each tagged with the region it belongs to. A protein target you cannot
  hit with the food in your kitchen is a target you abandon in a fortnight — and
  that is as true in Lagos, Manila and Mexico City as it is in Lahore. Iron is
  tracked, because that shortfall is common in women.
- **Deterministic meal assembly** (`src/domain/meals.ts`) that reconciles onto
  the calorie target instead of getting each macro roughly right and the total
  badly wrong.

### Accounts, and the hole that was in them

Backup needs a real account so a second device can retrieve the data. That is
a login form guarding a store of somebody’s menstrual history, so it gets
treated as one. The rules are in `src/domain/account.ts` and tested there;
`src/lib/auth.ts` is only the plumbing.

- **A device remembers whose data it holds.** This is the important one, and it
  is a fix rather than a feature. Backup pushed every local row stamped with
  whoever was signed in, and signing out does not clear IndexedDB — so she
  signs out, a flatmate signs in on the same browser and turns backup on, and
  the first account’s period history lands in the second account, where it is
  now legitimately theirs to read. Row-level security does not catch it: every
  write was correctly authenticated as the new user. `checkOwnership` refuses,
  names what happened and says what to do; unclaimed data is claimed by the
  first account to back it up, so an existing offline user signing up is still
  one tap. Sync cursors are per account for the same reason.
- **Nothing the provider says is shown verbatim.** Supabase distinguishes "no
  such account" from "wrong password", which turns a login form into a service
  for finding out who uses a period-tracking app. Both come back as one
  sentence, and a password reset always reports success.
- **Twelve characters, and length is what the meter rewards.** No composition
  rules, because demanding a symbol mostly produces `Password1!`. It refuses
  the obvious few, her own email address, and anything past bcrypt’s 72-byte
  truncation — accepting 200 characters and hashing 72 is a lie about how
  protected the account is.
- **"Check your email" is a state, not a toast.** With email confirmation on —
  which it should be — `signUp` returns no session. The old screen said
  "Account created! You can now sync your data", which was wrong twice: nothing
  synced, and she had not been told to look for a link.

### Stopping a signed-in user abusing the database

Row-level security answers *whose data is this*. It says nothing about *how
much* or *how big*, and those are the two ways somebody abuses a database they
have legitimate access to. The anon key is in the bundle and the client is a
browser, so the client is assumed hostile:

- **CHECK constraints on every table** — text lengths, and numeric bounds that
  mirror the ones the client already applies. Having them in both places is the
  point; the client is not the thing being trusted.
- **A per-user row ceiling** enforced by trigger, set far above anything a
  decade of honest use produces. On INSERT only: an update replaces a row
  rather than adding one.
- **Three things SQL cannot do**, listed at the foot of `supabase/schema.sql`:
  turn on email confirmation, set the server-side password minimum and leaked-
  password protection, and leave the auth rate limits alone. The client-side
  password rule is a courtesy to the user; a control has to be server-side.
### Food she writes herself

A curated table is the reason the search is usable, and it is also the reason
it will never contain her mother’s biryani or the wrap from the place by the
station. The usual answer is a barcode database, which trades one unusable
list for a much larger one. This is the other answer: she writes the row.

- **The numbers first, the conversation second.** If she has a label she types
  a name, a calorie figure and a protein figure and she is done; carbohydrate,
  fat and fibre are folded away, because requiring them is how a quick log
  becomes a form she abandons.
- **When she does not know them, a model guesses** from a sentence — "a chicken
  shawarma wrap with garlic sauce". This is the one place a model puts a number
  near the log, and it is the opposite of a prescription: the wrap has a
  calorie content whether or not anybody knows it, and a rough figure she can
  see and correct beats a hole in the day. `src/domain/estimate.ts` bounds every
  field against what food can physically be, and **the arithmetic wins a
  disagreement** — a reply claiming 600 kcal with macros that add up to 250 is
  overruled, because the calorie ring and the protein ring read those two
  numbers separately and must not tell different stories about one meal.
- **It lands in the form, not in the log.** She sees every number before it is
  hers, and what she edits is what gets written — the same contract as the
  coach’s meal cards.
- **The row stays marked.** `estimated` is stored, and the log shows the tag. An
  estimate she accepted is still an estimate.
- **The food lives on the meal row**, not in a foods table of her own. A log
  records what she ate *then*: if "Mum’s biryani" were a table entry and she
  corrected its calories in March, every February dinner would silently change
  with it. The `foodId` is still a stable `custom:` slug, which is what lets the
  quick-add row notice she keeps logging the same thing.
- **Estimates are opt-in twice over.** They need the coach switched on, because
  they are the only part of the food log that leaves the device, and the form
  says so next to the button. Without it the manual fields still work.
### Her kitchen, not ours

The food table used to carry one bit — `desi: true` — which was the right
instinct at the wrong resolution. Onboarding now asks her country once,
`src/domain/cuisines.ts` maps it to one of eight regions, and every list of food
she is shown leads with hers: the search, the generated day, the protein-gap
card, and the catalogue the coach is allowed to choose from.

- **Nothing is hidden by region.** It decides the *order* of a list and which
  anchors a generated day reaches for first. Plenty of people cook outside
  their postcode, and a table that cannot find her dinner because she once
  tapped "Pakistan" is a table she stops trusting.
- **Null is a real answer.** She may never say, and then the table stays in its
  own order. Ordering by a region she has nothing to do with is worse than not
  ordering at all: an arbitrary list only looks arbitrary, a confidently wrong
  one looks broken.
- **The guess is free and the question is still asked.** `src/lib/locale.ts`
  reads the browser locale and time zone — offline, no IP lookup, no permission
  prompt — to pre-select an answer she is looking straight at. Being wrong
  costs a tap; being right saves the whole question.
- **A region has to be worth picking.** A test asserts every one of the eight
  has at least eight foods of its own, a carbohydrate, and something to anchor
  a meal on. A region with two dishes falls straight back to the universal
  staples and makes the question pointless.
- **Foods carry aliases**, because she types "lentils" and the table says
  "Daal (masoor or moong)". A curated table only feels small when the search
  cannot find what is already in it.

## What P5 delivers — hybrid training and the coach

**The hybrid protocol** (`src/domain/conditioning.ts`) puts conditioning days
*in the rotation* rather than beside it. Cardio bolted onto a lifting app as a
free-text note is cardio that stops happening in week three. Easy sessions
progress by no more than a tenth per session; interval sessions add a round
before they lengthen the effort; a red check-in turns intervals into an easy
session rather than a shorter hard one.

**The coach** (`src/domain/coach.ts`, `src/lib/coachClient.ts`) has three
layers of memory:

1. **The briefing** — regenerated from the database on every message, so the
   numbers are never stale by one logged set. It includes a deterministic
   "where she is falling short" section, because *what am I neglecting* is the
   question a coach is most useful for and the one a model is most likely to
   answer from vibes.
2. **The last dozen messages**, verbatim.
3. **A rolling summary** of everything older, written by the model when the
   conversation outgrows the window and stored on device, plus standing notes
   she types herself. This is what lets it remember in March what she said in
   January without resending January.

She can read the exact briefing text in the app before it is sent.

## What P6 delivers — a way forward, and a coach that can act

**Wayfinding.** Five screens, each correct in isolation, still add up to a maze
if none of them answers *what now?* — which was the actual complaint about this
app, and a fair one.

- `src/domain/nextUp.ts` computes today's checklist from the same state the
  screens read: check in, train, eat, weigh in, log a period if one is well
  overdue. Pure, so the ordering is argued about in a test rather than in four
  components. The strip sits at the top of Today.
- `src/ui/nav.tsx` gives anything on one screen the ability to send her to
  another *and* open the right thing when she lands — Progress' body tab, the
  food picker, the check-in form. A card that says "log your weight on
  Progress" and then leaves her to find it is where an app stops feeling like
  it is on your side.
- Two dead ends went with it: "Skip for today" on the check-in re-rendered the
  same form it was dismissing, and there was no way past it except answering.
  The skip now persists for the day (`lib/storage.ts`, keyed on the date so it
  expires by itself).
- The tab bar is a floating pill rather than a strip welded to the bottom
  edge — centred on its own width so a wide screen does not strand five icons
  across a metre of page — and every screen reserves `--nav-clearance` of
  padding beneath it, because the last card used to sit underneath the bar.
- **Fraunces** (variable, weight axis only) carries h1 and h2; Inter keeps
  everything else. The serif stops above h3 deliberately: below that, headings
  sit next to numbers, and a display face there fights the data instead of
  framing it. Both fonts are bundled, never fetched from a CDN — a CDN font
  request is an app that cannot start offline.
- The coach introduces itself by name on an empty screen and shrinks to a mark
  in the corner once there is a conversation to read.
- **A welcome screen that says what the app is**, not just what it is called:
  the mark, the name, and three lines each naming something this app does
  differently. It is the only onboarding step without a progress bar — "one of
  eleven" as the first thing she reads turns an introduction into a queue.
- **Drawn, not written.** `src/ui/icons.tsx` holds a hand-made stroke icon set
  and the brand mark, all `currentColor` so an icon takes the colour of the
  text beside it and needs no dark-mode variant. It also holds `Dial`, the
  concentric ring gauge: calories outside, protein inside on Fuel; steps done
  on Today. The rings cap at a full circle on purpose — a ring that kept going
  round on an over-target day would say something the app does not believe.
  Elsewhere: dots for sets done on each exercise, and a progress bar under the
  masthead while a session is running. Calories and protein lost their macro
  bars when the dial arrived, because saying the same two numbers three times
  on one card is what "text-only" actually looks like.

**Proposals.** `src/domain/proposals.ts` holds the protocol, the catalogues and
the parser in one file on purpose: if the format drifts from the prompt that
produces it, the tests fail immediately.

- The model appends one block naming ids from a catalogue it was given. Ids
  only — every id is resolved against `allowedFoods()` and the slot's own
  alternatives, servings are clamped to halves between 0.5 and 6, and anything
  it invented is dropped and named on the card rather than quietly substituted.
- Every macro on the card is computed from the food table. If the prose says
  something different, the card is right.
- `ChatMessage.appliedAt` records acceptance, so scrolling away and back cannot
  add the same dinner twice — and so an accepted swap, which stops validating
  the moment it is applied (the exercise it offered is now the prescribed one),
  turns into a receipt instead of vanishing.
- What she edits is what gets written. The apply handler sends the state of the
  card, never the parsed proposal.
- **Logging by sentence.** "I did 3 sets of 10 on the goblet squat at 8 kg" is
  faster to say than to tap, and it is what she wants while still holding the
  weight. Accepting it opens a session if none is running, and writes one row
  per set — the progression engine counts rows, and a single row saying "×3"
  would read as one set and hold her at that weight. A weight she does not
  mention is filled from what the engine prescribed, never from the model, and
  every field is bounded: a misread "3 x 10" must not be able to become 310 kg.
  Set counts, reps and load all sit on steppers before she taps, because unlike
  a meal, a wrong number here changes next week's session.

## Commands

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build && npm run preview
```

```bash
node scripts/gen-icons.mjs
```

## Configuration

Copy `.env.example` to `.env`.

| Variable | Needed for |
|---|---|
| `VITE_GROQ_API_KEY` | The coach. Without it every other screen works unchanged. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Optional backup. Without them the backup card does not appear. |

### Before anyone else uses this build

**The model key ships to the browser.** `VITE_` variables are compiled into the
bundle, so anyone with dev tools can read the Groq key. That is fine for a
personal build with a rate-limited key and it is *not* fine for a public one:
the call in `src/lib/ai.ts` needs to move behind a small server route that holds
the key. It is one function, deliberately isolated for exactly this.

**Models get retired.** The Llama 3.x ids this originally used had already been
withdrawn, and the app answered every question with a 404. To see what an
account can actually reach:

```bash
curl -s -H "Authorization: Bearer $VITE_GROQ_API_KEY" https://api.groq.com/openai/v1/models
```

A 404 is treated as retryable so the fallback model gets a turn. Note that
`openai/gpt-oss-*` are reasoning models: their thinking tokens come out of
`max_tokens`, so a small budget returns an empty reply rather than a short one.

**Backup needs the SQL run first.** `supabase/schema.sql` creates the tables
with a `user_id` column, an index and row-level security. Enable **Anonymous
sign-ins** in the Supabase dashboard first — the app signs in anonymously so
every device has a real `auth.uid()` for the policies to key on. Without RLS,
the publicly-shipped anon key is a master key to every user's period history.

## Layout

```
src/
  config.ts          app name, colours, slug — rename the product here
  db/
    schema.ts        the data model and SyncMeta
    db.ts            Dexie instance and indexes (v2)
    repo.ts          every write goes through here, so SyncMeta is never missed
    export.ts        export, validation, import, last-write-wins merge
    queries.ts       read models — every number is derived, never stored
    derived.ts       state more than one screen needs, computed exactly once
    actions.ts       every mutation the UI performs
    seed.ts          deterministic demo history
  domain/            pure logic: no database, no clock, no React
    exercises.ts     the curated library, with pattern fallbacks
    templates.ts     programmes in movement patterns, strength and hybrid
    progression.ts   e1RM, double progression, deload detection
    plan.ts          profile + history -> today's session
    readiness.ts     check-in scoring and bounded autoregulation
    profile.ts       one place decides what every v2 setting means
    conditioning.ts  the hybrid protocol
    cycle.ts         cycle statistics, phase estimation, safety flags
    patterns.ts      per-user pattern detection from her own logs
    nutrition.ts     BMI, BMR, TDEE, calorie floors, macros
    foods.ts         the curated food table, tagged by region and alias
    account.ts       password rules, safe error wording, whose data this is
    cuisines.ts      countries, the eight regions, and the map between them
    estimate.ts      bounding a guessed food into something a log can hold
    meals.ts         deterministic meal assembly, for a day or the rest of one
    coach.ts         the briefing and the system prompt
    proposals.ts     what the coach may offer, and the parser that enforces it
    nextUp.ts        today's checklist - the answer to 'what now?'
    *.test.ts        321 tests, all of them here or in db/
  lib/
    id.ts            monotonic UUID v7
    date.ts          local date keys, DST-safe day arithmetic
    ai.ts            the model client. Swap providers here and nowhere else.
    coachClient.ts   memory assembly and summarisation
    estimateClient.ts  one question, one answer, no conversation
    auth.ts          sign up, sign in, reset - and nothing said verbatim
    locale.ts        a free guess at her country, from the browser alone
    supabase.ts      client, created even without credentials
    sync.ts          opt-in, incremental, two-way, authenticated
  ui/                screens and components
    nav.tsx          cross-screen navigation, with a one-shot "open this"
    icons.tsx        the stroke icon set, the brand mark and the ring gauge
    NextUp.tsx       the what-next strip on Today
    AccountCard.tsx  sign in, sign up, reset, and what to do next
    CountryPicker.tsx  where she cooks - onboarding, You and Fuel share it
    coach/           the thread, the ask boxes, and the proposal cards
  styles/            design tokens (light + dark), app, v2 and v3 styles
legacy/prototype/    the original vanilla HTML/CSS/JS, kept for reference
supabase/schema.sql  tables, indexes and row-level security
```

## Notes for whoever works on this next

Everything below was learned by getting it wrong first.

- **Store observations, derive everything else.** No "total volume" column, no
  stored phase, no cached calorie target.
- **Sets are the atom**, and conditioning logs are the atom of the hybrid side.
- **Always store metric.** Imperial is a display concern at the edge only.
- **Never let the open session count as history.** `getExerciseHistory` takes an
  `excludeSessionId`, and `getConditioningExtras` takes one for the same reason:
  without it, logging today's walk recomputes today's prescription from today's
  walk and the card announces "28 minutes, done" above the 25 she actually did.
- **Never let a template slot resolve to nothing.** `candidatesWithFallback`
  substitutes a related pattern rather than dropping the slot.
- **Keep `src/domain` free of database, clock and React imports.**
- **One place decides what a setting means.** `adjustmentsEnabled()` in
  readiness.ts and everything in `domain/profile.ts` exist because a profile
  written before a field was added has no value for it. New settings go there,
  and their type stays optional so TypeScript forces the question.
- **A flag about the data must be computed from the data.** The irregular-cycle
  flag was originally keyed off prediction *confidence*, which told anyone with
  two textbook 28-day cycles that hers varied a lot — two of anything is always
  low confidence.
- **Nutrient checks need real Atwater.** Fibre yields about 2 kcal/g, not 4.
  Scoring it at 4 makes a correct spinach row look 29% wrong, and a percentage
  tolerance on a 25 kcal bowl of salad measures rounding rather than accuracy.
- **Sweep the rotation in tests.** The meal planner passed on one date and
  overshot by 483 kcal on another; only iterating dates, diets and targets found
  it.
- **Sweep the regions too.** The same sweep now runs across all eight kitchens,
  because a region with denser anchors is exactly where reconciliation stops
  working. It also caught two places that reached past the region filter and
  put dates in a Greek snack and ghee in a Mediterranean dinner: filtering the
  main lists is not enough, every pool has to go through the same function.
- **A rule about groups is not a rule about food.** "Any protein under 220
  kcal" offered her fifty grams of cooked chicken breast as a snack. The
  arithmetic was right and no person has ever eaten that between meals, so
  `snack` is now a hand-set tag. Same for `supplement`: whey wins any
  protein-per-calorie sort, which is why it used to anchor lunch.
- **Efficiency rankings are the same everywhere.** Sorting the whole table by
  protein per kilocalorie answers "tuna, whey, tilapia" for every woman on
  earth. It is honest and it never once names her dinner, so one row of that
  card is reserved for her own region.
- **A plan has to know what she has already eaten.** The generated day ignored
  the log entirely, so a full day offered at six in the evening was a plan to
  eat a second breakfast. `buildDayPlan` now takes the slots still to come and
  what is already logged, and renormalises the calorie split over them — before
  that, "the rest of your day" handed her 45% of a day and called it dinner.
- **A bulk write needs a receipt, not a button that stays.** "Log this whole
  day" appended, so tapping it twice silently doubled her intake and the only
  clue was a calorie total that had quietly gone wrong. It now returns the rows
  it wrote, the button becomes an Undo, and on a day she has already eaten it
  replaces rather than appends. Same lesson as `ChatMessage.appliedAt`.
- **Say what you just did.** The food picker logged a serving and showed her
  nothing, the list did not move, so she tapped again. Every write on Fuel now
  confirms in words and offers to take itself back.
- **Authenticating a write is not the same as authorising it.** The backup bug
  above passed every check the database had: real session, real user id, policy
  satisfied. What was missing was a question RLS cannot ask — *should this
  device be sending this?* Anything that uploads local state needs to know who
  the local state belongs to, and cannot learn that from the session alone.
- **A marker that guards data must not travel with it.** The owner id lives in
  localStorage rather than on the profile row, because the profile row is
  itself synced.
- **Error text is an attack surface.** Passing a provider message through
  unedited is how a login form ends up answering "does this person use a
  period-tracking app".
- **Supabase throttles with a sentence containing none of the obvious words.**
  "For security purposes, you can only request this after 41 seconds" matches
  neither `rate` nor `too many`, so it fell through to the generic message the
  first time. There is a test for that exact string.
- **`localStorage` is not always there.** It is absent under Node in the tests
  and throws outright in some privacy modes — and `wipeAll` reaching for it took
  twenty-five unrelated database tests down with it.
- **A chat screen is a thread and a box, and nothing underneath.** The coach
  had three settings cards stacked below the composer, so the one control she
  opens the app to use sat two thumb-scrolls up the page. They are in a drawer
  now. The card that printed the exact briefing text went entirely: the honesty
  was right and the placement was wrong, and what the coach may send is still
  listed in full on the consent screen, before she agrees to any of it.
- **Hiding a feature looks exactly like deleting its data.** Turning cycle
  tracking off removed the whole Cycle tab from Progress. Nothing was ever
  deleted, and there was no way to find that out and no way back in except
  remembering which screen the switch was on. The tab now always exists, says
  it is off, counts what is being kept, and distinguishes "no thanks" from "I
  am on hormonal contraception".
- **The app writes no dashes, so the model must not either.** Every em and en
  dash was replaced by the punctuation the sentence actually wanted, which is
  not the same character in every sentence: a colon where one introduces a
  list, a full stop between two whole clauses, "to" in a numeric range. That
  left the coach as the largest remaining source of them, so the system prompt
  asks for none and `withoutDashes` strips whatever comes back anyway. The
  prompt is the better half of that fix, because a model asked not to use one
  rewrites the sentence rather than swapping in a character.
- **A screen that is correct can still be unusable.** Fuel was one column: the
  dial, the log, the plans, an energy breakdown, two settings blocks and a BMI
  calculator. Everything on it was right and the thing she opens the app to do
  sat above four screens of reference material she reads twice a year. Three
  tabs, and four macro bars became four tiles in a grid.
- **Bounding belongs in one place.** `boundCustomFood` bounds what she types
  with the same limits `parseEstimate` bounds what the model says, because a
  slipped decimal point is a slipped decimal point whoever typed it, and two
  sets of rules is how a form and a parser end up disagreeing about what a
  valid row is.
- **A denormalised field still has to reach the server.** `supabase/schema.sql`
  lists columns explicitly, so adding `custom` to the meal row without adding
  the column would have made the meal sync reject every row carrying one - and
  take the rest of the batch with it. There is an `alter table` at the top of
  that file for anyone who ran the earlier version.
- **The app already knew the hour.** The picker defaulted to lunch at eight in
  the morning while `slotForHour` sat in proposals.ts being used by the coach
  and nothing else.
- **A model will invent a screen name** if you tell it to point at one without
  saying which exist. The app map in `COACH_SYSTEM_PROMPT` is not decoration.
- **Never let a model name a thing it can act on.** It picks ids from a
  catalogue you gave it, and you resolve them with the same function the UI
  uses. `parseProposal` also accepts a *name* where an id was asked for,
  because a model that has just written "two rotis" in the prose will sometimes
  write `roti` in the block, and refusing a match it obviously meant only makes
  the feature look broken.
- **Strip the machinery from the prose whether or not it parses.** A reply that
  ends in a wall of JSON is a bug she can see; a reply that quietly lost its
  card is one she cannot.
- **Applying a proposal can invalidate it.** Accepting a swap makes the offered
  exercise the prescribed one, so the same block stops parsing a second later.
  `proposalKind()` exists so the card becomes a receipt instead of disappearing.
- **`hidden` loses to any author `display` rule.** `.chat { display: flex }`
  beats the browser's own `[hidden] { display: none }` regardless of how
  specific that looks, because author styles outrank the UA sheet. Anything
  toggled with the attribute needs its own `[hidden]` rule.
- **Bulk-write in one transaction.** See `seed.ts`. `swapExercises` is the same
  lesson in miniature: looping over the single-swap helper reads the profile
  once per swap and writes back a map built from a stale copy, so only the last
  one survives.

## Safety

Not medical or dietetic advice, and the app says so on every screen that gives
a number.

The guardrails that exist because this app is for women who lift: the calorie
target is floored at BMR and at 30 kcal/kg fat-free mass; an absent period is
raised as a clinician question and outranks everything else in the coach's
briefing; BMI never appears without the note that it cannot tell muscle from
fat; and the coach is instructed to refuse to help construct a lower calorie
target and to name-and-hand-off rather than manage anything clinical.
