# Handoff: Dashboard "Diagnostics failed" persists after PR #5

Date: 2026-10-19T19:10Z | Branch: main (clean, pushed) | Status: in progress — debugging live pod

## Goal

User's dashboard Mobile tab at https://hermes.a113.casa shows "Diagnostics failed <status>" (was 404, possibly now a different status — user says "still not working" after PR #5 deploy). Make the plugin API routes respond and the tab render diagnostics checks.

## Current State

- Working: UI/UX redesign fully shipped — PR #2 (redesign), #3 (polish), #4 (M1–M14/W1 parity), #5 (plugin mount fix) all merged to main and deployed via home-ops pin bumps. 634 tests green.
- Remaining: dashboard Mobile tab still errors despite PR #5 being live (verified in pod: plugin pinned@1e3b74c7, mount simulation MOUNT OK 32 routes).
- Git: main = 1e3b74c "fix(plugin): make plugin API importable under Hermes' importlib mount (#5)". home-ops values.yaml ref = 1e3b74c71a981e1350348d2ed521b24a6d8969de, rollout succeeded.

## Root cause fixed in PR #5 (already deployed)

Hermes mounts plugin_api.py via importlib WITHOUT plugin dirs on sys.path → bare sibling imports (push_common, voice_live) raised ModuleNotFoundError; voice_history imported plugin_api back for \_require_dashboard_auth → circular import. Fix: plugin_api.py inserts its dirs into sys.path; \_require_dashboard_auth moved to push_common.py.

## Key debugging facts (verified in pod)

- K8s: namespace `ai`, deployment hermes-agent, container `app`. Get pod: `POD=$(kubectl -n ai get pods -o name | grep hermes-agent | head -1 | cut -d/ -f2)`
- Dashboard process: PID ~150, port 9119 (127.0.0.1:9119 loopback works). Gateway on port 8642 — NOTE: gateway 404s `/api/profiles/active` (suspicious, possibly the real problem behind diagnostics failing).
- Dashboard basic auth: env HERMES_DASHBOARD_BASIC_AUTH_USERNAME/PASSWORD (from k8s secret hermes-agent-secret). Reproduce: `kubectl -n ai exec $POD -c app -- sh -c 'curl -si -u "$HERMES_DASHBOARD_BASIC_AUTH_USERNAME:$HERMES_DASHBOARD_BASIC_AUTH_PASSWORD" http://127.0.0.1:9119/api/plugins/hermes-pwa/diagnostics | head -20'`
- Plugin files are NOT at /opt/data/plugins/hermes-pwa (grep failed, no such file). Find real install path: `hermes plugins list --json` or `hermes plugins info hermes-pwa` in pod.
- Dashboard hot-mounts plugin routes on FIRST request and may cache a failed mount for the process lifetime → restarting the pod (or dashboard process) after a plugin fix may be required.
- "Diagnostics failed" string exists ONLY in packages/tab/src/index.tsx (~line 265), not packages/web.
- Unauthenticated request to /api/plugins/hermes-pwa/diagnostics returned 401 (middleware gate); authenticated returned 404 BEFORE PR #5.
- Dashboard stderr capture via /proc/150/fd/1 failed (hidepid); no /tmp/dasherr.log.

## Immediate Next Steps

1. Re-run the authenticated loopback curl above and record the EXACT status + body (user may now see 422 = route mounted but request validation fails, vs 404 = still not mounted).
2. Verify the deployed plugin_api.py on disk actually contains the PR #5 fix: find real plugin path via `hermes plugins info hermes-pwa`, grep for `sys.path.insert`.
3. If file has fix but 404 persists → restart deployment (`kubectl -n ai rollout restart deploy/hermes-agent`) to clear cached failed hot-mount, then re-curl.
4. If status is 422 → inspect FastAPI validation detail in response body; check \_plugin_route_secret_scope dependency (profile query param) in plugin_api.py.
5. Investigate gateway 8642 404 on /api/profiles/active — diagnostics handler proxies to gateway; broken gateway routes would surface as failed checks.

## Decisions & Constraints

- Never commit .playwright-cli (gitignored, user requirement).
- Deploy flow: merge PR → bump home-ops components/ai/hermes-agent/values.yaml --ref sha → push → `kubectl -n ai rollout status deploy/hermes-agent`.
- Service worker caches aggressively: tell user to unregister SW / clear site data before judging any frontend deploy; incognito bypasses.
- Local gates: `npm run typecheck && npm run lint && npm test` (634 tests); `npm run build` regenerates dashboard/dist which must be committed with packages/web changes.

## Useful Commands & Resources

- Repo: /home/agent/git-repos/hermes-mobile | home-ops: /home/agent/git-repos/home-ops
- Mockups artifact: https://ws-acac5578e380aa52.a113.casa/artifacts/git-repos/hermes-mobile/hermes-mobile-redesign-mockups.html
- Dev server: `npm run dev` (:3010, ?preview for screenshots)
