-- ============================================================
-- Wooglin Cup — Milestones 2+3: full schema + seed
-- Run this in Supabase SQL Editor (idempotent)
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────
do $$ begin
  create type player_role as enum ('admin', 'assistant', 'captain', 'player');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type event_status as enum ('draft', 'active', 'complete');
exception when duplicate_object then null;
end $$;

-- ── Players ──────────────────────────────────────────────────
create table if not exists players (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid references auth.users(id) on delete set null,
  name            text not null,
  nickname        text,
  email           text unique not null,
  avatar_url      text,
  current_index   numeric(4,1),
  ghin_id         text,
  role            player_role not null default 'player',
  created_at      timestamptz not null default now()
);

create index if not exists players_auth_user_id_idx on players(auth_user_id);
create index if not exists players_email_idx on players(email);
alter table players enable row level security;

drop policy if exists "authenticated users can read players" on players;
drop policy if exists "player can update own row" on players;
drop policy if exists "admins can insert players" on players;
drop policy if exists "admins can delete players" on players;
drop policy if exists "admins can update players" on players;

create policy "authenticated users can read players"
  on players for select to authenticated using (true);

create policy "player can update own row"
  on players for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy "admins can insert players"
  on players for insert to authenticated
  with check (
    exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant'))
  );

create policy "admins can update players"
  on players for update to authenticated
  using (
    exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant'))
  );

create policy "admins can delete players"
  on players for delete to authenticated
  using (
    exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant'))
  );

-- ── Events ───────────────────────────────────────────────────
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  year        integer not null,
  name        text not null,
  location    text,
  start_date  date,
  end_date    date,
  status      event_status not null default 'draft',
  created_at  timestamptz not null default now()
);

alter table events enable row level security;

-- Multiple events per year are allowed; drop the legacy unique(year) constraint if present.
alter table events drop constraint if exists events_year_key;

drop policy if exists "authenticated users can read events" on events;
drop policy if exists "admins can manage events" on events;

create policy "authenticated users can read events"
  on events for select to authenticated using (true);

create policy "admins can manage events"
  on events for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ── Teams ────────────────────────────────────────────────────
create table if not exists teams (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references events(id) on delete cascade,
  name      text not null,
  color     text not null
);

alter table teams enable row level security;

drop policy if exists "authenticated users can read teams" on teams;
drop policy if exists "admins can manage teams" on teams;

create policy "authenticated users can read teams"
  on teams for select to authenticated using (true);

create policy "admins can manage teams"
  on teams for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ── Event participants ────────────────────────────────────────
create table if not exists event_participants (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  player_id     uuid references players(id) on delete set null,
  team_id       uuid references teams(id) on delete cascade,
  display_name  text not null,
  is_captain    boolean not null default false,
  deposit_paid  boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists ep_event_idx on event_participants(event_id);
create index if not exists ep_player_idx on event_participants(player_id);
alter table event_participants enable row level security;

drop policy if exists "authenticated users can read participants" on event_participants;
drop policy if exists "admins can manage participants" on event_participants;

create policy "authenticated users can read participants"
  on event_participants for select to authenticated using (true);

create policy "admins can manage participants"
  on event_participants for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ── Auth triggers ─────────────────────────────────────────────
create or replace function public.handle_auth_user_login()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update players set auth_user_id = new.id
  where email = new.email and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_auth_user_login();

create or replace function public.handle_auth_user_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update players set auth_user_id = new.id
  where email = new.email and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute procedure public.handle_auth_user_updated();

-- ============================================================
-- SEED: 2025 event (idempotent)
-- ============================================================

-- Players
-- Guarded by NICKNAME (not email): admins edit emails to real addresses, so
-- an email-keyed upsert would resurrect placeholder rows on every re-run.
insert into players (name, nickname, email, current_index, role)
select v.name, v.nickname, v.email, v.current_index::numeric, v.role::player_role
from (values
  ('Kyle Williams',      'Kyle',    'kyle@fairwayfinancialpartners.com', 8.0,  'admin'),
  ('Ryan Hendrickson',   'Ryan',    'ryan@wooglin.local',                12.4, 'captain'),
  ('Joe Guenther',       'JoeG',    'joeg@wooglin.local',                16.1, 'player'),
  ('Joey Merritt',       'Joey',    'joey@wooglin.local',                12.0, 'player'),
  ('Lars',               'Lars',    'lars@wooglin.local',                null, 'player'),
  ('Matt Ross',          'Ross',    'ross@wooglin.local',                21.0, 'player'),
  ('Matthew Allred',     'Allred',  'allred@wooglin.local',              9.0,  'player'),
  ('Michael Stribos',    'Stribos', 'stribos@wooglin.local',             10.5, 'player'),
  ('Brendan Cross',      'Brendan', 'brendan@wooglin.local',             8.0,  'captain'),
  ('David Harrington',   'Dave',    'dave@wooglin.local',                11.6, 'player'),
  ('Holt Harrell',       'Holt',    'holt@wooglin.local',                11.1, 'player'),
  ('Jared Shoops',       'Shoops',  'shoops@wooglin.local',              10.1, 'player'),
  ('Michael Boynton',    'Boynton', 'boynton@wooglin.local',             13.1, 'player'),
  ('Sam Taylor',         'SammyT',  'sammyt@wooglin.local',              14.7, 'player'),
  ('Zach Williams',      'Zach',    'zach@wooglin.local',                null, 'player'),
  ('Alex Moore',         'Moore',   'moore@wooglin.local',               null, 'player')
) as v(name, nickname, email, current_index, role)
where not exists (select 1 from players p where p.nickname = v.nickname);

-- 2025 Event
-- Idempotent by name (year is no longer unique): update if the seed event exists, else insert.
update events set
  location   = 'Pinehurst, NC',
  start_date = '2025-09-18',
  end_date   = '2025-09-20',
  status     = 'complete'
where name = '12th Annual Wooglin Cup' and year = 2025;

insert into events (year, name, location, start_date, end_date, status)
select 2025, '12th Annual Wooglin Cup', 'Pinehurst, NC', '2025-09-18', '2025-09-20', 'complete'
where not exists (
  select 1 from events where name = '12th Annual Wooglin Cup' and year = 2025
);

-- Teams (delete + re-insert scoped to 2025 event for idempotency)
do $$
declare
  v_event_id uuid;
  v_usa_id   uuid;
  v_eur_id   uuid;
begin
  select id into v_event_id from events where name = '12th Annual Wooglin Cup' and year = 2025;

  -- Remove existing teams for this event (cascades to participants)
  delete from teams where event_id = v_event_id;

  insert into teams (event_id, name, color) values (v_event_id, 'USA',    '#BE2F27') returning id into v_usa_id;
  insert into teams (event_id, name, color) values (v_event_id, 'Europe', '#185D3B') returning id into v_eur_id;

  -- Rosters keyed by nickname (emails get edited to real addresses)
  -- USA roster
  insert into event_participants (event_id, player_id, team_id, display_name, is_captain)
  select v_event_id, p.id, v_usa_id, p.nickname, (p.nickname = 'Ryan')
  from players p where p.nickname in
    ('Ryan','JoeG','Joey','Lars','Ross','Allred','Stribos','Moore');

  -- Europe roster
  insert into event_participants (event_id, player_id, team_id, display_name, is_captain)
  select v_event_id, p.id, v_eur_id, p.nickname, (p.nickname = 'Brendan')
  from players p where p.nickname in
    ('Brendan','Dave','Holt','Shoops','Kyle','Boynton','SammyT','Zach');
end;
$$;

-- ============================================================
-- Milestone 4: courses, course_tees, holes
-- ============================================================

create table if not exists courses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  location   text,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'courses_name_unique') then
    alter table courses add constraint courses_name_unique unique (name);
  end if;
end $$;
alter table courses enable row level security;
drop policy if exists "authenticated users can read courses" on courses;
drop policy if exists "admins can manage courses" on courses;
create policy "authenticated users can read courses" on courses for select to authenticated using (true);
create policy "admins can manage courses" on courses for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

create table if not exists course_tees (
  id        uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  tee_name  text not null,
  unique (course_id, tee_name),
  rating    numeric(4,1) not null,
  slope     integer not null,
  par       integer not null
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'course_tees_course_id_tee_name_key') then
    alter table course_tees add constraint course_tees_course_id_tee_name_key unique (course_id, tee_name);
  end if;
end $$;
alter table course_tees enable row level security;
drop policy if exists "authenticated users can read tees" on course_tees;
drop policy if exists "admins can manage tees" on course_tees;
create policy "authenticated users can read tees" on course_tees for select to authenticated using (true);
create policy "admins can manage tees" on course_tees for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

create table if not exists holes (
  id             uuid primary key default gen_random_uuid(),
  course_tee_id  uuid not null references course_tees(id) on delete cascade,
  hole_number    integer not null check (hole_number between 1 and 18),
  par            integer not null,
  stroke_index   integer not null check (stroke_index between 1 and 18),
  unique (course_tee_id, hole_number)
);

alter table holes enable row level security;
drop policy if exists "authenticated users can read holes" on holes;
drop policy if exists "admins can manage holes" on holes;
create policy "authenticated users can read holes" on holes for select to authenticated using (true);
create policy "admins can manage holes" on holes for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ============================================================
-- EVENT_COURSES (join: which courses are played at each event)
-- ============================================================
create table if not exists event_courses (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  course_id  uuid not null references courses(id) on delete cascade,
  unique (event_id, course_id)
);
alter table event_courses enable row level security;
drop policy if exists "authenticated users can read event_courses" on event_courses;
drop policy if exists "admins can manage event_courses" on event_courses;
create policy "authenticated users can read event_courses" on event_courses for select to authenticated using (true);
create policy "admins can manage event_courses" on event_courses for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ============================================================
-- Milestone 5: formats
-- ============================================================
create table if not exists formats (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null unique,
  description             text,
  team_size               integer,  -- null = singles
  hcp_allowance           integer not null default 100 check (hcp_allowance between 0 and 100),
  hcp_allowance_secondary integer check (hcp_allowance_secondary between 0 and 100),  -- used for high-hdcp player in scramble
  sort_order              integer not null default 0
);
alter table formats add column if not exists hcp_allowance integer not null default 100 check (hcp_allowance between 0 and 100);
alter table formats add column if not exists hcp_allowance_secondary integer check (hcp_allowance_secondary between 0 and 100);

alter table formats enable row level security;
drop policy if exists "authenticated users can read formats" on formats;
create policy "authenticated users can read formats" on formats for select to authenticated using (true);

insert into formats (name, description, team_size, hcp_allowance, hcp_allowance_secondary, sort_order) values
  ('Best Ball', '2-man best ball. Each player plays their own ball; best net score on each hole counts.',                                                   2, 100, null, 1),
  ('Shamble',   'Each player hits a tee shot. Best drive selected; each plays their own ball in. Best net score counts. Must use 1 drive from each player.', 2,  70, null, 2),
  ('Pinehurst', 'Each player hits a tee shot, then switches balls for the second shot. Team selects the best ball and alternates shots into the hole.',      2,  50, null, 3),
  ('Scramble',  '2-man scramble. Must use 2 drives from each player. Low handicap player: 35% allowance; high handicap player: 15% allowance.',             2,  35,   15, 4),
  ('Singles',   'One-on-one match play.',                                                                                                                    1, 100, null, 5)
on conflict (name) do update set
  description             = excluded.description,
  team_size               = excluded.team_size,
  hcp_allowance           = excluded.hcp_allowance,
  hcp_allowance_secondary = excluded.hcp_allowance_secondary,
  sort_order              = excluded.sort_order;

-- ============================================================
-- Milestone 6: rounds
-- ============================================================
create table if not exists rounds (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  course_tee_id  uuid not null references course_tees(id),
  format_id      uuid not null references formats(id),
  round_number   integer not null,
  name           text,
  side           text not null default 'full' check (side in ('front', 'back', 'full')),
  played_at      date,
  status         text not null default 'pending' check (status in ('pending', 'active', 'complete')),
  unique (event_id, round_number)
);
alter table rounds enable row level security;
drop policy if exists "authenticated users can read rounds" on rounds;
drop policy if exists "admins can manage rounds" on rounds;
create policy "authenticated users can read rounds" on rounds for select to authenticated using (true);
create policy "admins can manage rounds" on rounds for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ============================================================
-- Milestone 7b: participant_handicaps
-- ============================================================
create table if not exists participant_handicaps (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  player_id       uuid not null references players(id) on delete cascade,
  course_tee_id   uuid not null references course_tees(id) on delete cascade,
  calculated_hcp  integer,
  override_hcp    integer,
  unique (event_id, player_id, course_tee_id)
);
alter table participant_handicaps enable row level security;
drop policy if exists "authenticated users can read participant_handicaps" on participant_handicaps;
drop policy if exists "admins can manage participant_handicaps" on participant_handicaps;
create policy "authenticated users can read participant_handicaps" on participant_handicaps for select to authenticated using (true);
create policy "admins can manage participant_handicaps" on participant_handicaps for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ============================================================
-- SEED: 3 courses (idempotent)
-- ============================================================
do $$
declare
  v_mid_pines uuid; v_pine_wild uuid; v_tobacco uuid;
  v_mp_blue   uuid; v_pw_blue   uuid; v_tr_disc  uuid;
begin
  -- Mid Pines
  insert into courses (name, location) values ('Mid Pines Inn & Golf Club', 'Southern Pines, NC') on conflict (name) do nothing;
  select id into v_mid_pines from courses where name = 'Mid Pines Inn & Golf Club';
  insert into course_tees (course_id, tee_name, rating, slope, par) values (v_mid_pines, 'Blue', 72.9, 138, 72)
    on conflict (course_id, tee_name) do update set rating = excluded.rating, slope = excluded.slope, par = excluded.par
    returning id into v_mp_blue;
  insert into holes (course_tee_id, hole_number, par, stroke_index) values
    (v_mp_blue,  1, 4,  7),(v_mp_blue,  2, 5, 11),(v_mp_blue,  3, 3, 17),
    (v_mp_blue,  4, 4,  1),(v_mp_blue,  5, 4,  5),(v_mp_blue,  6, 4, 13),
    (v_mp_blue,  7, 3, 15),(v_mp_blue,  8, 4,  3),(v_mp_blue,  9, 5,  9),
    (v_mp_blue, 10, 4,  8),(v_mp_blue, 11, 4,  2),(v_mp_blue, 12, 3, 18),
    (v_mp_blue, 13, 5, 10),(v_mp_blue, 14, 4,  4),(v_mp_blue, 15, 4, 16),
    (v_mp_blue, 16, 3, 14),(v_mp_blue, 17, 5,  6),(v_mp_blue, 18, 4, 12)
    on conflict (course_tee_id, hole_number) do update set par = excluded.par, stroke_index = excluded.stroke_index;

  -- Pine Wild - Magnolia
  insert into courses (name, location) values ('Pine Wild Golf Club - Magnolia', 'Pinehurst, NC') on conflict (name) do nothing;
  select id into v_pine_wild from courses where name = 'Pine Wild Golf Club - Magnolia';
  insert into course_tees (course_id, tee_name, rating, slope, par) values (v_pine_wild, 'Blue', 73.8, 134, 72)
    on conflict (course_id, tee_name) do update set rating = excluded.rating, slope = excluded.slope, par = excluded.par
    returning id into v_pw_blue;
  insert into holes (course_tee_id, hole_number, par, stroke_index) values
    (v_pw_blue,  1, 4,  5),(v_pw_blue,  2, 5, 13),(v_pw_blue,  3, 3, 17),
    (v_pw_blue,  4, 4,  1),(v_pw_blue,  5, 4,  9),(v_pw_blue,  6, 4,  3),
    (v_pw_blue,  7, 3, 15),(v_pw_blue,  8, 5, 11),(v_pw_blue,  9, 4,  7),
    (v_pw_blue, 10, 4,  6),(v_pw_blue, 11, 3, 18),(v_pw_blue, 12, 4,  2),
    (v_pw_blue, 13, 5, 14),(v_pw_blue, 14, 4,  4),(v_pw_blue, 15, 4, 16),
    (v_pw_blue, 16, 3, 10),(v_pw_blue, 17, 5,  8),(v_pw_blue, 18, 4, 12)
    on conflict (course_tee_id, hole_number) do update set par = excluded.par, stroke_index = excluded.stroke_index;

  -- Tobacco Road
  insert into courses (name, location) values ('Tobacco Road Golf Club', 'Sanford, NC') on conflict (name) do nothing;
  select id into v_tobacco from courses where name = 'Tobacco Road Golf Club';
  insert into course_tees (course_id, tee_name, rating, slope, par) values (v_tobacco, 'Disc', 70.3, 135, 71)
    on conflict (course_id, tee_name) do update set rating = excluded.rating, slope = excluded.slope, par = excluded.par
    returning id into v_tr_disc;
  insert into holes (course_tee_id, hole_number, par, stroke_index) values
    (v_tr_disc,  1, 5,  3),(v_tr_disc,  2, 4, 11),(v_tr_disc,  3, 3, 17),
    (v_tr_disc,  4, 5,  9),(v_tr_disc,  5, 4, 15),(v_tr_disc,  6, 3, 13),
    (v_tr_disc,  7, 4,  7),(v_tr_disc,  8, 3,  5),(v_tr_disc,  9, 4,  1),
    (v_tr_disc, 10, 4,  6),(v_tr_disc, 11, 5, 10),(v_tr_disc, 12, 4, 14),
    (v_tr_disc, 13, 5,  2),(v_tr_disc, 14, 3,  8),(v_tr_disc, 15, 4, 12),
    (v_tr_disc, 16, 4, 16),(v_tr_disc, 17, 3, 18),(v_tr_disc, 18, 3,  4)
    on conflict (course_tee_id, hole_number) do update set par = excluded.par, stroke_index = excluded.stroke_index;
end;
$$;

-- ============================================================
-- Milestone 8: matchups
-- ============================================================

create table if not exists matchups (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references rounds(id) on delete cascade,
  match_number  int not null,
  -- home = first team listed for the event, away = second
  home_p1_id    uuid references event_participants(id) on delete set null,
  home_p2_id    uuid references event_participants(id) on delete set null,
  away_p1_id    uuid references event_participants(id) on delete set null,
  away_p2_id    uuid references event_participants(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','active','complete')),
  result        text check (result in ('home','away','halve')),
  unique (round_id, match_number),
  created_at    timestamptz not null default now()
);

alter table matchups enable row level security;
drop policy if exists "authenticated users can read matchups" on matchups;
drop policy if exists "admins can manage matchups" on matchups;
create policy "authenticated users can read matchups" on matchups for select to authenticated using (true);
create policy "admins can manage matchups" on matchups for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- Milestone 8b: tee_time on matchups
alter table matchups add column if not exists tee_time time;

-- Milestone 8c: match_score on matchups
alter table matchups add column if not exists match_score text;

-- ============================================================
-- Milestone 9: hole_scores
-- ============================================================

create table if not exists hole_scores (
  id             uuid primary key default gen_random_uuid(),
  matchup_id     uuid not null references matchups(id) on delete cascade,
  hole_number    int not null,
  home_p1_gross  int,
  home_p2_gross  int,
  away_p1_gross  int,
  away_p2_gross  int,
  unique (matchup_id, hole_number),
  created_at     timestamptz not null default now()
);

alter table hole_scores enable row level security;
drop policy if exists "authenticated users can read hole_scores" on hole_scores;
drop policy if exists "admins can manage hole_scores" on hole_scores;
create policy "authenticated users can read hole_scores" on hole_scores for select to authenticated using (true);
create policy "admins can manage hole_scores" on hole_scores for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ============================================================
-- Fix: event_participants.team_id should cascade (not set null)
-- Also purge duplicate participants caused by prior seed runs
-- ============================================================

-- 1. Re-create the FK with CASCADE
do $$ begin
  alter table event_participants drop constraint if exists event_participants_team_id_fkey;
  alter table event_participants
    add constraint event_participants_team_id_fkey
    foreign key (team_id) references teams(id) on delete cascade;
exception when others then null;
end $$;

-- 2. Delete all participants for seeded 2025 event so seed re-runs clean
do $$
declare v_event_id uuid;
begin
  select id into v_event_id from events where name = '12th Annual Wooglin Cup' and year = 2025;
  if v_event_id is not null then
    delete from event_participants where event_id = v_event_id;
    delete from teams where event_id = v_event_id;
  end if;
end $$;

-- ============================================================
-- Milestone 10: live scoreboard + player scoring
-- ============================================================

-- Scoring exception (architecture doc): any player IN a match can enter/edit
-- that match's hole scores. Admin policy above already covers admins.
drop policy if exists "match participants can score their match" on hole_scores;
create policy "match participants can score their match" on hole_scores
  for all to authenticated
  using (exists (
    select 1 from matchups m
    join event_participants ep
      on ep.id in (m.home_p1_id, m.home_p2_id, m.away_p1_id, m.away_p2_id)
    join players p on p.id = ep.player_id
    where m.id = hole_scores.matchup_id
      and p.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from matchups m
    join event_participants ep
      on ep.id in (m.home_p1_id, m.home_p2_id, m.away_p1_id, m.away_p2_id)
    join players p on p.id = ep.player_id
    where m.id = hole_scores.matchup_id
      and p.auth_user_id = auth.uid()
  ));

-- Participants can complete their own match (status/result/match_score).
drop policy if exists "match participants can update their matchup" on matchups;
create policy "match participants can update their matchup" on matchups
  for update to authenticated
  using (exists (
    select 1 from event_participants ep
    join players p on p.id = ep.player_id
    where ep.id in (matchups.home_p1_id, matchups.home_p2_id, matchups.away_p1_id, matchups.away_p2_id)
      and p.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from event_participants ep
    join players p on p.id = ep.player_id
    where ep.id in (matchups.home_p1_id, matchups.home_p2_id, matchups.away_p1_id, matchups.away_p2_id)
      and p.auth_user_id = auth.uid()
  ));

-- Realtime: publish changes so the live scoreboard updates without refresh.
do $$
begin
  alter publication supabase_realtime add table hole_scores;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table matchups;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- Milestone 11: history archive (lightweight backfill)
-- ============================================================

-- One row per cup year. Past years (2014-2024) are free-text backfill;
-- event_id optionally links years that exist as full events in the app.
create table if not exists event_results (
  id          uuid primary key default gen_random_uuid(),
  year        integer unique not null,
  event_id    uuid references events(id) on delete set null,
  winner      text not null,        -- 'USA' | 'Europe' | 'Tie'
  final_score text,                 -- e.g. '14.5 – 13.5'
  location    text,
  captains    text,                 -- free text, e.g. 'Ryan (USA) · Brendan (Europe)'
  roster      text,                 -- free text participant list
  notes       text,
  created_at  timestamptz not null default now()
);

alter table event_results enable row level security;
drop policy if exists "authenticated users can read event_results" on event_results;
drop policy if exists "admins can manage event_results" on event_results;
create policy "authenticated users can read event_results"
  on event_results for select to authenticated using (true);
create policy "admins can manage event_results"
  on event_results for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ============================================================
-- Milestone 11b: appearance backfill from the 2014-2025 spreadsheet
-- ============================================================

-- Per-year cup result for each player (their team's W/L that year).
create table if not exists player_appearances (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players(id) on delete cascade,
  year       integer not null,
  result     text not null check (result in ('W','L','T')),
  unique (player_id, year)
);

alter table player_appearances enable row level security;
drop policy if exists "authenticated users can read player_appearances" on player_appearances;
drop policy if exists "admins can manage player_appearances" on player_appearances;
create policy "authenticated users can read player_appearances"
  on player_appearances for select to authenticated using (true);
create policy "admins can manage player_appearances"
  on player_appearances for all to authenticated
  using (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (exists (select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- Players from the spreadsheet who aren't in the app yet (placeholder emails).
-- Guarded by nickname so edited emails/names never resurrect duplicates.
insert into players (name, nickname, email, role)
select v.name, v.nickname, v.email, v.role::player_role
from (values
  ('JC', 'JC', 'jc@wooglin.local', 'player'),
  ('Kaplan', 'Kaplan', 'kaplan@wooglin.local', 'player'),
  ('Leamer', 'Leamer', 'leamer@wooglin.local', 'player'),
  ('AJ', 'AJ', 'aj@wooglin.local', 'player'),
  ('Jason', 'Jason', 'jason@wooglin.local', 'player'),
  ('Connor', 'Connor', 'connor@wooglin.local', 'player'),
  ('Allen', 'Allen', 'allen@wooglin.local', 'player'),
  ('Hugh', 'Hugh', 'hugh@wooglin.local', 'player'),
  ('Charlie', 'Charlie', 'charlie@wooglin.local', 'player'),
  ('Greg Stribos', 'Greg Stribos', 'gregstribos@wooglin.local', 'player'),
  ('Cole', 'Cole', 'cole@wooglin.local', 'player'),
  ('Drew', 'Drew', 'drew@wooglin.local', 'player'),
  ('Rob', 'Rob', 'rob@wooglin.local', 'player'),
  ('Will G', 'Will G', 'willg@wooglin.local', 'player'),
  ('Derm Dave', 'Derm Dave', 'dermdave@wooglin.local', 'player')
) as v(name, nickname, email, role)
where not exists (select 1 from players p where p.nickname = v.nickname);

-- Year-by-year results keyed by nickname (idempotent).
insert into player_appearances (player_id, year, result)
select p.id, v.year, v.result
from (values
  ('Moore', 2014, 'L'),
  ('Moore', 2015, 'W'),
  ('Moore', 2016, 'W'),
  ('Moore', 2017, 'W'),
  ('Moore', 2018, 'W'),
  ('Moore', 2019, 'L'),
  ('Moore', 2020, 'L'),
  ('Moore', 2021, 'W'),
  ('Moore', 2022, 'L'),
  ('Moore', 2023, 'L'),
  ('Moore', 2024, 'W'),
  ('Moore', 2025, 'W'),
  ('Kyle', 2014, 'L'),
  ('Kyle', 2015, 'W'),
  ('Kyle', 2016, 'W'),
  ('Kyle', 2017, 'W'),
  ('Kyle', 2018, 'L'),
  ('Kyle', 2019, 'L'),
  ('Kyle', 2020, 'L'),
  ('Kyle', 2021, 'L'),
  ('Kyle', 2022, 'W'),
  ('Kyle', 2023, 'W'),
  ('Kyle', 2024, 'L'),
  ('Kyle', 2025, 'L'),
  ('JC', 2014, 'L'),
  ('JC', 2015, 'W'),
  ('JC', 2016, 'W'),
  ('JC', 2017, 'W'),
  ('JC', 2019, 'L'),
  ('JC', 2020, 'L'),
  ('JC', 2021, 'W'),
  ('JC', 2023, 'W'),
  ('JC', 2024, 'W'),
  ('Joey', 2017, 'L'),
  ('Joey', 2018, 'W'),
  ('Joey', 2019, 'W'),
  ('Joey', 2020, 'W'),
  ('Joey', 2021, 'W'),
  ('Joey', 2022, 'W'),
  ('Joey', 2023, 'W'),
  ('Joey', 2024, 'L'),
  ('Joey', 2025, 'W'),
  ('Stribos', 2014, 'W'),
  ('Stribos', 2015, 'L'),
  ('Stribos', 2018, 'W'),
  ('Stribos', 2020, 'W'),
  ('Stribos', 2021, 'L'),
  ('Stribos', 2022, 'L'),
  ('Stribos', 2023, 'W'),
  ('Stribos', 2024, 'L'),
  ('Stribos', 2025, 'W'),
  ('Ryan', 2014, 'W'),
  ('Ryan', 2015, 'W'),
  ('Ryan', 2016, 'L'),
  ('Ryan', 2017, 'L'),
  ('Ryan', 2019, 'L'),
  ('Ryan', 2021, 'L'),
  ('Ryan', 2022, 'W'),
  ('Ryan', 2024, 'W'),
  ('Ryan', 2025, 'W'),
  ('Kaplan', 2014, 'W'),
  ('Kaplan', 2015, 'L'),
  ('Kaplan', 2016, 'L'),
  ('Kaplan', 2017, 'W'),
  ('Kaplan', 2019, 'L'),
  ('Kaplan', 2021, 'W'),
  ('Kaplan', 2022, 'L'),
  ('Kaplan', 2024, 'W'),
  ('Leamer', 2014, 'W'),
  ('Leamer', 2015, 'L'),
  ('Leamer', 2016, 'L'),
  ('Leamer', 2017, 'L'),
  ('Leamer', 2019, 'W'),
  ('Leamer', 2021, 'L'),
  ('Leamer', 2023, 'L'),
  ('Leamer', 2024, 'W'),
  ('Ross', 2014, 'W'),
  ('Ross', 2015, 'L'),
  ('Ross', 2016, 'L'),
  ('Ross', 2018, 'L'),
  ('Ross', 2019, 'L'),
  ('Ross', 2021, 'L'),
  ('Ross', 2022, 'L'),
  ('Ross', 2024, 'L'),
  ('Ross', 2025, 'W'),
  ('AJ', 2014, 'L'),
  ('AJ', 2015, 'W'),
  ('AJ', 2016, 'L'),
  ('AJ', 2017, 'L'),
  ('AJ', 2019, 'W'),
  ('AJ', 2021, 'W'),
  ('AJ', 2022, 'W'),
  ('Boynton', 2018, 'W'),
  ('Boynton', 2019, 'W'),
  ('Boynton', 2020, 'W'),
  ('Boynton', 2021, 'W'),
  ('Boynton', 2022, 'W'),
  ('Boynton', 2023, 'W'),
  ('Boynton', 2024, 'W'),
  ('Boynton', 2025, 'L'),
  ('Lars', 2014, 'L'),
  ('Lars', 2016, 'W'),
  ('Lars', 2020, 'L'),
  ('Lars', 2021, 'W'),
  ('Lars', 2022, 'W'),
  ('Lars', 2023, 'L'),
  ('Lars', 2024, 'L'),
  ('Lars', 2025, 'W'),
  ('Dave', 2016, 'L'),
  ('Dave', 2018, 'L'),
  ('Dave', 2019, 'W'),
  ('Dave', 2021, 'L'),
  ('Dave', 2022, 'L'),
  ('Dave', 2023, 'L'),
  ('Dave', 2024, 'L'),
  ('Dave', 2025, 'L'),
  ('Jason', 2014, 'L'),
  ('Jason', 2016, 'W'),
  ('Jason', 2018, 'L'),
  ('Jason', 2019, 'L'),
  ('Jason', 2021, 'L'),
  ('Jason', 2022, 'L'),
  ('Brendan', 2015, 'W'),
  ('Brendan', 2016, 'W'),
  ('Brendan', 2017, 'L'),
  ('Brendan', 2022, 'L'),
  ('Brendan', 2024, 'L'),
  ('Brendan', 2025, 'L'),
  ('JoeG', 2018, 'L'),
  ('JoeG', 2020, 'L'),
  ('JoeG', 2022, 'W'),
  ('JoeG', 2023, 'L'),
  ('JoeG', 2024, 'W'),
  ('JoeG', 2025, 'W'),
  ('Connor', 2014, 'W'),
  ('Connor', 2015, 'W'),
  ('Connor', 2016, 'L'),
  ('Connor', 2019, 'W'),
  ('Allen', 2015, 'W'),
  ('Allen', 2016, 'W'),
  ('Allen', 2017, 'L'),
  ('Allen', 2019, 'W'),
  ('Hugh', 2015, 'L'),
  ('Hugh', 2016, 'L'),
  ('Hugh', 2017, 'W'),
  ('Hugh', 2019, 'L'),
  ('SammyT', 2020, 'W'),
  ('SammyT', 2022, 'W'),
  ('SammyT', 2023, 'W'),
  ('SammyT', 2025, 'L'),
  ('Charlie', 2015, 'L'),
  ('Charlie', 2019, 'W'),
  ('Charlie', 2021, 'L'),
  ('Allred', 2018, 'W'),
  ('Allred', 2020, 'W'),
  ('Allred', 2025, 'W'),
  ('Shoops', 2015, 'L'),
  ('Shoops', 2016, 'W'),
  ('Shoops', 2025, 'L'),
  ('Greg Stribos', 2021, 'W'),
  ('Greg Stribos', 2022, 'L'),
  ('Cole', 2015, 'L'),
  ('Cole', 2019, 'L'),
  ('Holt', 2018, 'W'),
  ('Holt', 2024, 'W'),
  ('Holt', 2025, 'L'),
  ('Drew', 2019, 'W'),
  ('Rob', 2020, 'W'),
  ('Will G', 2018, 'L'),
  ('Derm Dave', 2023, 'L'),
  ('Zach', 2025, 'L')
) as v(nickname, year, result)
join players p on p.nickname = v.nickname
on conflict (player_id, year) do update set result = excluded.result;

-- ============================================================
-- Milestone 11c: seed past cup results (champions slide + sheet locations)
-- Rosters listed are the WINNING team, normalized to app nicknames
-- (slide "Kevin" = Lars, "Jared" = Shoops, "David" = Dave,
--  "Greg" = Greg Stribos, "Sam" = SammyT).
-- ============================================================

insert into event_results (year, winner, location, captains, roster) values
  (2024, 'Europe', 'Pawleys',     'JoeG © (Europe)',    'JoeG ©, Moore, Holt, JC, Leamer, Boynton, Kaplan, Ryan'),
  (2023, 'Europe', 'Kiawah',      'Kyle © (Europe)',    'Kyle ©, Joey, JC, Boynton, Stribos, SammyT'),
  (2022, 'USA',    'Pawleys',     'Joey © (USA)',       'Joey ©, AJ, Boynton, JoeG, Lars, Kyle, Ryan, SammyT'),
  (2021, 'Europe', 'Scottsdale',  'Kaplan © (Europe)',  'Kaplan ©, AJ, Moore, Greg Stribos, Joey, JC, Lars, Boynton'),
  (2020, 'USA',    'St Simons',   'Boynton © (USA)',    'Boynton ©, Joey, Allred, Stribos, Rob, SammyT'),
  (2019, 'Europe', 'HHI',         'AJ © (Europe)',      'AJ ©, Allen, Charlie, Connor, Dave, Drew, Joey, Leamer, Boynton'),
  (2018, 'Europe', 'Pawleys',     'Moore © (Europe)',   'Moore ©, Holt, Stribos, Joey, Allred, Boynton'),
  (2017, 'Europe', 'HHI',         'Hugh © (Europe)',    'Hugh ©, Kaplan, JC, Moore, Kyle'),
  (2016, 'USA',    'Lake Oconee', 'Allen © (USA)',      'Allen ©, Moore, Brendan, Shoops, Jason, JC, Lars, Kyle'),
  (2015, 'USA',    'HHI',         'Allen © (USA)',      'Allen ©, AJ, Moore, Brendan, Connor, Kyle, JC, Ryan'),
  (2014, 'Europe', 'HHI',         null,                 'Connor, Kaplan, Leamer, Ross, Ryan, Stribos')
on conflict (year) do update set
  winner   = excluded.winner,
  location = excluded.location,
  captains = excluded.captains,
  roster   = excluded.roster;

-- 2025 lives in the app as a full event; link it and record the result.
insert into event_results (year, winner, location, captains, event_id)
select 2025, 'USA', 'Pinehurst', 'Ryan © (USA)',
       (select id from events where name = '12th Annual Wooglin Cup' and year = 2025 limit 1)
on conflict (year) do update set
  winner   = excluded.winner,
  location = excluded.location,
  captains = excluded.captains,
  event_id = excluded.event_id;

-- ============================================================
-- Players.email is the single source of truth for login linkage.
-- Editing a player's email re-links (or un-links) their auth account;
-- the existing auth.users triggers cover the other direction (account
-- created after the row).
-- ============================================================

create or replace function public.sync_player_auth_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select id into new.auth_user_id
  from auth.users
  where lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists sync_player_auth_link on players;
create trigger sync_player_auth_link
  before insert or update of email on players
  for each row execute procedure public.sync_player_auth_link();

-- Re-fire once for existing rows so every player links to whatever auth
-- account currently matches their email (and nothing else).
update players set email = email;

-- ============================================================
-- History: losing rosters (derived from the appearance sheet's L column)
-- ============================================================

alter table event_results add column if not exists losing_roster text;

update event_results set losing_roster = 'Kyle, Boynton, Dave, Brendan, SammyT, Shoops, Holt, Zach' where year = 2025;
update event_results set losing_roster = 'Kyle, Joey, Stribos, Ross, Lars, Dave, Brendan' where year = 2024;
update event_results set losing_roster = 'Moore, Leamer, Lars, Dave, JoeG, Derm Dave' where year = 2023;
update event_results set losing_roster = 'Moore, Stribos, Kaplan, Ross, Dave, Jason, Brendan, Greg Stribos' where year = 2022;
update event_results set losing_roster = 'Kyle, Stribos, Ryan, Leamer, Ross, Dave, Jason, Charlie' where year = 2021;
update event_results set losing_roster = 'Moore, Kyle, JC, Lars, JoeG' where year = 2020;
update event_results set losing_roster = 'Moore, Kyle, JC, Ryan, Kaplan, Ross, Jason, Hugh, Cole' where year = 2019;
update event_results set losing_roster = 'Kyle, Ross, Dave, Jason, JoeG, Will G' where year = 2018;
update event_results set losing_roster = 'Joey, Ryan, Leamer, AJ, Brendan, Allen' where year = 2017;
update event_results set losing_roster = 'Ryan, Kaplan, Leamer, Ross, AJ, Dave, Connor, Hugh' where year = 2016;
update event_results set losing_roster = 'Stribos, Kaplan, Leamer, Ross, Hugh, Charlie, Shoops, Cole' where year = 2015;
update event_results set losing_roster = 'Moore, Kyle, JC, AJ, Lars, Jason' where year = 2014;

-- ============================================================
-- Player photos: public avatars bucket, admin-managed
-- ============================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "admins manage avatars" on storage.objects;
create policy "admins manage avatars" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and exists (
    select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')))
  with check (bucket_id = 'avatars' and exists (
    select 1 from players p where p.auth_user_id = auth.uid() and p.role in ('admin','assistant')));

-- ============================================================
-- Captains can edit matchups in events they captain.
-- (Side-level restriction — only their team's slots — is enforced by the
-- app's server actions; this row-level policy scopes them to their event.)
-- ============================================================

drop policy if exists "captains can update event matchups" on matchups;
create policy "captains can update event matchups" on matchups
  for update to authenticated
  using (exists (
    select 1 from rounds r
    join event_participants ep on ep.event_id = r.event_id and ep.is_captain
    join players p on p.id = ep.player_id
    where r.id = matchups.round_id and p.auth_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from rounds r
    join event_participants ep on ep.event_id = r.event_id and ep.is_captain
    join players p on p.id = ep.player_id
    where r.id = matchups.round_id and p.auth_user_id = auth.uid()
  ));

-- ============================================================
-- Cleanup: merge resurrected placeholder duplicates.
-- Earlier seed runs re-created placeholder rows after emails were edited
-- to real addresses. For every @wooglin.local row whose nickname also has
-- a real-email row, move its links to the real row and delete it.
-- Idempotent: no duplicates -> no-op.
-- ============================================================

do $$
declare d record;
begin
  for d in
    select ph.id as dupe_id, keep.id as keep_id
    from players ph
    join players keep
      on keep.nickname = ph.nickname
     and keep.id <> ph.id
     and keep.email not like '%@wooglin.local'
    where ph.email like '%@wooglin.local'
  loop
    -- Re-point event participation unless the keeper is already in that event
    update event_participants ep
    set player_id = d.keep_id
    where ep.player_id = d.dupe_id
      and not exists (
        select 1 from event_participants e2
        where e2.event_id = ep.event_id and e2.player_id = d.keep_id
      );

    -- Any leftovers would duplicate the keeper's participation — drop them
    delete from event_participants where player_id = d.dupe_id;

    -- Appearances/handicaps on the dupe are redundant copies; the FK
    -- cascade removes them with the player row.
    delete from players where id = d.dupe_id;
  end loop;
end $$;

-- ============================================================
-- Clubhouse feed: event log for the Home page live feed
-- ============================================================

create table if not exists feed_events (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  matchup_id  uuid references matchups(id) on delete cascade,
  kind        text not null check (kind in ('hole','match_final','standings','lineup')),
  hole_number integer not null default 0,   -- 0 for non-hole kinds
  message     text not null,
  created_at  timestamptz not null default now(),
  unique (matchup_id, kind, hole_number)
);

create index if not exists feed_events_event_created_idx on feed_events(event_id, created_at desc);

alter table feed_events enable row level security;
drop policy if exists "authenticated users can read feed" on feed_events;
drop policy if exists "authenticated users can write feed" on feed_events;
create policy "authenticated users can read feed"
  on feed_events for select to authenticated using (true);
-- Writes come from scoring/lineup server actions running as whoever acted
-- (players, captains, admins). Loose by design for a friends app.
create policy "authenticated users can write feed"
  on feed_events for all to authenticated using (true) with check (true);

-- Realtime so the Home feed updates without refresh
do $$
begin
  alter publication supabase_realtime add table feed_events;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- Betting fund: year-scoped side bets + ledger
-- ============================================================

create table if not exists bets (
  id          uuid primary key default gen_random_uuid(),
  year        integer not null,
  bet_type    text not null check (bet_type in ('h2h','teams','group')),
  amount      numeric(8,2) not null check (amount > 0),
  description text,
  -- pending: awaiting acceptance · active: on · closed: winner set
  -- push: tie, everyone zero · void: declined/cancelled
  status      text not null default 'pending'
              check (status in ('pending','active','closed','push','void')),
  created_by  uuid references players(id) on delete set null,
  accepted_by uuid references players(id) on delete set null,
  closed_by   uuid references players(id) on delete set null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);

create table if not exists bet_participants (
  id        uuid primary key default gen_random_uuid(),
  bet_id    uuid not null references bets(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  side      integer check (side in (1, 2)),  -- null for group bets
  is_winner boolean,                          -- set at close
  unique (bet_id, player_id)
);

create index if not exists bets_year_idx on bets(year, created_at desc);
create index if not exists bet_participants_bet_idx on bet_participants(bet_id);
create index if not exists bet_participants_player_idx on bet_participants(player_id);

alter table bets enable row level security;
alter table bet_participants enable row level security;
drop policy if exists "authenticated users can read bets" on bets;
drop policy if exists "authenticated users can write bets" on bets;
drop policy if exists "authenticated users can read bet_participants" on bet_participants;
drop policy if exists "authenticated users can write bet_participants" on bet_participants;
create policy "authenticated users can read bets"
  on bets for select to authenticated using (true);
-- Any member creates/accepts/closes; state transitions are enforced by the
-- app's server actions (friends-app trust model, admins arbitrate).
create policy "authenticated users can write bets"
  on bets for all to authenticated using (true) with check (true);
create policy "authenticated users can read bet_participants"
  on bet_participants for select to authenticated using (true);
create policy "authenticated users can write bet_participants"
  on bet_participants for all to authenticated using (true) with check (true);

-- Feed: allow 'bet' entries
alter table feed_events drop constraint if exists feed_events_kind_check;
alter table feed_events add constraint feed_events_kind_check
  check (kind in ('hole','match_final','standings','lineup','bet'));
