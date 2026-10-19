# HANDOFF — hermes-pwa redesign screen-parity pass

**Read this first if you are a fresh session continuing this work.** Delete this file when the parity pass ships.

## Where things stand (2025-10-19)

- Repo: `/home/agent/git-repos/hermes-mobile` (main checkout, branch `main`, clean tree).
- **PR #2 (redesign) and PR #3 (polish + S9 desktop/dark parity) are MERGED and deployed.** home-ops pin: `components/ai/hermes-agent/values.yaml` `--ref 7343977e56d05f86e2c8fc710649864349ded449`.
- Deployment verified: new pod rolled out. If the user "can't see changes", it's the PWA service worker: DevTools → Application → Service Workers → Unregister → reload. Not a deploy bug.
- Mockups (the grading target): `.pi/artifacts/hermes-mobile-redesign-mockups.html` — frames M1–M14 (mobile 390), W1–W5 (desktop 1280). Open it in a browser; every frame has a caption listing what changed.
- **Acceptance criteria: `docs/REDESIGN_ACCEPTANCE.md`** — per-screen checklists. Grading rule: local capture must match the mockup frame with zero discrepancies at 390×844 AND 1280×800, light AND dark.
- **Todo list:** one task per screen (13) + final ship task. Work them in order; do not start the next until the current screen matches.

## The workflow per screen

1. `npm run dev` → `http://127.0.0.1:3010/?preview` (preview data, no gateway needed).
2. Capture all 4 variants: `node scripts/capture-screens.mjs` (mobile light), `CAPTURE_DARK=1 CAPTURE_PREFIX=d node scripts/capture-screens.mjs` (mobile dark), `CAPTURE_WIDTH=1280 CAPTURE_HEIGHT=800 CAPTURE_PREFIX=w node scripts/capture-screens.mjs` (desktop light), plus desktop dark if touching desktop layout. Screenshots land in repo root as `{m,d,w}-{screen}.png`.
3. Read the screenshot AND the mockup frame side by side. Fix discrepancies in `packages/web/src/screens/*.tsx` + `packages/web/src/styles/prototype.css` (tokens in `tokens.css`).
4. Re-capture, compare again. Only check off when it matches.
5. Gates before any commit: `npm run typecheck && npm run lint && npm test`. Run `npm run build` and commit regenerated `dashboard/dist` in the same commit when `packages/web` changed (AGENTS.md rule).

## Known gaps to fix (already in acceptance doc)

- **G1** Chats thread rows need message preview text (currently "CLI · 42 msgs"). Find last-message data in the chat/session stores (`packages/core`); if none exists, derive from session last activity — keep it cheap.
- **G2** Chats home composer needs a mic icon (opens voice overlay like chat composer does).
- **G3** Schedules: "+ New" is loud solid blue → quiet tinted like kanban's `hm-projects__new-task`; profile filter dropdown restyle.
- **G4** System: remove blue "Gateway running" hero card → neutral summary row; "New backup" not solid blue.
- **G7** Inbox approval cards: session context line where data exists.

## Deferred by explicit user decision (do NOT build, do NOT grade against)

- Slide-to-approve for high-risk (M3/M4 gesture)
- Sticky approval dock above composer
- Desktop Inbox master-detail (W2 detail pane)
- Plan-text-before-approval ordering in preview data (real flow already correct)

## Hard-won lessons (don't repeat these mistakes)

- **Verify with computed styles, not commit messages.** The kanban board bug: a CSS block was appended but never committed, then committed without `flex-direction: row` (base rule sets column). Three rounds wasted. After every CSS change, probe `getComputedStyle` in a Playwright session AND screenshot in the same session.
- `capture-screens.mjs` has env flags `CAPTURE_WIDTH/HEIGHT/PREFIX/DARK` (added in S9). The chat shot uses `${prefix}-chat.png`.
- Bash cwd resets to `/home/agent/git-repos/hermes-mobile` between commands — use absolute paths.
- The core/shell boundary is ESLint-enforced: no fetch/WebSocket in components, no DOM in `packages/core`.
- Dark theme: tokens already handle it; verify, don't restyle.
- Commit style: conventional commits + DCO sign-off `Signed-off-by: Hermes PWA Contributors <nobody@localhost>`. Never push without the user asking; when they do, PRs go to `Vikaspogu/hermes-mobile`, deploy = home-ops pin bump (user approves each).

## When all 13 screens pass

Run full gates + build, commit `dashboard/dist`, open one PR ("redesign parity pass"), tell the user to unregister the service worker and test. Then bump the home-ops pin when they say go.
