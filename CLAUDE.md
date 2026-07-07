# CLAUDE.md

Guidance for Claude Code sessions in this repo. **V1 is complete and live** — this file reflects the app as built (updated 2026-07-05), not the original plan.

## Project

Wooglin Cup Clubhouse — private PWA for an annual Ryder-Cup-style golf trip (~16–25 friends, USA vs Europe, running since 2014). Not commercial. Priorities: **simplicity, ease of use, maintainability**. Fun, golf-centric branding; the dragon crest (`public/crest.png`) is the identity.

## Stack

- **Next.js 14.2.35** (App Router, TypeScript) — stay on 14.x
- **Supabase**: Postgres + Auth + Realtime + RLS (env in `.env.local`)
- **Tailwind** tokens: `navy #0C2D55`, `usa-red #BE2F27`, `europe-green #185D3B`, `off-white`, `parchment`, `hairline`, `gold #C3A669` (trophy accent, use sparingly)
- Fonts: Playfair Display (`font-display`) + Lato (`font-body`) via next/font
- **Vercel** auto-deploys from `main` on push; PWA (manifest + icons, no service worker)

## Commands

```bash
npm run build        # production build — run before every commit
npm test             # vitest (handicap/matchplay/matchcalc suites)
npx tsc --noEmit     # typecheck
```

## Working agreement (IMPORTANT)

- **Commit AND push every change** — Kyle relies on Vercel auto-deploy to test. Small, well-messaged commits to `main`.
- **Kyle runs all SQL manually** in the Supabase SQL editor. Never assume a migration ran. All schema/seed lives in ONE idempotent file: `supabase/migrations.sql` — append new sections at the bottom and tell Kyle exactly what to run.
- **Seeds must be keyed by NICKNAME, never email** — admins edit emails to real addresses; email-keyed upserts resurrect placeholder duplicates.
- **TEST DATA WARNING**: user-entered events ("Test1", "Test 2 - Pinehurst") and their matchups/scores/teams are throwaway — never infer real-world facts from them. Real truth: migrations seeds, `player_appearances` + `event_results` (verified backfill), and Kyle.
- Surface every DB write failure: capture `{ error }` and use `failTo()` (`src/lib/actionError.ts`) + `<ErrorBanner>`, or throw. No silent failures.
- Verified real facts: USA won 2025 at Pinehurst (Ryan © USA); all-time Europe 7 – USA 5.

## Auth (settled after much pain — do not regress)

- **Primary sign-in = emailed OTP code** typed into the login page (`verifyOtp`, type `"email"`). Magic links break on mobile (PKCE same-browser rule, iOS PWA storage isolation, email link scanners). Keep the code path first-class.
- SMTP = **Resend**, domain `fairwayfinancialpartners.org` (note `.org`). Custom SMTP is required for the email template (contains `{{ .Token }}`).
- After sign-in use `window.location.href = "/"` (hard nav) — `router.replace` hits the cached pre-login redirect.
- **`players.email` is the single source of login truth**: DB trigger `sync_player_auth_link` re-links `auth_user_id` whenever a player's email is edited (Admin → Player Roster). Seed rows use `@wooglin.local` placeholders until real emails are set.
- A `/` ↔ `/login` redirect loop means "authenticated but no players row" → login shows `?error=unlinked` message.

## Roles & permissions (3 layers: page gate → in-action re-check → RLS)

- **admin / assistant** (`players.role`): everything.
- **Captain = `event_participants.is_captain`** on the event (the `players.role` value 'captain' is informational only). Captains set their own team's lineups (inline pickers on `/matchups` + side-limited matchup edit page). Lineups lock once the match has any score ("underway") — admins can still override.
- **Players in a match** can score that match (architecture "scoring exception"). Everyone else views.
- All members see: Home, Live, Matchups, Player Cards, History, Courses, Menu.

## Data model (actual tables)

```
players(id, auth_user_id, name, nickname, email UNIQUE, avatar_url, current_index, role)
events(id, year, name, location, start/end_date, status[draft/active/complete])  -- year NOT unique
teams(id, event_id, name, color)
event_participants(id, event_id, player_id?, team_id, display_name, is_captain)
courses / course_tees(rating, slope, par) / holes(hole_number, par, stroke_index)
formats(name, hcp_allowance, hcp_allowance_secondary)  -- Best Ball 100, Shamble 70, Pinehurst 50, Scramble 35+15, Singles 100
rounds(id, event_id, round_number, name, side[front/back/full], played_at, course_tee_id, format_id, status)
matchups(id, round_id, match_number, home/away_p1/p2_id → event_participants, tee_time, status, result[home/away/halve], match_score)
hole_scores(matchup_id, hole_number, home_p1_gross, home_p2_gross, away_p1_gross, away_p2_gross)  -- GROSS per ball
participant_handicaps(event_id, player_id, course_tee_id, calculated_hcp, override_hcp)  -- integers
player_appearances(player_id, year, result[W/L/T])  -- 2014+ backfill, drives Appearances/Cup Record
event_results(year UNIQUE, event_id?, winner, final_score, location, captains, roster, losing_roster, notes)  -- history archive; event_id links real in-app events (the "real cup lineage")
```

"home" team = first team by name (Europe before USA). Storage bucket `avatars` (public) for player photos.

## Key modules

- `src/lib/handicap.ts` — pure engine + tests. Course hcp, playing hcp (9-hole halves CH first), `strokesGivenOnHole(phcp, si, holesInRound)` (9-hole wraps at 9!), `normalizeToLowest`, format helpers. **Plus handicaps stored negative, displayed "+2"** — `formatHcp` / `parseHcpInput` everywhere handicaps are shown/entered.
- `src/lib/matchcalc.ts` — per-matchup playing hcps by format + per-hole results (shared by scorecard, live board, hole-by-hole).
- `src/lib/matchplay.ts` — match-play outcome with proper closeout ("2&1", dormie, halved).
- `src/lib/scoring.ts` — `assertCanScore` (admin OR match participant), score upserts.
- `src/components/MatchScorecard.tsx` — full card (admin route + `/live/match/[id]?view=card`), Save & Review → complete flow (writes status/result/match_score).
- `src/components/HoleByHole.tsx` — default mobile scorer on `/live/match/[id]`: tap-to-score (instant save), auto-advance (2s), swipe between holes.
- `src/components/PlayerCard.tsx` — trading-card profile (photo/monogram, stats, career timeline chips, most-recent-cup team color via event_results linkage).
- `src/components/LiveRefresher.tsx` — Realtime → router.refresh (needs `hole_scores`/`matchups` in the realtime publication).
- `/print/match/[id]` — admin-only landscape paper-backup scorecard (browser print → PDF).

## Navigation

Bottom tabs: **Home · Matches · Bets · Menu** (Menu highlights for /players, /history, /courses, /admin). /matches merges the old Live scoreboard + Matchups pairing sheet (phase-aware cards: tee time → captain lineup pickers → live standing → final); /live and /matchups redirect there; match pages stay at /live/match/[id]. Menu = clubhouse pages for all + "Commissioner Tools" for admins. `/admin` redirects to `/menu`; admin tools keep `/admin/...` URLs. Day tabs on Live + Matchups group rounds by `rounds.played_at` (set dates on rounds!).

## Scoring model (differs from original plan)

Gross scores entered **per ball** per hole; net/hole results/match status computed live (never stored per hole). Completed matchups store `status/result/match_score` — the source of truth for points. Points: win 1 / halve ½; points-to-win = matches/2 + 0.5, always derived.

## V2 backlog (account for, don't build unasked)

Push notifications, live draft, GHIN sync, advanced stats/head-to-head, captain records, betting/expenses (CTP, low-net, parlay), photo galleries, player self-photo upload, test-data cleanup before the 13th Cup.
