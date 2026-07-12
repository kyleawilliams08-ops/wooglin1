# CLAUDE.md

Guidance for Claude Code sessions in this repo. **V1 is complete and live** — this file reflects the app as built (updated 2026-07-06), not the original plan.

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
admin_alerts(id, title?, message, created_by) / alert_dismissals(alert_id, player_id PK pair)  -- full-screen notices; overlay shows until the player's dismissal row exists
drafts(id, event_id UNIQUE, status[scheduled/live/complete], scheduled_at, first_pick_team_id, pick_seconds, call_link, current_pick_started_at)  -- snake draft; pool = event's non-captain participants with team_id NULL
draft_picks(draft_id, pick_number, team_id, participant_id, picked_by)  -- unique (draft,pick_number)+(draft,participant); each pick writes event_participants.team_id, so draft completion = rosters set
lineup_drafts(id, round_id UNIQUE, status[scheduled/live/complete], first_pick_team_id, pick_seconds, current_pick_started_at)  -- optional per-round snake draft that fills a round's matchups
lineup_draft_picks(draft_id, pick_number, team_id, matchup_id, side[home/away], p1_id, p2_id?, picked_by)  -- each pick writes matchups.{side}_p1/p2, so completion = round lineups set
ctp_holes(id, round_id, hole_number, holder_participant_id?, holder_set_at, holder_set_by)  -- unique (round,hole); CTP holes; current holder only (king-of-the-hill claims)
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
- `src/lib/feed.ts` — clubhouse-feed writers (ALL best-effort: feed failure must never break scoring/bets). Hole events idempotent per (matchup, hole).
- `src/lib/bets.ts` — betting money math + tests. Per-person stakes: every loser pays the stake, pot splits among winners (covers 1v1/2v2/group). Only status 'closed' moves money.
- `src/components/LineupPicker.tsx` + `/matches/lineup/[id]?side=&day=` — full-page tappable avatar-grid lineup setting (captains own side; locked once underway; Singles max 1; threads ?day= back).
- `src/components/BetWizard.tsx` (/bets/new), `CardMenu` (ellipsis dropdowns), `FeedFilter` (?kinds= bottom sheet), `ConfirmForm` (confirm-before-submit).
- `src/components/AlertOverlay.tsx` + `src/lib/alertActions.ts` + `/admin/alerts` — admin alerts: full-screen takeover (mounted in the protected layout) until each player taps OK/✕; realtime-published so open sessions pop instantly; admins create/edit/delete from Menu → Admin Alerts ("seen by X of Y" counts).
- `src/lib/draft.ts` (pure snake order + soft clock, tested) + `src/lib/draftActions.ts` (makePick/undoLastPick: captain-of-on-clock-team or admin; unique pick_number settles races; pick rollback if roster write fails) + `/draft` (`DraftRoom.tsx`: scheduled/live/complete moods, realtime, pick-reveal animation, ?tv=1 chrome-free casting view). Draft **setup lives inside the event** (Draft section on `/admin/events/[id]`: create, schedule, first-pick toggle, soft pick clock, call link, start/reset/delete — one draft per event) — there is no standalone /admin/draft. Draft pops on Home while scheduled/live; feed kind 'draft' posts live/picks/complete/undo.
- **CTP** (Closest to the Pin): `src/lib/ctpActions.ts` (claimCtp — any event participant self-claims via `CtpClaimButton` on /matches, a hold-to-claim button [~1.2s press with progress bar; release/scroll cancels] so stray touches can't fire it; takeover replaces holder; claims lock once every match in the round is final, admins excepted) + CTP section on the round admin page (`/admin/events/[id]/rounds/[roundId]`: add/remove holes validated against the round's side, set/clear holder for rulings). Holder strip per CTP hole on /matches round cards (🏆 once round done); feed kind 'ctp' posts takeovers; `ctp_holes` realtime-published + in LiveRefresher.
- **Lineup Draft** (nightly pairing ceremony, reuses the snake engine): `src/lib/lineupDraftActions.ts` (makeLineupPick/undoLastLineupPick — captain of on-clock team or admin; snake fills each match's two sides in lead→answer order; a pick writes `matchups.{home|away}_p1/p2`, so completion sets the round's lineups) + `/matches/lineup-draft/[roundId]` (`LineupDraftRoom.tsx`, `?tv=1` casting view): on-clock lead/answer banner, soft clock, fly-to-corner board (grid), bench tracker, and a reveal state machine — "THE PICK IS IN" → staggered name-by-name → **fight card** on match completion (both sides in) showing the clash + strokes each ball gets (via `computePlayingHcps` from `matchcalc`, normalized to the low man; server-computed in the room page). Optional per-round; **started from the round's matchups admin page** (Lineup Draft panel: first-pick radios, Start clears the sides + drafts fresh, Reset/Delete). Home team = teams[0] by name; side size from `formats.team_size` (null=Singles). Live draft promoted on /matches; feed kind 'lineup' posts "🥊 Match N set …".

## Clubhouse feed

`feed_events` (event-scoped, realtime published): kinds hole / match_final / standings / lineup / bet, written by the existing server actions. Home shows latest 10 (+ filter funnel + "View full feed" → /feed, latest 100). Hole entries are write-once; finals/standings/lineups update in place. pg_cron job purges rows >30 days. Kyle's examples: "Kyle (USA) birdied #8 to square the match", "Team USA (Joey / Ross) def. Team Europe … 4&3", "USA now leads 9½ to 8½".

## Betting fund

Year-scoped side bets (NOT event-tied): `bets` + `bet_participants`. Lifecycle: propose via wizard (/bets/new, roster-limited, live IMMEDIATELY — no acceptance) → any participant closes with a ConfirmForm tap (side buttons / group winner / push) → losing side can PROTEST closed bets, any participant can protest a push (protested = frozen out of ledger, `protested_from` remembers restore target) → resolve: protester withdraws, winners concede (void), or admin dismisses/reopens. Creator/admin can cancel open bets. Ledger = everyone's net (tap through to /bets/player/[id] audit trail); "Needs your action" panel pins your open/protested bets; Home shows a Your-open-bets card + your net. Feed posts on propose/close/protest.

## Navigation

Bottom tabs: **Home · Matches · Bets · Menu** (Menu highlights for /players, /history, /courses, /admin). /matches merges the old Live scoreboard + Matchups pairing sheet (phase-aware cards: tee time → captain lineup pickers → live standing → final); /live and /matchups redirect there; match pages stay at /live/match/[id]. Menu = clubhouse pages for all + "Commissioner Tools" for admins. `/admin` redirects to `/menu`; admin tools keep `/admin/...` URLs. Day tabs on Live + Matchups group rounds by `rounds.played_at` (set dates on rounds!).

## Scoring model (differs from original plan)

Gross scores entered **per ball** per hole; net/hole results/match status computed live (never stored per hole). Completed matchups store `status/result/match_score` — the source of truth for points. Points: win 1 / halve ½; points-to-win = matches/2 + 0.5, always derived.

## V2 backlog (account for, don't build unasked)

Push notifications, live draft, GHIN sync, advanced stats/head-to-head, captain records, betting/expenses (CTP, low-net, parlay), photo galleries, player self-photo upload, test-data cleanup before the 13th Cup. Draft-room "view player card" modal (ⓘ on each pool tile → `PlayerCard`; deferred until the card holds more than the tile already shows — pairs with advanced stats; mind the tap-to-draft gesture conflict).
