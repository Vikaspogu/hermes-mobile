# Hermes Mobile UI/UX Redesign — Handoff & Status

Date: 2026-10-19 | Branch: main @ c8fea86 | Status: **deployed and verified** — definition of done met except the final user visual pass after the PR #7 rollout.

## The agreed target

Mockup gallery (14 mobile frames M1–M14 @ 390×844, 4 desktop frames W1–W4 @ 1280×800):
https://ws-acac5578e380aa52.a113.casa/artifacts/git-repos/hermes-mobile/hermes-mobile-redesign-mockups.html

Source: `docs/mockups/redesign-mockups.html` in this repo (search for `M1 ·`, `W1 ·` frame labels).
Basis: full UI/UX review — Playwright screenshots of every screen at mobile resolution + 3 independent sub-agent reviews. Converging findings: native app-like IA (4-tab shell: Chats / Inbox / Work / More), threads-first home, quiet headers, restrained blue, approval cards as first-class UI, dark theme parity.

## What was shipped (all merged to main)

| PR  | Commit   | Scope                                                                                                                                                              |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #2  | (squash) | S1–S8: Chats thread home, 4-tab AppShell rewrite, kanban stage pills, More hub + all secondary screens restyled, voice overlay, offline card, desktop 3-pane shell |
| #3  | 7343977  | Polish: unified approval cards, tab nav, quiet headers, dark-mode fixes, desktop chat sidebar variant                                                              |
| #4  | d9ce4f5  | Screen-by-screen parity pass M1–M14 + W1 (details below)                                                                                                           |
| #5  | 1e3b74c  | plugin_api.py mount fix (diagnostics 404 root cause)                                                                                                               |
| #6  | 6cf0474  | diagnostics 422 fix (`request: Request` annotation) + mount regression test                                                                                         |
| #7  | c8fea86  | chats preview text, Artifacts 404 note, More sheet gateway health summary (from production mockup verification)                                                      |

## Page-by-page: what changed vs mockup

- **Chats home (M1):** thread list with LIVE/TODAY/EARLIER date groups, last-message preview text (`previewText`), approval-waiting banner, composer with mic button, search. Threads-first replaced old sessions list.
- **Chat (M2/W1):** plan text before approval card, collapsed tool-step summary line, approval card above composer with risk tier + session context, send→stop morph. Desktop: 3-pane (64px rail + thread list + conversation capped 760px centered — fixed a CSS specificity war with `html.hm-native-viewport-lock` that silently killed the cap), back chevron removed on desktop.
- **Inbox (M3/M4/W2):** approval queue cards with risk tiers, session context line, fixed store bug where a second approval was dropped by the 5s realtime-grace merge. Deferred: slide-to-approve for high risk, desktop master-detail layout.
- **Work/kanban (M5/W3):** title "Kanban"→"Work", stage filter pills, quiet "+ New" button (fixed undefined `--hm-color-tint` var — buttons rendered with no background), board horizontal on desktop.
- **Schedules (M6):** human-readable schedules ("Daily at 03:00"), enable toggles, SCHEDULED/PAUSED chips, ghost profile badge.
- **Profiles (M10):** cards → 2-line rows (avatar, name + ACTIVE badge, chevron), action sheet.
- **Agents (M11):** ACTIVE/RECENT sections. Deviation: section headers instead of mockup's segment control.
- **Artifacts (M12):** file rows with mime type. Deviation: no size/session (gateway doesn't expose them).
- **System (M13/W4):** loud blue "Gateway running" hero removed → neutral summary row; CPU/RAM/Disk as sans numbers + 4px progress bars (hm-meter); Manage gateway sheet.
- **Settings (M14):** kept as functional superset (Install app, Chat behavior sections don't exist in mockup — mockup drawn before full inventory). Deviation documented.
- **More hub (M7):** list rows (Profiles, Agents, Sessions, Schedules, Artifacts, System, Settings), version footer in sheet.
- **Voice (M8):** full-screen overlay from composer mic (not a nav destination), orb + status, close ×.
- **Offline (M9):** error card with gateway URL, Retry + Change URL, tab bar stays accessible.
- **Dark theme:** approval command chip and New-profile button hardcoded-light bugs fixed; every screen captured and compared in both themes.

## Verification done

- Every screen screenshotted at 390×844 and 1280×800, light + dark, compared against its mockup frame (preview data mode: `http://127.0.0.1:3010/?preview`).
- `npm run typecheck && npm run lint && npm test` — 634 tests green at every merge.
- `dashboard/dist` regenerated and committed with each PR.

## What was broken (all resolved — see the PR #6 / PR #7 sections below)

### Resolved 2026-10-19 (PR #6, deployed as pod ref 6cf0474)

- **"Diagnostics failed" root cause:** exact status was **HTTP 422** (`{"loc":["query","request"],"msg":"Field required"}`). `_require_dashboard_auth(request)` in `push_common.py` had no type annotation, so FastAPI read `request` as a required query param and every protected plugin route 422'd. Fixed by annotating `request: Request` + mount regression test (`dashboard/tests/test_plugin_api_mount.py`). Verified in pod: `POST /auth/password-login` (provider `basic`) → session cookie → `GET /api/plugins/hermes-pwa/diagnostics` = **200** with real data.
- **Gateway 8642 404 on `/api/profiles/active`:** NOT A BUG. `/api/profiles/active` is a **dashboard** route (9119, returns 200 `{active, current}`); port 8642 is the gateway's JSON-RPC/WS interface and 404s all REST paths by design. Diagnostics does not proxy to the gateway.
- **Plugin install path:** IS `/opt/data/plugins/hermes-pwa` (the earlier grep that said otherwise was wrong).

### Resolved 2026-10-19 (PR #7, deployed as pod ref c8fea86)

- **Deployed UI vs mockups:** verified against 10 real-device screenshots — layout and styling match the M1–M14 targets. Three deviations found and fixed in PR #7:
  - **F6:** Chats rows showed `TUI · N msgs` instead of the last-message preview — `toSession` now maps the dashboard's `preview` field.
  - **F7:** Artifacts screen showed raw JSON on backends without `/api/sessions/<id>/artifacts` (0.22.2) — a 404 now shows a friendly "needs a newer Hermes backend" note.
  - **F8:** More sheet gained the M7 gateway health summary (running state, uptime, CPU/RAM/Disk), lazy-loaded via `systemStats` on sheet open. Shared `fmtUptime`/`fmtGb`/`fmtPercent` moved to `packages/web/src/lib/formatStats.ts`.
- **Settings/Inbox 422 banners in the screenshots:** stale client-side errors from before the PR #6 deploy — the server cannot produce them anymore; cleared by reloading the PWA.
- **Verified in pod after rollout:** plugin at `c8fea864`, bundle `index-tIwaAdmm.js`, diagnostics route returns 401 unauthenticated (not 422).

## Definition of done (the bar, and where it stands)

- [x] Every screen restyled per mockup, mobile + desktop, light + dark — locally screenshot-verified
- [x] Gates green (typecheck/lint/634 tests) on every PR
- [x] Deployed app visually matches mockups on real devices — verified via 10 screenshots (PR #7 fixed the 3 deviations found)
- [x] Diagnostics tab renders checks instead of an error — API 200 in pod (PR #6); 401-unauth sanity re-verified after the PR #7 rollout
- [x] Production pod verified serving the merged plugin (ref c8fea86, bundle `index-tIwaAdmm.js`)
- [ ] Final user visual pass after the PR #7 deploy: reload the PWA and confirm no 422 banners, chats preview text, More health summary, diagnostics checks

## Next steps (ordered)

All previous next steps are done (see Resolved sections). Remaining: user reloads the PWA and confirms the final visual pass (checklist above).

## Operational notes

- Pod access: `POD=$(kubectl -n ai get pods -o name | grep hermes-agent | head -1 | cut -d/ -f2)`, then `kubectl -n ai exec $POD -c app -- sh -c '...'`.
- Dashboard basic auth env in pod: `$HERMES_DASHBOARD_BASIC_AUTH_USERNAME/PASSWORD` (secret hermes-agent-secret) — but plugin routes want a session cookie (`401 no_cookie` on basic-auth loopback).
- Deploy flow: merge PR → bump `components/ai/hermes-agent/values.yaml` --ref sha in home-ops → push → rollout.
- Never commit `.playwright-cli` (gitignored).
- Debugging handoff with full probe history: `.pi/handoffs/HANDOFF_diagnostics-still-failing_10_19_19_10.md`.
