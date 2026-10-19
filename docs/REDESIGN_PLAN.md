# Hermes Mobile — UX Redesign Implementation Plan

Branch: `feat/mobile-ux-redesign`. Approved mockups: `.pi/artifacts/hermes-mobile-redesign-mockups.html`
(frames M1–M14 mobile, W1–W5 desktop) in the main checkout; decisions D1–D16 from three independent
UX reviews. This is a **restyle/restructure of existing screens** — no new backend features, no new
dependencies, existing `tokens.css` variables only, core/shell boundary stays intact
(`packages/core` free of React/DOM; components never call fetch/WebSocket directly).


## Status — 2026-10-19: ALL 8 SLICES IMPLEMENTED on branch feat/mobile-ux-redesign

| Slice | Commit |
|---|---|
| S1 nav shell + Chats home | 1f0d2a2 |
| S2 chat approvals (risk tiers, session context) + S3 Inbox + S5 More hub | ff85811 (folded together) |
| S4 Work: kanban pills + Schedules | 5528f99 |
| S6 voice overlay | d889637 |
| S7 offline state | 8f5146d |
| S8 desktop rail + split + caps | 905fa5b |

Deviation from mockups: the sticky approval dock above the composer (M3)
was skipped — the inline approval card renders directly under the tool
call and the view auto-scrolls to new pending approvals, so a duplicate
dock added no signal. All gates green: typecheck, lint, 628 tests, build.

## Current state (verified in code)

- Routes (all under `AppShell`): `/` Home, `/chat`, `/approvals`, `/sessions`, `/kanban`, `/cron`,
  `/voice`, `/profiles`, `/agents`, `/system`, `/artifacts`, `/settings`. `AppPreview.tsx` seeds
  preview data via `?preview`.
- `AppShell.tsx`: `data-testid="app-header"` + drawer (`nav.hm-drawer__panel`), unread chat dot,
  active-agents / system-health chips, approval banner, update pips. `scrollToPath()` forces
  `.hm-shell-main` scrollTop on every nav (this is why chat top-messages are unreachable) —
  **remove it in S2**, chat already pins to bottom via `useAutoScroll`.
- `Home.tsx`: hero + `homeTileDefs` (12 tiles) + recent chats. `Sessions.tsx`: monitor list.
- Screenshot harness: `scripts/capture-screens.mjs` (playwright, 390×844, navigates via drawer).

## Gate per slice (all must pass before commit)

```
npm run typecheck && npm run lint && npm test
npm run build            # when packages/web changed → commit regenerated dashboard/dist too
```

Visual check: dev server + `?preview` at 390×844 against the matching mockup frame
(`scripts/capture-screens.mjs` updated per slice as nav changes). One commit per slice, no push.

---

## S1 — Navigation shell + Chats home (D1, D2, D5) — frames M1, M13

Scope: replace drawer with fixed bottom tab bar; chats list becomes `/`.

- `packages/web/src/styles/prototype.css`: add `.hm-tabbar` (4 tabs: Chats, Inbox, Work, More;
  56px + `env(safe-area-inset-bottom)`; badge slot; active = primary icon+label, inactive = faint),
  `.hm-tabbar__badge`, `.hm-sheet` bottom-sheet primitive (for "More" hub + reuse in S4/S5),
  thread-row styles (`.hm-thread-row`, `.hm-thread-row__preview`, `.hm-thread-row__meta`,
  `.hm-date-group`, `.hm-live-dot`).
- `packages/web/src/app/AppShell.tsx`: delete drawer markup + open/close state + `hm-drawer__*`
  usage; render `TabBar` on mobile; header keeps screen title only; move active-agents/health
  chips out of the header (System screen owns health; agents chip moves into More hub).
  Keep approval banner (S2 replaces it in-chat; S3 keeps it only as Inbox badge driver).
- `packages/web/src/app/navigation.ts`: regroup — primary: chats (`/`), inbox (`/approvals`),
  work (`/kanban`), more; secondary destinations stay routable (profiles/agents/system/artifacts/
  settings/cron/sessions/voice) via More hub sheet until S5.
- New `packages/web/src/screens/Chats.tsx` (replaces Home as `/`): new-chat composer row at top,
  thread list grouped **Live / Today / Earlier** (createdAt buckets), each row: title (session
  title or first prompt), 1-line last-message preview from messagesStore, relative time, live dot
  when session is streaming, unread bolding via existing `unreadCount`. Reuse sessionsStore +
  messagesStore; no new fetch logic.
- Delete `Home.tsx` + `homeTileDefs`; redirect old deep links. Keep `Sessions.tsx` reachable from
  More hub (it becomes the archive/monitor view).
- Tests: update `AppShell.test.tsx`, `Home*.test.tsx` → `Chats.test.tsx` (grouping, preview line,
  unread). Update `scripts/capture-screens.mjs` to navigate by URL (`page.goto('/chat?preview')`
  style) since the drawer is gone.

## S2 — Chat: approval dock + plan-first + collapsed steps (D3, D4) — frames M2, M3, W1

- `AppShell.tsx`: remove `scrollToPath()` scroll-forcing (fixes top-message reachability).
- `packages/web/src/components/chat/*`: tool/action steps collapse to a single summary line
  ("3 steps · Read 2 files, ran pytest ✓") expandable inline; plan text renders before the
  approval card.
- New `ApprovalDock` component (sticky above composer): session title + cwd context, risk tier
  chip (low/medium/high from existing action classification), command in `--hm-font-mono`,
  Reject (outlined) / Approve (filled); high risk → slide-to-confirm track (no new dep: pointer
  events on a track div). Exceeds 2 actions → "Review all N" routes to `/approvals`.
- Composer: send becomes stop while streaming (existing stream state), mic affordance placeholder
  (wired in S6).
- Styles in `prototype.css`: `.hm-approval-dock`, `.hm-steps-collapsed`, `.hm-slide-confirm`.
- Tests: dock renders pending action w/ context; approve/reject call existing store actions;
  high-risk requires slide; steps collapse/expand.

## S3 — Inbox screen (D3) — frame M4

- Rework `screens/Approvals.tsx` → Inbox: cross-session pending approvals as cards with session
  context (title, cwd, age), risk chip, approve/deny inline; high risk → slide-to-approve;
  "Notices" section below (failed runs, offline events) from existing activity/notifications data.
- Badge count on Inbox tab = pending approvals + unread notices.
- Tests: card context rendering, actions dispatch, notices section.

## S4 — Work tab: Tasks + Schedules (D6, D7) — frames M5, M6, W3

- `screens/Kanban.tsx`: stages with 0 tasks collapse into a horizontal filter-pill row
  ("In progress 2 · Blocked 1 · Done 2 · All"); pills filter the visible columns; non-empty
  stages keep columns. Mobile: single-column list grouped by stage (mockup M5), columns return
  ≥768px.
- `screens/Cron.tsx` → "Schedules" (route stays `/cron`, label changes): human schedule line
  ("Daily at 3:00 AM", existing cron → words helper or tiny formatter), next run, last status
  dot, enable toggle inline; row tap → action sheet (Run now / Edit / Delete) using `.hm-sheet`.
- Segment control "Tasks | Schedules" at top of Work tab linking the two screens.
- Tests: pill filtering, empty-stage collapse, schedule toggle + action sheet.

## S5 — More hub + secondary screens (D13–D16) — frames M7, M10–M12, M14

- More hub (sheet or `/more` screen): rows for Profiles (current profile + model subline),
  Agents (active count), System (health dot), Artifacts, Sessions archive, Cron→Schedules,
  Settings; version footer; Log out lives here only.
- `screens/Profiles.tsx`: 2-line cards (name + model/default badge), hide defaults until edit.
- `screens/Agents.tsx`: segmented Active | Recent (recent from existing ended-runs data).
- `screens/Artifacts.tsx`: rows get type icon + size + source session.
- `screens/System.tsx`: metric bars replace serif numbers; Restart/Stop demoted to a
  "Danger zone" section with confirm sheet.
- `screens/Settings.tsx`: grouped list (Connection / Appearance / Notifications / About);
  Model row deep-links to `/profiles`.
- Tests: per-screen render + navigation from hub.

## S6 — Voice as composer-launched mode (D8) — frame M8

- Remove `/voice` from nav; composer mic button (S2 placeholder) opens full-screen voice overlay
  bound to the current chat session: orb + live transcript + mute/end bar (existing voice engine,
  `screens/Voice.tsx` internals reused as overlay, route removed).
- Tests: overlay open/close, session binding.

## S7 — Offline / error state (D10) — frame M9

- Connection-lost screen keeps the tab bar; card shows gateway URL, failure reason from the
  transport error, Retry (reconnect) + "Change gateway URL" → `/settings`. Banner variant on
  transient reconnect.
- Tests: renders cause + URL; retry triggers reconnect; nav still works.

## S8 — Desktop ≥1200px (D9) — frames W1–W5

- `AppShell.tsx` + `prototype.css`: ≥1200px → 64px icon rail (same 4 destinations) + context
  column. Chat route: 296px thread list + chat column capped at 720px, approval dock right-aligned
  with ⌘↵/Esc hints. Inbox: 360px queue + detail pane. Work: horizontal kanban + collapsed
  empty-stage rails. System/Settings: content capped (840px / 720px). No JS layout forks —
  CSS grid + container queries where possible; thread-list pane reuses S1 `Chats` list component.
- Visual check at 1280×800 against W-frames.

---

## Explicitly out of scope

New backend endpoints, protocol changes, new dependencies, dark-mode redesign (tokens already
support both; mockups are light), tablet-specific layouts beyond the ≥768px column behavior.
