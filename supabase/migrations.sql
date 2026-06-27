-- ============================================================
-- Wooglin Cup — Milestone 2: players table + RLS
-- Run this in Supabase SQL Editor (idempotent)
-- ============================================================

-- Role enum
do $$ begin
  create type player_role as enum ('admin', 'assistant', 'captain', 'player');
exception when duplicate_object then null;
end $$;

-- Players table
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

-- Indexes
create index if not exists players_auth_user_id_idx on players(auth_user_id);
create index if not exists players_email_idx on players(email);

-- Enable RLS
alter table players enable row level security;

-- Policies (drop first so re-running is safe)
drop policy if exists "authenticated users can read players" on players;
drop policy if exists "player can update own row" on players;
drop policy if exists "admins can insert players" on players;
drop policy if exists "admins can delete players" on players;

create policy "authenticated users can read players"
  on players for select
  to authenticated
  using (true);

create policy "player can update own row"
  on players for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy "admins can insert players"
  on players for insert
  to authenticated
  with check (
    exists (
      select 1 from players p
      where p.auth_user_id = auth.uid()
      and p.role in ('admin', 'assistant')
    )
  );

create policy "admins can delete players"
  on players for delete
  to authenticated
  using (
    exists (
      select 1 from players p
      where p.auth_user_id = auth.uid()
      and p.role in ('admin', 'assistant')
    )
  );

-- ============================================================
-- Auto-link auth user to player row by email on sign-in
-- ============================================================
create or replace function public.handle_auth_user_login()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update players
  set auth_user_id = new.id
  where email = new.email
    and auth_user_id is null;
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
  update players
  set auth_user_id = new.id
  where email = new.email
    and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute procedure public.handle_auth_user_updated();
