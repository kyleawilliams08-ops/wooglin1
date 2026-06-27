# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Wooglin Cup Clubhouse — a private PWA for an annual Ryder-Cup-style golf trip (~16-25 friends). Not commercial. Priorities: **simplicity, ease of use, maintainability**. Avoid enterprise complexity.

## Stack

- **Next.js 14.2.35+** (App Router, TypeScript) — stay on 14.x, not 15
- **Supabase**: Postgres + Auth (magic link) + Realtime + RLS
- **Tailwind CSS** with custom design tokens (see Brand below)
- **Vercel** hosting, deploys from GitHub on push
- **PWA** — installable, basic offline shell

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build (run after every milestone)
npm run lint         # ESLint
npm test             # Jest unit tests
npm test -- --testPathPattern=handicap  # run a single test file
```

## Architecture

**Mutations**: Server Actions only — no separate API layer. Always re-check role server-side in every action.

**Auth**: Magic link via Supabase Auth. Link `auth.users` → `players` by email at login. Route protection via middleware.

**Permissions (RLS + server-side mirror)**:
- Any authenticated member: read all event data
- Admin/assistant: manage everything
- Captain: edit their team's lineup (matchup milestone only)
- Player in a match: enter/edit that match's hole results
- Enforce in Supabase RLS first; mirror in Server Actions

**Handicap engine**: Pure TypeScript module, zero DB calls. Unit-tested with packet fixtures. Snapshot `course_handicap` + `strokes_received` onto `match_players` at match creation time — later index edits must not rewrite history. Always allow manual strokes override.

**Realtime**: Supabase Realtime subscriptions on `match_holes` + `matches` for the live scoreboard.

## Data Model

```
players(id, auth_user_id, name, nickname, email, avatar_url, current_index, ghin_id, role, created_at)
events(id, year, name, location, start_date, end_date, status[draft/active/complete])
teams(id, event_id, name, color)
event_participants(id, event_id, player_id[nullable], team_id, display_name, is_captain, deposit_paid)
courses(id, name, location)
course_tees(id, course_id, tee_name, rating, slope, par)   -- 18-hole figures only
holes(id, course_tee_id, hole_number 1-18, par, stroke_index 1-18)
formats(id, name, team_size_a, team_size_b, hc_method, hc_pct, hc_low_pct, hc_high_pct)
rounds(id, event_id, round_number, day_label, course_tee_id, side[front/back/full], format_id, is_official, tee_time)
matches(id, round_id, team_a_id, team_b_id, status[scheduled/in_progress/final], result_text, points_a, points_b, tee_time, sort_order)
match_players(id, match_id, player_id, side[A/B], course_handicap, strokes_received)
match_holes(id, match_id, hole_number 1-9, winner[A/B/tie], edited_by, updated_at)
event_results(event_id, winning_team, final_score, notes)
```

`event_participants.player_id` is nullable + `display_name` is free text — supports history backfill without login accounts.

## Handicap Logic

- Course handicap (18) = `Index × (Slope ÷ 113) + (Rating − Par)`
- 9-hole CH = `round(CH18 ÷ 2)`
- Format-adjusted = `round(9-hole CH × format_pct)`
- **Play off the low** within the match group only. Low player plays scratch; others get the difference.
- `hc_method` enum: `individual_pct | team_low_high | team_pct | singles`
- Scramble/Pinehurst: collapse two partners into one team handicap, then play off low team
- Best Ball/Shamble/Singles: individual handicaps off low individual
- Stroke allocation: by `stroke_index` (SI 1 first, wrap past 9)

## Formats (stored as data, not code)

| Format | Size | Method | Pct |
|---|---|---|---|
| Best Ball | 2v2 | individual_pct | 100% |
| Shamble | 2v2 | individual_pct | 70% |
| Pinehurst | 2v2 | team_pct | 50% combined |
| Scramble | 2v2 | team_low_high | 35% low + 15% high |
| Singles | 1v1 | singles | 100% |

## Scoring

- Per hole: mark winner A / B / tie. No gross/net in V1.
- Each 9-hole match = 1 point (win=1, tie=0.5, loss=0)
- Points-to-win = `total_points/2 + 0.5` — always derived, never hardcoded
- Status display: "1 Up thru 4", "All Square thru 6", dormie, "wins 3 & 2"

## Brand / Design Tokens

Define in `tailwind.config`:
- `navy`: `#0C2D55` (primary chrome)
- `usa-red`: `#BE2F27`
- `europe-green`: `#185D3B`
- `off-white`: `#FDFDFD`, `parchment`: `#F4F1EA`, `hairline`: `#E4E0D6`

Fonts as CSS variables (`--font-display`, `--font-body`, `--font-mono`) so webfonts swap without touching components.

## Navigation (mobile-first)

Bottom tab bar: **Home · Live · Players · History · Admin** (Admin tab: admins only)  
Top header: crest, event name, member name + role, sign out

## Build Discipline

- One milestone at a time. Run `npm run build` after each. Commit per milestone.
- Deploy to Vercel after milestone 1 so each subsequent milestone is verifiable live.
- Keep presentation separate from logic. Full visual polish is milestone 12.
- Seed data must be idempotent.

## Milestones (V1)

1. Scaffold: Next.js + Tailwind + Supabase client + Vercel + PWA manifest
2. Auth + roles: magic link, player↔auth link by email, route protection, RLS
3. Events + participants: create event, roster, teams, captains, active event + **SEED**
4. Courses admin: course/tee/hole CRUD UI
5. Formats: seed/confirm 5 formats as data
6. Rounds: define rounds tied to course/tee/side/format
7. Handicap engine: pure module, off-low, strokes grid, unit tests
8. Matchups: create matches, assign sides, auto-fill handicaps + override
9. Match card + hole scoring: A/Tie/B per hole, status calc, dormie/final
10. Live scoreboard: Realtime, team totals, match status list
11. Profiles + history: player profile, backfill display
12. Polish: branding, splash, PWA install prompt
