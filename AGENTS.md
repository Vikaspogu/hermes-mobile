# AGENTS.md — Hermes Mobile (`hermes-pwa`)

> Onboarding for AI coding agents (and humans). **This file stays thin on purpose** — it points to the
> authoritative docs instead of duplicating them (duplication is what made the docs drift). Read this, then
> the linked file for details. If this file disagrees with the code, the code wins — fix this file.

## What this project is

An **independent, unofficial** mobile-first **PWA control plane** for the self-hosted Hermes Agent, shipped
as a Hermes Dashboard plugin named `hermes-pwa`. From a phone: chat (streaming), approve/reject high-impact
actions, watch activity, browse kanban, view agents/system, install to home screen.

**What it is NOT:**

- not the Hermes desktop app (that's a separate product — visual reference only, never copy its code);
- not a fork of Hermes core — a thin plugin/client;
- not a place for secrets, API keys, model credentials, or agent logic;
- not affiliated with or endorsed by Nous Research (see [`NOTICE`](./NOTICE)).

## Where to find what (authoritative docs)

| Topic                                                                         | Source of truth                                                                                                                                                            |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System map, structure, data flow, WS events, state machine, ADRs              | [`ARCHITECTURE.md`](./ARCHITECTURE.md)                                                                                                                                     |
| TS/React conventions, naming, transport rules, perf budget                    | [`CODING_RULES.md`](./CODING_RULES.md)                                                                                                                                     |
| Fork/branch/PR flow, commit + DCO sign-off, quality gates, CI/CD, merge rules | [`CONTRIBUTING.md`](./CONTRIBUTING.md)                                                                                                                                     |
| Design tokens, theming, components                                            | [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)                                                                                                                                   |
| Security model + known gaps                                                   | [`docs/SECURITY.md`](./docs/SECURITY.md)                                                                                                                                   |
| Install / network / rollback                                                  | [`docs/INSTALL.md`](./docs/INSTALL.md) · [`docs/NETWORK_TAILSCALE.md`](./docs/NETWORK_TAILSCALE.md) · [`docs/ROLLBACK_AND_REINSTALL.md`](./docs/ROLLBACK_AND_REINSTALL.md) |
| Positioning, licensing, clean-room rationale                                  | [`docs/THIRD_PARTY_CLIENT.md`](./docs/THIRD_PARTY_CLIENT.md)                                                                                                               |

## The three ground rules (non-negotiable)

1. **Clean-room.** Build only against Hermes's public HTTP/WS API. **Never copy** source from the Hermes
   desktop app (unlicensed) or any proprietary codebase. Protocol knowledge lives in
   `packages/core/src/transport/jsonrpc-contract.ts`, reconstructed — not pasted.
2. **Core/shell boundary.** `packages/core` imports **no** React/DOM/`window`/`document`/`navigator`/CSS and
   nothing from `packages/web`. Components never call `fetch`/`new WebSocket` — they go through `core` stores.
   Browser-only code lives under `packages/web/src/pwa/`. Enforced by ESLint `no-restricted-imports`.
3. **Security & privacy.** No secrets in client code. No persisting credentials/tickets. High-impact actions
   require explicit approval. Treat all server data as untrusted (no `dangerouslySetInnerHTML`/`eval`). See
   [`CODING_RULES.md`](./CODING_RULES.md) §8 and [`docs/SECURITY.md`](./docs/SECURITY.md).

## Commands you actually need

```bash
npm install
npm run dev                                  # Vite on :3010, proxies /api to HERMES_HOST (default 127.0.0.1:9119)
npm run typecheck && npm run lint && npm test # fast inner loop
```

Full pre-PR gate, CI pipeline, and release flow are in [`CONTRIBUTING.md`](./CONTRIBUTING.md). Mirror them —
a green local gate means a green CI. If you change `packages/web`/`tab`, run `npm run build` and **commit the
regenerated `dashboard/dist`** in the same change.

## Hermes-specific gotchas (easy to get wrong)

- **`/api/profiles/active`** returns `{ active, current }`: `active` = profile selected in the UI / sticky
  default; `current` = profile the gateway process is actually running. `activeName` in `useProfilesStore`
  must track **`active`**, not `current`.
- The **model picker** lives in **Settings → Connection**, not in Profiles.
- A long turn streams over **WS events** (`message.delta`/`tool.*`/...), not as the `prompt.submit` response —
  `prompt.submit` acks immediately with `{status:"streaming"}`. Don't add a timeout that assumes the response
  carries the answer.
- The server version is gated (`MIN_SUPPORTED_HERMES_VERSION` → `unsupported` state). The probe is fail-open.

## Deploying to the live `hermes-agent` pod

Run this only when the user explicitly asks to deploy. That request authorizes the commit, push, PR, merge,
and `home-ops` bump below.

Deploy the current `hermes-mobile` changes end-to-end to the live `hermes-agent` pod on the `home-ops` cluster:

1. **Build and verify `hermes-mobile` locally**
   - Run `npm run typecheck && npm run lint && npm test && npm run build`.
   - Confirm `dashboard/dist/` (including `dashboard/dist/mobile/index.html` and hashed assets) is regenerated
     and staged alongside source changes (`git add -A ':!.pi'`).

2. **Commit, open PR, run CI, and merge to `main`**
   - Commit with DCO sign-off (`git commit -s -m "<type>(<scope>): <summary>"`).
   - Push the branch to `origin` and open a PR against `main` (`gh pr create --base main`).
   - Trigger the CI workflow (`gh workflow run ci.yml --ref <branch>`), watch the run to completion
     (`gh run watch <run-id> --exit-status`), and squash-merge the PR
     (`gh pr merge <pr-number> --squash --delete-branch=false`).
   - Fetch `origin/main` and record the merged commit SHA (`NEW_SHA=$(git rev-parse origin/main)`).

3. **Bump `HERMES_PWA_REF` in `home-ops`**
   - In `/home/agent/git-repos/home-ops/components/ai/hermes-agent/values.yaml`, update `HERMES_PWA_REF` under
     the `install-plugins` initContainer `env` block to `$NEW_SHA`.
   - Commit, `git pull --rebase`, and push to `origin/main` in `/home/agent/git-repos/home-ops`.

4. **Refresh ArgoCD and verify the pod rollout**
   - Trigger an ArgoCD refresh:
     `kubectl -n argo-system annotate application hermes-agent argocd.argoproj.io/refresh=normal --overwrite`
   - Confirm ArgoCD synced the new `home-ops` revision:
     `kubectl -n argo-system get application hermes-agent -o jsonpath='{.status.sync.revision}{"\n"}'`
   - Wait for the `Recreate` deployment rollout in namespace `ai`:
     `kubectl -n ai rollout status deployment/hermes-agent --timeout=180s`
   - Verify the live pod has the new `dashboard/dist/mobile/index.html` asset hashes:
     `kubectl -n ai exec deployment/hermes-agent -c app -- cat /opt/data/plugins/hermes-pwa/dashboard/dist/mobile/index.html`

## Git safety — always preserve a rollback path

Mandatory for any non-trivial edit:

1. **Before a non-trivial change**, snapshot the working tree so HEAD stays clean:
   `git stash push -u -m "WIP: <what>"` (return with `git stash pop` if it goes wrong).
2. **Study the diff and history first** for any file you touch: `git diff HEAD -- <file>`,
   `git log --oneline -- <file>`, `git show <ref>:<file>`. If untracked, find a donor/reference copy.
3. **If something that worked stops working**, don't chase it through forward fixes — roll the affected files
   back to the last known-good state: `git checkout HEAD -- <file> ...`, then re-apply the intended change in
   the smallest scope.
4. **Do not run destructive git mutations** (`git commit`, `push`, `reset`, `rebase`) unless the user
   explicitly asks. `git stash`, `git diff`, `git checkout HEAD -- <file>`, `git branch` for inspection are fine.

---

_Keep this file short. New structure/stack/convention detail belongs in the linked authoritative docs, not here._
