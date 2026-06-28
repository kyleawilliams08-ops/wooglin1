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
  year        integer unique not null,
  name        text not null,
  location    text,
  start_date  date,
  end_date    date,
  status      event_status not null default 'draft',
  created_at  timestamptz not null default now()
);

alter table events enable row level security;

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
insert into players (name, nickname, email, current_index, role) values
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
on conflict (email) do update set
  name          = excluded.name,
  nickname      = excluded.nickname,
  current_index = excluded.current_index,
  role          = excluded.role;

-- 2025 Event
insert into events (year, name, location, start_date, end_date, status)
values (2025, '12th Annual Wooglin Cup', 'Pinehurst, NC', '2025-09-18', '2025-09-20', 'complete')
on conflict (year) do update set
  name       = excluded.name,
  location   = excluded.location,
  start_date = excluded.start_date,
  end_date   = excluded.end_date,
  status     = excluded.status;

-- Teams (delete + re-insert scoped to 2025 event for idempotency)
do $$
declare
  v_event_id uuid;
  v_usa_id   uuid;
  v_eur_id   uuid;
begin
  select id into v_event_id from events where year = 2025;

  -- Remove existing teams for this event (cascades to participants)
  delete from teams where event_id = v_event_id;

  insert into teams (event_id, name, color) values (v_event_id, 'USA',    '#BE2F27') returning id into v_usa_id;
  insert into teams (event_id, name, color) values (v_event_id, 'Europe', '#185D3B') returning id into v_eur_id;

  -- USA roster
  insert into event_participants (event_id, player_id, team_id, display_name, is_captain)
  select v_event_id, p.id, v_usa_id, p.nickname, (p.nickname = 'Ryan')
  from players p where p.email in (
    'ryan@wooglin.local','joeg@wooglin.local',
    'joey@wooglin.local','lars@wooglin.local','ross@wooglin.local',
    'allred@wooglin.local','stribos@wooglin.local'
  );

  -- Europe roster
  insert into event_participants (event_id, player_id, team_id, display_name, is_captain)
  select v_event_id, p.id, v_eur_id, p.nickname, (p.nickname = 'Brendan')
  from players p where p.email in (
    'brendan@wooglin.local','dave@wooglin.local','holt@wooglin.local',
    'shoops@wooglin.local','kyle@fairwayfinancialpartners.com',
    'boynton@wooglin.local','sammyt@wooglin.local','zach@wooglin.local'
  );
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
  select id into v_event_id from events where year = 2025;
  if v_event_id is not null then
    delete from event_participants where event_id = v_event_id;
    delete from teams where event_id = v_event_id;
  end if;
end $$;
