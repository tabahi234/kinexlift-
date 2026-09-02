-- Optional cloud backup for Kinex Lift.
--
-- READ THIS BEFORE RUNNING IT.
--
-- These tables hold training logs, body weight and menstrual cycle data. The
-- last of those is special-category health data under GDPR and its equivalents.
-- The first version of this file had no owner column and no row-level
-- security, which meant every user's period history sat in one table that any
-- holder of the (publicly shipped) anon key could read. Everything below
-- exists to stop that.
--
-- Before running it:
--   1. Supabase dashboard -> Authentication -> Providers -> Email: turn
--      **Confirm email** ON. Backup requires a real account (see the
--      settings note at the foot of this file for the other two switches).
--      Anonymous sign-ins are no longer used and should be OFF - an
--      anonymous account is one nobody can ever sign back into, which makes
--      the backup unrecoverable on a second device.
--   2. This script DROPS the old tables. That is safe: the device's IndexedDB
--      is the source of truth, and the app re-uploads everything on the next
--      backup. It is not safe if you have put anything else in them.
--
-- Backup stays off in the app until the user turns it on.

/* ------------------------- start from a clean slate ------------------------- */

drop table if exists
  public."profile",
  public."sessions",
  public."sets",
  public."checkins",
  public."cycleEvents",
  public."conditioning",
  public."bodyMetrics",
  public."meals",
  public."chat",
  public."coachNotes"
cascade;

-- Already ran an earlier version of this file? One column was added after
-- the fact, for food she types in herself. Run just this and you are level:
--
--   alter table public."meals" add column if not exists custom jsonb;
--
-- Without it the meal sync rejects every row carrying a custom food, and
-- takes the rest of that batch with it.

/* ------------------------------- tables ------------------------------- */
--
-- Every table is keyed on (user_id, id) rather than on id alone. Row ids are
-- UUIDv7 and unique in practice, but the profile is a singleton whose id is
-- the literal string 'profile' on every device - so an id-only primary key
-- would collide the moment a second person backed up. Keying all ten the same
-- way means the client can use one conflict target everywhere.

create table public."profile" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  "displayName" text,
  "birthYear" integer,
  "bodyWeightKg" real,
  "heightCm" real,
  goal text not null,
  experience text not null,
  location text not null,
  equipment text[],
  "daysPerWeek" integer not null,
  units text not null,
  "cycleTracking" text not null,
  limitations text[],
  "exerciseOverrides" jsonb not null default '{}'::jsonb,
  "readinessAdjustments" text not null,
  "onboardedAt" bigint,
  "trainingStyle" text,
  "activityLevel" text,
  "weightGoal" text,
  "dietPattern" text,
  "foodAvoid" text[],
  "coachOptIn" boolean,
  "cloudSync" boolean,
  primary key (user_id, id)
);

create table public."sessions" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  "startedAt" bigint not null,
  "endedAt" bigint,
  "templateId" text,
  notes text,
  "readinessOverride" boolean,
  primary key (user_id, id)
);

create table public."sets" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  "sessionId" text not null,
  "exerciseId" text not null,
  "performedAt" bigint not null,
  "weightKg" real not null,
  reps integer not null,
  rir integer,
  "isWarmup" boolean not null,
  primary key (user_id, id)
);

create table public."checkins" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  date text not null,
  sleep integer not null,
  energy integer not null,
  soreness integer not null,
  symptoms text[] not null default '{}',
  primary key (user_id, id)
);

create table public."cycleEvents" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  date text not null,
  kind text not null,
  primary key (user_id, id)
);

create table public."conditioning" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  "sessionId" text,
  date text not null,
  modality text not null,
  kind text not null,
  minutes integer not null,
  rpe integer not null,
  "distanceKm" real,
  rounds integer,
  "workSeconds" integer,
  "restSeconds" integer,
  primary key (user_id, id)
);

create table public."bodyMetrics" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  date text not null,
  "weightKg" real not null,
  "waistCm" real,
  note text,
  primary key (user_id, id)
);

create table public."meals" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  date text not null,
  slot text not null,
  "foodId" text not null,
  servings real not null,
  -- Food she wrote herself, denormalised onto the row. Null for anything
  -- from the curated table. See CustomFood in src/db/schema.ts for why it
  -- lives here rather than in a foods table of her own.
  custom jsonb,
  primary key (user_id, id)
);

create table public."chat" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  role text not null,
  content text not null,
  "createdAt" bigint not null,
  failed boolean,
  primary key (user_id, id)
);

create table public."coachNotes" (
  id text not null,
  user_id uuid not null default auth.uid(),
  "updatedAt" bigint not null,
  "deletedAt" bigint,
  "schemaVersion" integer not null,
  kind text not null,
  content text not null,
  "createdAt" bigint not null,
  "coversUntil" bigint,
  primary key (user_id, id)
);

/* -------------------- indexes and row-level security -------------------- */

do $$
declare
  t text;
begin
  foreach t in array array[
    'profile', 'sessions', 'sets', 'checkins', 'cycleEvents',
    'conditioning', 'bodyMetrics', 'meals', 'chat', 'coachNotes'
  ]
  loop
    -- The only query the client makes is "everything of mine changed since X".
    execute format(
      'create index if not exists %I on public.%I (user_id, "updatedAt")',
      t || '_user_updated_idx', t
    );

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);

    -- One policy for every command. `using` decides what she can see and
    -- change; `with check` is what stops a client writing a row stamped with
    -- somebody else's user_id.
    execute format(
      'create policy own_rows on public.%I for all to authenticated
         using (user_id = auth.uid())
         with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;

/* ------------------------- limits on what a row can be ------------------------- */
--
-- Row-level security answers "whose data is this". It says nothing at all
-- about "how much" or "how big", and those are the two ways a signed-in user
-- abuses a database they have legitimate access to.
--
-- Everything below assumes the client is hostile, because the client is a
-- browser and the anon key is in the bundle. Anyone can open a console and
-- POST whatever they like as themselves. RLS keeps that inside their own
-- rows; these constraints keep it inside a size a free tier can carry.

-- Free text. A training note is a sentence, not a novel, and unbounded text
-- is the cheapest way to fill a database.
alter table public."sessions"
  add constraint sessions_notes_len check (notes is null or length(notes) <= 2000);

alter table public."bodyMetrics"
  add constraint body_note_len check (note is null or length(note) <= 500);

-- The coach conversation is the one place long text is expected, so it gets a
-- generous ceiling rather than a tight one.
alter table public."chat"
  add constraint chat_content_len check (length(content) <= 20000);

alter table public."coachNotes"
  add constraint notes_content_len check (length(content) <= 20000);

-- Numbers, bounded to what a human body and a barbell can actually do. These
-- mirror the bounds the client already applies; having them here as well is
-- the point, because the client is not the thing being trusted.
alter table public."sets"
  add constraint sets_sane check (
    "weightKg" >= 0 and "weightKg" <= 1000
    and reps >= 0 and reps <= 1000
    and (rir is null or (rir >= 0 and rir <= 10))
  );

alter table public."bodyMetrics"
  add constraint body_sane check (
    "weightKg" > 0 and "weightKg" <= 500
    and ("waistCm" is null or ("waistCm" > 0 and "waistCm" <= 300))
  );

alter table public."checkins"
  add constraint checkin_sane check (
    sleep between 1 and 5 and energy between 1 and 5 and soreness between 1 and 5
  );

alter table public."conditioning"
  add constraint conditioning_sane check (
    minutes >= 0 and minutes <= 1440
    and rpe >= 0 and rpe <= 10
    and ("distanceKm" is null or ("distanceKm" >= 0 and "distanceKm" <= 1000))
    and (rounds is null or (rounds >= 0 and rounds <= 200))
  );

alter table public."meals"
  add constraint meals_sane check (
    servings > 0 and servings <= 50
    and length("foodId") <= 100
    -- A custom food is client-supplied JSON, which is exactly the field
    -- somebody would use to store something that is not a food.
    and (custom is null or pg_column_size(custom) <= 2000)
  );

alter table public."profile"
  add constraint profile_sane check (
    ("bodyWeightKg" is null or ("bodyWeightKg" > 0 and "bodyWeightKg" <= 500))
    and ("heightCm" is null or ("heightCm" > 0 and "heightCm" <= 300))
    and ("birthYear" is null or ("birthYear" >= 1900 and "birthYear" <= 2100))
    and "daysPerWeek" between 1 and 7
    and ("displayName" is null or length("displayName") <= 100)
    and coalesce(array_length(equipment, 1), 0) <= 50
    and coalesce(array_length(limitations, 1), 0) <= 50
    and coalesce(array_length("foodAvoid", 1), 0) <= 50
    and pg_column_size("exerciseOverrides") <= 20000
  );

-- Dates are a text column because the client stores local 'YYYY-MM-DD' and
-- must never have it shifted by a timezone. That is right, and it means the
-- shape has to be checked here or the column accepts any string at all.
do $$
declare
  t text;
begin
  foreach t in array array['checkins', 'cycleEvents', 'bodyMetrics', 'meals', 'conditioning']
  loop
    execute format(
      'alter table public.%I add constraint %I check (date ~ ''^\d{4}-\d{2}-\d{2}$'')',
      t, t || '_date_shape'
    );
  end loop;
end $$;

/* ---------------------------- how many rows ---------------------------- */
--
-- The remaining abuse is volume: nothing above stops one account inserting
-- ten million valid sets. A per-user, per-table ceiling does, and it is set
-- far above anything a decade of honest use produces - roughly 200 sets a
-- week for twenty years - so the only person who ever meets it is someone
-- doing it on purpose.
--
-- Counting on every insert would be a sequential scan per row. The
-- (user_id, "updatedAt") index makes the count an index-only scan, and the
-- check is skipped entirely on update, which is most writes.

create or replace function public.enforce_row_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ceiling constant integer := 200000;
  current_rows integer;
begin
  execute format('select count(*) from public.%I where user_id = $1', tg_table_name)
    into current_rows
    using new.user_id;

  if current_rows >= ceiling then
    raise exception
      'Row limit reached for this account on %. If you have hit this in normal use, it is a bug worth reporting.',
      tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_row_quota() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profile', 'sessions', 'sets', 'checkins', 'cycleEvents',
    'conditioning', 'bodyMetrics', 'meals', 'chat', 'coachNotes'
  ]
  loop
    execute format('drop trigger if exists row_quota on public.%I', t);
    -- INSERT only. An update replaces a row rather than adding one, and
    -- charging it against the quota would make the app stop working for
    -- somebody who simply edits a lot.
    execute format(
      'create trigger row_quota before insert on public.%I
         for each row execute function public.enforce_row_quota()',
      t
    );
  end loop;
end $$;

/* ------------------------- settings, not SQL ------------------------- */
--
-- Three things this file cannot do for you. They are in the Supabase
-- dashboard and the account is materially less safe without them.
--
--   1. Authentication -> Providers -> Email: turn **Confirm email** ON.
--      Without it anybody can create an account on an address they do not
--      own, and the app will happily start uploading to it.
--
--   2. Authentication -> Policies (Password): minimum length 12, and turn on
--      **leaked password protection**, which checks new passwords against
--      HaveIBeenPwned. The app enforces 12 client-side; that is a courtesy to
--      the user, not a control - a control has to be server-side.
--
--   3. Authentication -> Rate limits: leave the defaults on. They are what
--      stands between this and someone working through a password list.
--
-- Anonymous sign-ins are no longer used and should be turned OFF: backup now
-- requires a real account so a second device can actually retrieve the data,
-- and an anonymous session is an account nobody can ever sign back into.
