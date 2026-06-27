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
  team_id       uuid references teams(id) on delete set null,
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
  ('Alex Moore',         'Alex',    'alex@wooglin.local',                13.2, 'player'),
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
  ('Zach Williams',      'Zach',    'zach@wooglin.local',                null, 'player')
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
    'ryan@wooglin.local','alex@wooglin.local','joeg@wooglin.local',
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
